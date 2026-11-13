// Snowy Research step-by-step checkout (bag page).
// shared.js still owns the checkout logic (verification, address lookup, promo
// codes, payments). This file only shows one step at a time and keeps the
// progress tracker in sync.
(() => {
  const panel = document.getElementById('checkoutModal');
  if (!panel) return;
  const steps = [...panel.querySelectorAll('[data-co-step]')];
  const stepperItems = [...document.querySelectorAll('.bag-stepper li')];
  const counter = panel.querySelector('[data-co-counter]');
  let current = 0;

  function setTracker(index) { // 0 = bag, 1-3 = checkout steps
    stepperItems.forEach((li, i) => {
      li.classList.toggle('is-active', i === index);
      li.classList.toggle('is-done', i < index);
    });
    if (counter) counter.textContent = `Step ${index + 1} of ${stepperItems.length}`;
  }

  function showStep(index) {
    current = Math.max(0, Math.min(index, steps.length - 1));
    steps.forEach((step, i) => { step.hidden = i !== current; });
    setTracker(current + 1);
    const top = document.querySelector('.bag-head');
    if (top) window.scrollTo({ top: Math.max(0, top.getBoundingClientRect().top + window.scrollY - 90), behavior: 'smooth' });
    const first = steps[current].querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])');
    if (first && !first.value) setTimeout(() => first.focus({ preventScroll: true }), 250);
  }

  function stepIsValid(step) {
    const fields = [...step.querySelectorAll('input[required], select[required]')]
      .filter(field => !field.closest('[hidden]') && field.offsetParent !== null);
    for (const field of fields) {
      if (!field.checkValidity()) { field.reportValidity(); return false; }
    }
    return true;
  }

  function emailIsVerified() {
    const email = String(document.getElementById('buyerEmail')?.value || '').trim().toLowerCase();
    return typeof checkoutVerifiedEmail !== 'undefined' && !!email && checkoutVerifiedEmail === email;
  }

  panel.addEventListener('click', async event => {
    const next = event.target.closest('[data-co-next]');
    const back = event.target.closest('[data-co-back]');
    if (next) {
      const step = steps[current];
      if (!stepIsValid(step)) return;
      // A remembered device may already be verified; ask the server before blocking.
      if (step.dataset.coStep === 'details' && !emailIsVerified() && typeof refreshCheckoutEmailStatus === 'function') {
        next.disabled = true;
        try { await refreshCheckoutEmailStatus(); } finally { next.disabled = false; }
      }
      if (step.dataset.coStep === 'details' && !emailIsVerified()) {
        const status = document.getElementById('checkoutEmailStatus');
        if (status) { status.textContent = 'Verify your email to continue. Tap "Email me a code" if you haven\'t yet.'; status.style.color = 'var(--danger)'; }
        document.getElementById('checkoutEmailCode')?.focus();
        return;
      }
      showStep(current + 1);
    }
    if (back) showStep(current - 1);
  });

  // shared.js opens/closes checkout by toggling this element's display.
  const sync = () => {
    const open = panel.style.display !== 'none';
    document.body.classList.toggle('is-checkout', open);
    if (open) showStep(0); else setTracker(0);
  };
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['style'] });
  setTracker(0);
})();
