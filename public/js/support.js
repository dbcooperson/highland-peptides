document.getElementById('supportForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = document.getElementById('supportName').value.trim();
  const email = document.getElementById('supportEmail').value.trim();
  const order = document.getElementById('supportOrder').value.trim();
  const topic = document.getElementById('supportTopic').value;
  const message = document.getElementById('supportMessage').value.trim();
  const msgEl = document.getElementById('supportMsg');

  if (!name || !email || !message) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Name, email, and message are required.';
    return;
  }

  const subject = `Highland Peptides Support - ${topic}${order ? ` - Order #${order}` : ''}`;
  const body = [
    `Name: ${name}`,
    `Email: ${email}`,
    order ? `Order: ${order}` : '',
    `Topic: ${topic}`,
    '',
    message,
    '',
    'Research-use-only support request.'
  ].filter(Boolean).join('\n');

  window.location.href = `mailto:support@highlandpeptides.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  msgEl.style.color = 'var(--success)';
  msgEl.textContent = 'Opening your email app. If nothing opens, email support@highlandpeptides.com directly.';
});
