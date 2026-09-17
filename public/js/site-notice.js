(() => {
  const notice = document.createElement('footer');
  notice.className = 'site-legal-notice';
  notice.setAttribute('aria-label', 'Research use notice and terms of sale');
  notice.innerHTML = `
    <div class="site-legal-notice-inner">
      <h2>Notice</h2>
      <p>All products offered by <strong>Highland Peptides</strong> are sold strictly for laboratory research purposes. They are not intended for human or animal consumption, injection, diagnosis, treatment, cure, or prevention of disease. They must not be used in foods, drugs, cosmetics, medical devices, or clinical applications.</p>
      <p>Product statements and materials have not been evaluated by the U.S. Food and Drug Administration. Information on this site is for educational and research purposes only and is not a substitute for professional medical advice. Highland Peptides supplies research materials; no product is offered as a medicine or for patient use.</p>
      <p><a href="/terms-of-sale.html">Terms of Sale</a> · <a href="/support.html">Contact support</a></p>
    </div>`;
  document.body.appendChild(notice);
})();
