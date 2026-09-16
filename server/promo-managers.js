function normalizedUsername(value) {
  return String(value || '').trim().slice(0, 80).toLowerCase();
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || '').trim());
}

function configuredPromoManagers(config) {
  const managers = [];
  const builtInAccounts = Array.isArray(config.PROMO_MANAGER_BUILTIN_ACCOUNTS)
    ? config.PROMO_MANAGER_BUILTIN_ACCOUNTS
    : [];
  for (const entry of builtInAccounts) {
    const username = normalizedUsername(entry && entry.username);
    const passwordSha256 = String(entry && entry.passwordSha256 || '').trim().toLowerCase();
    if (!username || !validSha256(passwordSha256)) {
      throw new Error('Every built-in promo manager account needs a username and a 64-character SHA-256 password hash.');
    }
    managers.push({ username, passwordSha256 });
  }

  const legacyUsername = normalizedUsername(config.PROMO_MANAGER_USERNAME);
  const legacyHash = String(config.PROMO_MANAGER_PASSWORD_SHA256 || '').trim().toLowerCase();

  if (legacyUsername || legacyHash) {
    if (!legacyUsername || !validSha256(legacyHash)) {
      throw new Error('The legacy promo manager credentials are incomplete or invalid.');
    }
    managers.push({ username: legacyUsername, passwordSha256: legacyHash });
  }

  const raw = String(config.PROMO_MANAGER_ACCOUNTS_JSON || '').trim();
  if (raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_err) {
      throw new Error('PROMO_MANAGER_ACCOUNTS_JSON must be valid JSON.');
    }
    if (!Array.isArray(parsed)) throw new Error('PROMO_MANAGER_ACCOUNTS_JSON must be a JSON array.');

    for (const entry of parsed) {
      const username = normalizedUsername(entry && entry.username);
      const passwordSha256 = String(entry && entry.passwordSha256 || '').trim().toLowerCase();
      if (!username || !validSha256(passwordSha256)) {
        throw new Error('Every promo manager account needs a username and a 64-character SHA-256 password hash.');
      }
      managers.push({ username, passwordSha256 });
    }
  }

  const usernames = new Set();
  for (const manager of managers) {
    if (usernames.has(manager.username)) throw new Error(`Duplicate promo manager username: ${manager.username}`);
    usernames.add(manager.username);
  }

  return managers;
}

module.exports = { configuredPromoManagers };
