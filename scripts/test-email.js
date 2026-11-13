// Sends one test email using the SMTP settings in .env.
// Run from the site folder:  node scripts/test-email.js
if (typeof process.loadEnvFile === 'function') process.loadEnvFile();
const nodemailer = require('nodemailer');
const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT || 587),
  secure: String(SMTP_SECURE).toLowerCase() === 'true',
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});
transport.verify()
  .then(() => {
    console.log(`Gmail login OK for ${SMTP_USER}. Sending a test email...`);
    return transport.sendMail({
      from: `Snowy Research <${SMTP_USER}>`,
      to: SMTP_USER,
      subject: 'Snowy Research test email',
      text: 'If you can read this, the website can send email through this Gmail account.',
    });
  })
  .then(() => console.log(`Sent. Check the inbox of ${SMTP_USER}.`))
  .catch(err => {
    console.log('Email test FAILED:', err.responseCode || err.code || '', err.message);
    if (err.responseCode === 535) console.log('Gmail rejected the login: double-check SMTP_USER and the 16-letter app password in .env.');
  });
