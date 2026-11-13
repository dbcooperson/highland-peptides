(function () {
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
  }

  fetch('/api/giveaway', { credentials: 'same-origin' })
    .then(response => response.json())
    .then(info => {
      const windowEl = document.getElementById('gwWindow');
      const rulesEl = document.getElementById('gwRulesWindow');
      const form = document.getElementById('gwFreeForm');
      if (info.startsAt && info.endsAt) {
        const range = `${formatDate(info.startsAt)} – ${formatDate(new Date(new Date(info.endsAt).getTime() - 1).toISOString())}`;
        if (rulesEl) rulesEl.textContent = `${range}, ending 11:59 p.m. Pacific time on the last day`;
        if (windowEl) {
          windowEl.textContent = info.status === 'active'
            ? `Open now through ${formatDate(new Date(new Date(info.endsAt).getTime() - 1).toISOString())}.`
            : info.status === 'upcoming' ? `Opens ${formatDate(info.startsAt)}.` : 'This giveaway has ended. Winners are being contacted by email.';
        }
      }
      if (info.status !== 'active' && form) {
        form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
        document.getElementById('gwMsg').textContent = info.status === 'ended' ? 'Entries are closed.' : 'Free entry opens when the giveaway starts.';
      }
    })
    .catch(() => {});

  const form = document.getElementById('gwFreeForm');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const msg = document.getElementById('gwMsg');
    const button = form.querySelector('button[type="submit"]');
    const payload = {
      name: document.getElementById('gwName').value.trim(),
      email: document.getElementById('gwEmail').value.trim(),
      agree: document.getElementById('gwAgree').checked,
      website: document.getElementById('gwWebsite').value,
    };
    if (!payload.agree) {
      msg.style.color = 'var(--danger)';
      msg.textContent = 'Please confirm the eligibility checkbox.';
      return;
    }
    button.disabled = true;
    msg.style.color = '';
    msg.textContent = 'Entering…';
    try {
      const response = await fetch('/api/giveaway/free-entry', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        msg.style.color = 'var(--danger)';
        msg.textContent = data.error || 'Entry not saved. Please try again.';
        return;
      }
      msg.style.color = 'var(--success)';
      msg.textContent = "You're in! Come back tomorrow for another free entry.";
    } catch (_) {
      msg.style.color = 'var(--danger)';
      msg.textContent = 'Entry not saved. Check your connection and try again.';
    } finally {
      button.disabled = false;
    }
  });
})();
