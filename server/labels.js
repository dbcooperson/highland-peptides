const PDFDocument = require('pdfkit');
const { SITE_NAME } = require('./config');

const RUO_LINE = 'FOR LABORATORY / RESEARCH USE ONLY. NOT FOR HUMAN OR VETERINARY USE. NOT A DRUG, FOOD, OR COSMETIC.';

// Packing slip: standard 8.5x11 page, for your regular printer.
// Lists exactly what was ordered and in what quantity, so you know what to pull and pack.
function buildPackingSlip(order, items, res) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="packing-slip-order-${order.id}.pdf"`);
  doc.pipe(res);

  doc.fontSize(18).text(SITE_NAME, { align: 'left' });
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor('#555').text('Packing Slip', { align: 'left' });
  doc.moveDown();

  const b = order.buyer || {};
  doc.fillColor('#000').fontSize(11);
  doc.text(`Order #: ${order.id}`);
  doc.text(`Date: ${order.created_at}`);
  doc.text(`Ship to: ${b.name || ''}  (${b.email || ''})`);
  doc.text(`${b.address1 || ''}${b.address2 ? ', ' + b.address2 : ''}`);
  doc.text(`${b.city || ''}, ${b.state || ''} ${b.zip || ''}`);
  doc.moveDown();

  doc.fontSize(12).text('Items Ordered', { underline: true });
  doc.moveDown(0.5);

  const colX = { sku: 50, name: 110, spec: 320, qty: 480 };
  doc.fontSize(9).fillColor('#555');
  doc.text('SKU', colX.sku, doc.y, { continued: false });
  doc.text('Product', colX.name, doc.y - 11);
  doc.text('Spec', colX.spec, doc.y - 11);
  doc.text('Qty', colX.qty, doc.y - 11);
  doc.moveDown(0.3);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.3);

  doc.fillColor('#000').fontSize(10);
  items.forEach(it => {
    const y = doc.y;
    doc.text(it.sku, colX.sku, y);
    doc.text(it.name, colX.name, y, { width: 200 });
    doc.text(it.spec, colX.spec, y, { width: 150 });
    doc.text(String(it.quantity), colX.qty, y);
    doc.moveDown(0.6);
  });

  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ccc').stroke();
  doc.moveDown(0.5);
  doc.fontSize(10);
  doc.text(`Subtotal: $${order.subtotal.toFixed(2)}`, { align: 'right' });
  if (order.discount_code) {
    doc.text(`Discount (${order.discount_code}): -$${(order.discount_amount || 0).toFixed(2)}`, { align: 'right' });
  }
  if (order.packaging_fee) {
    doc.text(`Packaging fee: $${order.packaging_fee.toFixed(2)}`, { align: 'right' });
  }
  doc.text(`Shipping: $${(order.shipping_fee || 0).toFixed(2)}`, { align: 'right' });
  if (order.order_fee) {
    doc.text(`Processing fee: $${order.order_fee.toFixed(2)}`, { align: 'right' });
  }
  doc.fontSize(11).text(`Total: $${order.total.toFixed(2)}`, { align: 'right' });

  doc.moveDown(2);
  doc.fontSize(8).fillColor('#900').text(RUO_LINE, { align: 'center' });

  doc.end();
}

// Compact 4x6 label content (for the Nimbot B1 or any 4x6 thermal/label printer).
// Ship-to is left blank for you to fill in with your label software; this focuses
// on exactly what's in the package, per your request.
function buildContentsLabel(order, items, res) {
  const doc = new PDFDocument({ size: [288, 432], margin: 10 }); // 4in x 6in at 72dpi
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="contents-label-order-${order.id}.pdf"`);
  doc.pipe(res);

  const b = order.buyer || {};
  doc.fontSize(11).text(SITE_NAME, { align: 'center' });
  doc.fontSize(8).fillColor('#555').text('Package Contents', { align: 'center' });
  doc.moveDown(0.5);
  doc.fillColor('#000').fontSize(9);
  doc.text(`Order #${order.id}  -  ${order.created_at}`);
  doc.text(`${b.name || ''}`);
  doc.moveDown(0.5);
  doc.moveTo(10, doc.y).lineTo(278, doc.y).strokeColor('#000').stroke();
  doc.moveDown(0.3);

  items.forEach(it => {
    doc.fontSize(8).text(`${it.quantity}x  ${it.name} (${it.spec})  [${it.sku}]`);
  });

  doc.moveDown(0.5);
  doc.moveTo(10, doc.y).lineTo(278, doc.y).strokeColor('#000').stroke();
  doc.moveDown(0.4);
  doc.fontSize(6).fillColor('#900').text(RUO_LINE, { align: 'center' });

  doc.end();
}

module.exports = { buildPackingSlip, buildContentsLabel };
