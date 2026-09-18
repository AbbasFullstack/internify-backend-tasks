/**
 * Email delivery (Nodemailer).
 *
 * Four rules, all falling out of "the email must never break the post":
 *
 *  1. Fail soft. Sending is best-effort. A post that was written and saved is a
 *     success even if SMTP is down, so `sendPostConfirmation` resolves with
 *     `{ sent: false, reason }` instead of throwing.
 *  2. Never block for long. The timeout is short (SMTP_TIMEOUT_MS), so a hanging
 *     server delays a request by seconds, not minutes.
 *  3. No transport is a valid state. With no EMAIL_USER/EMAIL_PASS the module
 *     reports `configured: false` and every send resolves as skipped — which is
 *     what lets `npm test` and local dev run with no secrets at all.
 *  4. Never log the password. Only recipients are logged, and errors are
 *     reduced to their message.
 */
import nodemailer from 'nodemailer';

const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 8000);

let transporter = null;
let transportChecked = false;

/** Is there enough configuration to attempt a send? */
export const isEmailConfigured = () =>
  Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

/**
 * Build the transport once, lazily. Tests inject a fake with
 * `__setTransportForTests`, so nothing here runs under test.
 */
const getTransport = () => {
  if (transportChecked) return transporter;
  transportChecked = true;

  if (!isEmailConfigured()) return null;

  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });

  return transporter;
};

/** Test seam — assert the send without touching a real inbox. */
export const __setTransportForTests = (fake) => {
  transporter = fake;
  transportChecked = true;
};

/** Test seam — reset so a later test sees a clean module. */
export const __resetTransportForTests = () => {
  transporter = null;
  transportChecked = false;
};

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Plain-text body, kept simple so it reads in any client. */
export const buildConfirmationText = ({ author, title, excerpt }) => {
  const lines = [
    `Hi ${author},`,
    '',
    'Your blog post has been published successfully.',
    '',
    `Title: ${title}`,
  ];
  if (excerpt) lines.push('', excerpt);
  lines.push('', '— Internify Backend Tasks');
  return lines.join('\n');
};

/**
 * HTML body. Every interpolated value is escaped: the title is user input, and
 * unescaped it would inject markup into the email.
 */
export const buildConfirmationHtml = ({ author, title, excerpt }) => {
  const safe = {
    author: escapeHtml(author),
    title: escapeHtml(title),
    excerpt: excerpt ? escapeHtml(excerpt) : '',
  };

  return `<!doctype html>
<html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.5">
  <p>Hi ${safe.author},</p>
  <p>Your blog post has been published successfully.</p>
  <p style="margin:16px 0;padding:12px 16px;border-left:3px solid #0b2545;background:#f4f6f9">
    <strong>${safe.title}</strong>
    ${safe.excerpt ? `<br><span style="color:#555">${safe.excerpt}</span>` : ''}
  </p>
  <p style="color:#666;font-size:13px">— Internify Backend Tasks</p>
</body></html>`;
};

/**
 * Send the "your post is live" confirmation.
 *
 * Always resolves:
 *   { sent: true,  messageId }
 *   { sent: false, reason: 'no-recipient' | 'not-configured' | 'error' }
 */
export const sendPostConfirmation = async ({ to, author, title, excerpt }) => {
  if (!to) return { sent: false, reason: 'no-recipient' };

  const transport = getTransport();
  if (!transport) return { sent: false, reason: 'not-configured' };

  try {
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject: `Your post "${title}" is live`,
      text: buildConfirmationText({ author, title, excerpt }),
      html: buildConfirmationHtml({ author, title, excerpt }),
    });

    console.log(`[mail] confirmation sent to ${to}`);
    return { sent: true, messageId: info?.messageId };
  } catch (error) {
    // Deliberately not thrown — see rule 1 at the top of this file.
    console.warn(`[mail] could not send to ${to}: ${error.message}`);
    return { sent: false, reason: 'error', error: error.message };
  }
};

export default { sendPostConfirmation, isEmailConfigured };
