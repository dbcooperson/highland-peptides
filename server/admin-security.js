// Admin sign-in protection: an attempt log plus brute-force lockouts.
//
// What is recorded for each attempt: time, result, IP address, the forwarding
// chain, country hint from the proxy, user agent, language, referer, and the
// NAMES of cookies sent plus a short one-way fingerprint of the session cookie.
// Raw cookie values and typed passwords are never stored: a log full of live
// session tokens would itself be something worth stealing.
//
// Lockout rules (state survives restarts because it lives next to the order DB):
//  - Per IP: 5 failures within 15 minutes locks that IP. Each repeat lockout
//    doubles (15m, 30m, 1h, ... capped at 24h).
//  - Whole site: more than 60 failures from all IPs within 15 minutes pauses
//    password sign-in for everyone for 15 minutes. A device that already has a
//    valid "keep me signed in" token still gets in, so the owner is not locked
//    out by an attack.
//  - Every failure waits ~0.6-1s before answering to slow automated guessing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PER_IP_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;
const BASE_LOCK_MS = 15 * 60 * 1000;
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
const GLOBAL_LIMIT = 60;
const GLOBAL_LOCK_MS = 15 * 60 * 1000;
const MAX_LOG_ENTRIES = 3000;

function createAdminSecurity({ filePath, now = () => Date.now(), failureDelayMs = [600, 1000] } = {}) {
  let state = null;

  function blank() {
    return { attempts: [], ips: {}, globalLockedUntil: 0 };
  }

  function load() {
    if (state) return state;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      state = { ...blank(), ...parsed };
      if (!Array.isArray(state.attempts)) state.attempts = [];
      if (!state.ips || typeof state.ips !== 'object') state.ips = {};
    } catch (_err) {
      state = blank();
    }
    return state;
  }

  function persist() {
    if (!filePath) return;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temp = `${filePath}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(state));
      fs.renameSync(temp, filePath);
    } catch (err) {
      console.error('Could not save admin login log:', err.message || err);
    }
  }

  function clip(value, max = 300) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
  }

  function cookieDetails(req) {
    const header = String(req.headers?.cookie || '');
    const names = [];
    let sessionFingerprint = '';
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      const name = part.slice(0, index).trim();
      if (!name) continue;
      if (names.length < 20) names.push(clip(name, 60));
      if (name === 'hp.sid') {
        sessionFingerprint = crypto.createHash('sha256').update(part.slice(index + 1).trim()).digest('hex').slice(0, 12);
      }
    }
    return { cookieNames: names, sessionFingerprint };
  }

  function ipOf(req) {
    return clip(req.ip || req.socket?.remoteAddress || 'unknown', 80);
  }

  function describe(req) {
    return {
      ip: ipOf(req),
      forwardedFor: clip(req.get?.('x-forwarded-for') || '', 200),
      country: clip(req.get?.('cf-ipcountry') || req.get?.('x-vercel-ip-country') || '', 8),
      userAgent: clip(req.get?.('user-agent') || '', 300),
      language: clip(req.get?.('accept-language') || '', 120),
      referer: clip(req.get?.('referer') || '', 200),
      ...cookieDetails(req),
    };
  }

  function ipRecord(ip) {
    const data = load();
    if (!data.ips[ip]) data.ips[ip] = { failures: [], lockedUntil: 0, lockCount: 0 };
    return data.ips[ip];
  }

  function prune() {
    const data = load();
    const cutoff = now() - WINDOW_MS;
    for (const [ip, record] of Object.entries(data.ips)) {
      record.failures = (record.failures || []).filter(time => time > cutoff);
      const stale = !record.failures.length && (record.lockedUntil || 0) < now() - MAX_LOCK_MS;
      if (stale) delete data.ips[ip];
    }
    if (data.attempts.length > MAX_LOG_ENTRIES) data.attempts = data.attempts.slice(-MAX_LOG_ENTRIES);
  }

  function recentGlobalFailures() {
    const cutoff = now() - WINDOW_MS;
    return load().attempts.filter(entry => entry.result === 'failed' && Date.parse(entry.at) > cutoff).length;
  }

  // Returns null when the attempt may proceed, otherwise { status, error, retryAfterSeconds }.
  function check(req) {
    const data = load();
    const ip = ipOf(req);
    const record = data.ips[ip];
    const current = now();
    if (record && record.lockedUntil > current) {
      return { reason: 'ip_locked', retryAfterMs: record.lockedUntil - current };
    }
    if (data.globalLockedUntil > current) {
      return { reason: 'site_paused', retryAfterMs: data.globalLockedUntil - current };
    }
    return null;
  }

  function log(req, result, extra = {}) {
    const data = load();
    data.attempts.push({ at: new Date(now()).toISOString(), result, ...describe(req), ...extra });
    prune();
    persist();
  }

  function recordBlocked(req, blocked) {
    log(req, 'blocked', { reason: blocked.reason });
  }

  function recordFailure(req) {
    const data = load();
    const ip = ipOf(req);
    const record = ipRecord(ip);
    const current = now();
    record.failures = (record.failures || []).filter(time => time > current - WINDOW_MS);
    record.failures.push(current);
    let lockedForMs = 0;
    if (record.failures.length >= PER_IP_LIMIT) {
      lockedForMs = Math.min(MAX_LOCK_MS, BASE_LOCK_MS * (2 ** (record.lockCount || 0)));
      record.lockedUntil = current + lockedForMs;
      record.lockCount = (record.lockCount || 0) + 1;
      record.failures = [];
    }
    log(req, 'failed', lockedForMs ? { lockedForMinutes: Math.round(lockedForMs / 60000) } : {});
    if (recentGlobalFailures() > GLOBAL_LIMIT && data.globalLockedUntil <= current) {
      data.globalLockedUntil = current + GLOBAL_LOCK_MS;
      console.warn('Admin sign-in paused for 15 minutes after a burst of failed attempts.');
      persist();
    }
    return { lockedForMs, remaining: lockedForMs ? 0 : PER_IP_LIMIT - record.failures.length };
  }

  function recordSuccess(req, method = 'password') {
    const data = load();
    const record = data.ips[ipOf(req)];
    if (record) { record.failures = []; record.lockCount = 0; record.lockedUntil = 0; }
    log(req, 'success', { method });
  }

  function failureDelay() {
    const [min, max] = failureDelayMs;
    const ms = min + Math.floor(Math.random() * Math.max(1, max - min));
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function summary(limit = 200) {
    const data = load();
    prune();
    const current = now();
    const since = current - 24 * 60 * 60 * 1000;
    const lastDay = data.attempts.filter(entry => Date.parse(entry.at) > since);
    return {
      attempts: data.attempts.slice(-limit).reverse(),
      blockedIps: Object.entries(data.ips)
        .filter(([, record]) => record.lockedUntil > current)
        .map(([ip, record]) => ({ ip, lockedUntil: new Date(record.lockedUntil).toISOString(), lockCount: record.lockCount }))
        .sort((a, b) => b.lockedUntil.localeCompare(a.lockedUntil)),
      sitePausedUntil: data.globalLockedUntil > current ? new Date(data.globalLockedUntil).toISOString() : null,
      last24h: {
        failed: lastDay.filter(entry => entry.result === 'failed').length,
        blocked: lastDay.filter(entry => entry.result === 'blocked').length,
        success: lastDay.filter(entry => entry.result === 'success').length,
        uniqueIps: new Set(lastDay.filter(entry => entry.result !== 'success').map(entry => entry.ip)).size,
      },
      rules: { perIpLimit: PER_IP_LIMIT, windowMinutes: WINDOW_MS / 60000, siteLimit: GLOBAL_LIMIT },
    };
  }

  function unblock(ip) {
    const data = load();
    if (ip === '*') {
      data.ips = {};
      data.globalLockedUntil = 0;
    } else if (data.ips[ip]) {
      data.ips[ip].lockedUntil = 0;
      data.ips[ip].failures = [];
    }
    persist();
  }

  return { check, recordBlocked, recordFailure, recordSuccess, failureDelay, summary, unblock, describe };
}

module.exports = { createAdminSecurity, PER_IP_LIMIT, GLOBAL_LIMIT };
