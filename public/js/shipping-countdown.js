(() => {
  const FULFILLMENT_TIME_ZONE = 'America/Los_Angeles';
  const CUTOFF_HOUR = 14;
  const CUTOFF_MINUTE = 0;
  let refreshTimer = null;

  function datePartsInZone(date, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const value = type => Number(parts.find(part => part.type === type)?.value || 0);
    return { year: value('year'), month: value('month'), day: value('day') };
  }

  function addCalendarDays(dateParts, amount) {
    const date = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + amount));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  function isBusinessDay(dateParts) {
    const weekday = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day)).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  }

  function nextBusinessDay(dateParts) {
    let candidate = addCalendarDays(dateParts, 1);
    while (!isBusinessDay(candidate)) candidate = addCalendarDays(candidate, 1);
    return candidate;
  }

  function timeZoneOffsetMinutes(timeZone, date) {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date).find(item => item.type === 'timeZoneName');
    const match = String(part?.value || '').match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
    return match[1] === '-' ? -minutes : minutes;
  }

  function dateAtFulfillmentTime(dateParts, hour, minute) {
    const wallClockUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute);
    let result = new Date(wallClockUtc);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = new Date(wallClockUtc - timeZoneOffsetMinutes(FULFILLMENT_TIME_ZONE, result) * 60000);
    }
    return result;
  }

  function shippingStatus(nowInput = new Date()) {
    const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
    const today = datePartsInZone(now, FULFILLMENT_TIME_ZONE);
    const todayCutoff = dateAtFulfillmentTime(today, CUTOFF_HOUR, CUTOFF_MINUTE);
    const beforeTodayCutoff = isBusinessDay(today) && now.getTime() < todayCutoff.getTime();
    const cutoffDay = beforeTodayCutoff ? today : nextBusinessDay(today);
    const cutoff = beforeTodayCutoff ? todayCutoff : dateAtFulfillmentTime(cutoffDay, CUTOFF_HOUR, CUTOFF_MINUTE);
    const shipDay = nextBusinessDay(cutoffDay);
    const shipDate = dateAtFulfillmentTime(shipDay, 12, 0);
    return {
      beforeTodayCutoff,
      cutoff,
      shipDate,
      remainingMs: Math.max(0, cutoff.getTime() - now.getTime()),
    };
  }

  function formatRemaining(milliseconds) {
    const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function timeLabel(date, timeZone) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  }

  function shipDayLabel(date) {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: FULFILLMENT_TIME_ZONE,
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  function countdownCopy(variant, now = new Date(), shopperTimeZoneOverride = '') {
    const status = shippingStatus(now);
    const shopperTimeZone = shopperTimeZoneOverride || Intl.DateTimeFormat().resolvedOptions().timeZone || FULFILLMENT_TIME_ZONE;
    const remaining = formatRemaining(status.remainingMs);
    const shipDay = shipDayLabel(status.shipDate);
    const localCutoff = timeLabel(status.cutoff, shopperTimeZone);
    const pacificCutoff = timeLabel(status.cutoff, FULFILLMENT_TIME_ZONE);
    const cutoff = shopperTimeZone === FULFILLMENT_TIME_ZONE
      ? localCutoff
      : `${localCutoff} your time (${pacificCutoff})`;
    const timing = status.beforeTodayCutoff
      ? `Order within ${remaining} to ship ${shipDay}`
      : `Next cutoff in ${remaining}; order now to ship ${shipDay}`;

    if (variant === 'pill') return `${remaining} left · cutoff ${localCutoff}`;
    if (variant === 'summary') return `${timing}. Your cutoff is ${cutoff}.`;
    return `${timing}. Cutoff: ${cutoff}.`;
  }

  function updateShippingCountdowns(now = new Date()) {
    document.querySelectorAll('[data-shipping-countdown]').forEach(element => {
      const variant = element.dataset.shippingCountdown || 'card';
      element.textContent = countdownCopy(variant, now);
      element.setAttribute('title', 'Cutoff is calculated in Pacific Time and displayed in your local time zone. Business days exclude weekends.');
    });
  }

  function startShippingCountdown() {
    updateShippingCountdowns();
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => updateShippingCountdowns(), 30000);
  }

  const api = { getStatus: shippingStatus, getCopy: countdownCopy, refresh: updateShippingCountdowns };
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.hpShippingCountdown = api;
    window.updateShippingCountdowns = updateShippingCountdowns;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startShippingCountdown, { once: true });
    else startShippingCountdown();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
