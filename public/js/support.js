document.getElementById('supportForm').addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.getElementById('supportName').value.trim();
  const email = document.getElementById('supportEmail').value.trim();
  const order = document.getElementById('supportOrder').value.trim();
  const topic = document.getElementById('supportTopic').value;
  const message = document.getElementById('supportMessage').value.trim();
  const msgEl = document.getElementById('supportMsg');
  const button = event.target.querySelector('button[type="submit"], button:not([type])');

  if (!name || !email || !message) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Name, email, and message are required.';
    return;
  }

  if (button) button.disabled = true;
  msgEl.style.color = '';
  msgEl.textContent = 'Sending…';
  try {
    const response = await fetch('/api/support/messages', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, orderNumber: order, message: `[${topic}${order ? ` · Order ${order}` : ''}]\n${message}`, website: (document.getElementById('supportWebsite') || {}).value || '' }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = data.error || 'Message not sent. Please try again.';
      return;
    }
    document.getElementById('supportMessage').value = '';
    msgEl.style.color = 'var(--success)';
    msgEl.textContent = 'Message sent. Our reply will appear in the chat window (bottom right of every page).';
    if (window.refreshSupportChat) window.refreshSupportChat(false);
    if (window.openSupportChat) window.openSupportChat();
  } catch (_) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Message not sent. Check your connection and try again.';
  } finally {
    if (button) button.disabled = false;
  }
});

const supportParams = new URLSearchParams(window.location.search);
const requestedSubject = supportParams.get('subject');
const requestedProduct = supportParams.get('product');
if (requestedSubject && requestedSubject.toLowerCase().includes('coa')) {
  document.getElementById('supportTopic').value = 'COA request';
}
if (requestedProduct) {
  document.getElementById('supportMessage').value = `Please send the available batch report for ${requestedProduct}.`;
}
