'use strict';

const nodemailer = require('nodemailer');

const RECIPIENT = 'support@ahmedmagdynusir.com';

/**
 * Sends a failure alert email via SMTP.
 * Uses the same env vars as the rest of the app (SMTP_HOST, SMTP_PORT, etc.).
 *
 * @param {Error|string} err - the error that caused the backup to fail
 * @returns {Promise<void>}
 */
async function notifyFailure(err) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const errorStack = err instanceof Error && err.stack ? err.stack : '';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #c0392b; color: #fff; padding: 20px; border-radius: 6px 6px 0 0;">
        <h2 style="margin: 0;">⚠️ Database Backup Failed</h2>
      </div>
      <div style="background: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 6px 6px;">
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        <p><strong>Error:</strong></p>
        <pre style="background: #fff; border: 1px solid #ccc; padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap;">${errorMessage}</pre>
        ${
          errorStack
            ? `<p><strong>Stack Trace:</strong></p>
        <pre style="background: #fff; border: 1px solid #ccc; padding: 12px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; font-size: 12px;">${errorStack}</pre>`
            : ''
        }
        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />
        <p style="color: #666; font-size: 13px;">This is an automated alert from the Reversia backup system. Please investigate immediately.</p>
      </div>
    </div>
  `;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `${process.env.SMTP_NAME || 'Reversia'} <${process.env.SMTP_USERNAME}>`,
      to: RECIPIENT,
      subject: '[URGENT] Data Export Backup Failed',
      html,
      priority: 'high',
    });

    console.log(`[Backup] Failure notification sent to ${RECIPIENT}`);
  } catch (mailErr) {
    // Email failure must never crash the process – only log
    console.error(`[Backup] Could not send failure email: ${mailErr.message}`);
  }
}

module.exports = { notifyFailure };
