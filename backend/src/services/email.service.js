'use strict';

/**
 * email.service.js
 *
 * Centralized email dispatch via Resend SDK.
 * Falls back gracefully when RESEND_API_KEY is not set.
 * Never throws — always resolves with { success, error? }.
 *
 * Design: branded HTML emails matching the URIS dark/navy theme.
 * Colors mirror index.css exactly:
 *   Background  #07080f  (navy-950)
 *   Card bg     #0d0f1c  (glass-card)
 *   Gold        #c9a84c
 *   Ice/frost   #e8f0fb
 *   Ice dim     #b8d4f0
 *   Signal/green #4ade80
 *   Red         #f87171
 *   Amber       #f59e0b
 */

const { Resend } = require('resend');
const logger = require('../utils/logger');

let _resend = null;

function getResend() {
  if (_resend) return _resend;
  _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ── Shared layout wrapper ─────────────────────────────────────────────────────

/**
 * Wraps any email body in the URIS branded shell.
 * Inline styles only — email clients strip <style> blocks.
 */
function layout({ title, previewText, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${title}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#07080f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${previewText}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;</div>

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background-color:#07080f;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
          style="max-width:520px;width:100%;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <!-- Logo mark -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background:rgba(10,11,20,0.9);border:1px solid rgba(201,168,76,0.3);border-radius:999px;padding:6px 18px;">
                    <span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:700;font-size:10px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(184,212,240,0.5);">&#9670;&nbsp;&nbsp;SECURE SYSTEM</span>
                  </td>
                </tr>
              </table>
              <div style="margin-top:16px;">
                <span style="font-family:Georgia,'Times New Roman',serif;font-weight:900;font-size:36px;letter-spacing:0.08em;color:#e8f0fb;">URIS</span>
              </div>
              <!-- Gold rule -->
              <div style="height:1px;background:linear-gradient(90deg,transparent,#c9a84c,#e2c76e,#c9a84c,transparent);margin:10px auto;width:80px;"></div>
              <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;font-size:9px;letter-spacing:0.4em;text-transform:uppercase;color:rgba(184,212,240,0.3);margin-top:4px;">UNIFIED RESOURCE INTELLIGENCE SYSTEM</div>
            </td>
          </tr>

          <!-- Glass card body -->
          <tr>
            <td style="background:rgba(13,15,28,0.95);border:1px solid rgba(201,168,76,0.15);border-radius:4px;padding:36px 32px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10px;color:rgba(184,212,240,0.2);letter-spacing:0.2em;text-transform:uppercase;margin:0;">STEMONEF &nbsp;·&nbsp; SELF-HOSTED &nbsp;·&nbsp; PRIVACY-COMPLIANT</p>
              <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:10px;color:rgba(184,212,240,0.12);margin:6px 0 0;">This is an automated message from URIS. Do not reply.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Shared components ─────────────────────────────────────────────────────────

function sectionLabel(text) {
  return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;font-size:9px;letter-spacing:0.35em;text-transform:uppercase;color:rgba(201,168,76,0.5);margin:0 0 6px;">${text}</p>`;
}

function heading(text) {
  return `<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:900;font-size:26px;color:#e8f0fb;margin:0 0 20px;line-height:1.2;">${text}</h1>`;
}

function goldRule() {
  return `<div style="height:1px;background:linear-gradient(90deg,transparent,#c9a84c,#e2c76e,#c9a84c,transparent);margin:20px 0;"></div>`;
}

function bodyText(text) {
  return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:rgba(184,212,240,0.75);line-height:1.7;margin:0 0 16px;">${text}</p>`;
}

function ctaButton(text, url) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td style="background:linear-gradient(135deg,#b8922e,#c9a84c,#e2c76e,#c9a84c);border-radius:3px;">
        <a href="${url}" target="_blank"
          style="display:inline-block;padding:13px 32px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.25em;text-transform:uppercase;color:#07080f;text-decoration:none;border-radius:3px;">${text}</a>
      </td>
    </tr>
  </table>`;
}

function infoCard(label, value, color = '#c9a84c') {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background:rgba(7,8,15,0.6);border:1px solid rgba(201,168,76,0.12);border-radius:3px;margin:12px 0;">
    <tr>
      <td style="padding:14px 16px;">
        <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:600;font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:rgba(184,212,240,0.3);margin:0 0 4px;">${label}</p>
        <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${color};margin:0;">${value}</p>
      </td>
    </tr>
  </table>`;
}

function alertBanner(text, color = '#f59e0b', bg = 'rgba(245,158,11,0.08)', border = 'rgba(245,158,11,0.25)') {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
    style="background:${bg};border:1px solid ${border};border-radius:3px;margin:16px 0;">
    <tr>
      <td style="padding:12px 16px;">
        <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:${color};margin:0;line-height:1.5;">${text}</p>
      </td>
    </tr>
  </table>`;
}

function linkFallback(url) {
  return `<p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:rgba(184,212,240,0.3);margin:8px 0 0;word-break:break-all;">Or copy this link: <span style="color:rgba(201,168,76,0.6);">${url}</span></p>`;
}

// ── Templates ─────────────────────────────────────────────────────────────────

function renderPasswordReset({ resetUrl, expiresInMinutes = 60 }) {
  const body = `
    ${sectionLabel('Account Security')}
    ${heading('Reset Your Password')}
    ${goldRule()}
    ${bodyText(`You requested a password reset for your URIS account. Click the button below to set a new password. This link expires in <strong style="color:#c9a84c;">${expiresInMinutes} minutes</strong>.`)}
    ${ctaButton('Reset Password', resetUrl)}
    ${alertBanner('If you did not request this reset, you can safely ignore this email. Your password will not change.', 'rgba(184,212,240,0.5)', 'rgba(184,212,240,0.04)', 'rgba(184,212,240,0.1)')}
    ${linkFallback(resetUrl)}
  `;
  return {
    subject: 'Reset your URIS password',
    html: layout({ title: 'Reset Your URIS Password', previewText: `Reset your URIS password — link expires in ${expiresInMinutes} minutes`, body }),
    text: `Reset your URIS password: ${resetUrl}\nExpires in ${expiresInMinutes} minutes.\nIf you didn't request this, ignore this email.`,
  };
}

function renderPasswordChanged({ name = 'User' }) {
  const body = `
    ${sectionLabel('Account Security')}
    ${heading('Password Changed')}
    ${goldRule()}
    ${bodyText(`Hi <strong style="color:#e8f0fb;">${name}</strong>, your URIS account password was successfully updated.`)}
    ${infoCard('Status', '&#10003; Password updated successfully', '#4ade80')}
    ${alertBanner('If you did not make this change, contact your administrator immediately and secure your account.', '#f87171', 'rgba(248,113,113,0.08)', 'rgba(248,113,113,0.2)')}
  `;
  return {
    subject: 'Your URIS password was changed',
    html: layout({ title: 'URIS Password Changed', previewText: 'Your URIS password was successfully updated', body }),
    text: `Hi ${name}, your URIS password was successfully changed. If you didn't do this, contact your administrator immediately.`,
  };
}

function renderAccountApproved({ name = 'User', loginUrl = '' }) {
  const url = loginUrl || (process.env.FRONTEND_URL || 'http://localhost:5173') + '/login';
  const body = `
    ${sectionLabel('Account Access')}
    ${heading('Account Approved')}
    ${goldRule()}
    ${bodyText(`Hi <strong style="color:#e8f0fb;">${name}</strong>, your URIS account has been reviewed and approved. You now have full access to the system.`)}
    ${infoCard('Access Level', 'Active — Full System Access', '#4ade80')}
    ${ctaButton('Enter System', url)}
    ${bodyText('Log in to view your dashboard, tasks, and performance metrics.')}
  `;
  return {
    subject: 'Your URIS account has been approved',
    html: layout({ title: 'URIS Account Approved', previewText: 'Your URIS account is now active — log in to get started', body }),
    text: `Hi ${name}, your URIS account has been approved. Log in at: ${url}`,
  };
}

function renderTaskAssigned({ name = 'User', taskTitle = 'a task', taskDescription = '', complexity = null, loginUrl = '' }) {
  const url = loginUrl || (process.env.FRONTEND_URL || 'http://localhost:5173') + '/dashboard';
  const complexityLabel = complexity != null
    ? ['', 'Low', 'Low-Medium', 'Medium', 'Medium-High', 'High'][Math.round(complexity)] || `${complexity}`
    : null;

  const body = `
    ${sectionLabel('Task Assignment')}
    ${heading('New Task Assigned')}
    ${goldRule()}
    ${bodyText(`Hi <strong style="color:#e8f0fb;">${name}</strong>, a new task has been assigned to you in URIS.`)}
    ${infoCard('Task', taskTitle, '#c9a84c')}
    ${taskDescription ? infoCard('Description', taskDescription, 'rgba(184,212,240,0.7)') : ''}
    ${complexityLabel ? infoCard('Complexity', complexityLabel, '#b8d4f0') : ''}
    ${ctaButton('View Task', url)}
    ${bodyText('Log in to URIS to review the full task details, update your progress, and manage your workload.')}
  `;
  return {
    subject: `New task assigned: ${taskTitle}`,
    html: layout({ title: 'New Task Assigned — URIS', previewText: `You have been assigned: ${taskTitle}`, body }),
    text: `Hi ${name}, you have been assigned: ${taskTitle}. Log in to URIS to view the details: ${url}`,
  };
}

function renderGdocReminder({ name = 'User', gdocUrl = '' }) {
  const body = `
    ${sectionLabel('Work Log')}
    ${heading('Work Log Reminder')}
    ${goldRule()}
    ${bodyText(`Hi <strong style="color:#e8f0fb;">${name}</strong>, this is a reminder to keep your URIS work log up to date.`)}
    ${alertBanner('Your work log has not been updated recently. Regular updates help your team track progress and maintain accurate capacity scores.', '#f59e0b', 'rgba(245,158,11,0.08)', 'rgba(245,158,11,0.2)')}
    ${gdocUrl ? ctaButton('Open Work Log', gdocUrl) : ''}
    ${bodyText('Keeping your work log current ensures your capacity score and credibility metrics remain accurate.')}
  `;
  return {
    subject: 'URIS Work Log Reminder',
    html: layout({ title: 'Work Log Reminder — URIS', previewText: 'Please update your URIS work log', body }),
    text: `Hi ${name}, please update your URIS work log.${gdocUrl ? ` Link: ${gdocUrl}` : ''}`,
  };
}

function renderOperationalAlert({ alertMessage = '', severity = 'warning', internName = '' }) {
  const isRed = severity === 'critical';
  const color  = isRed ? '#f87171' : '#f59e0b';
  const bg     = isRed ? 'rgba(248,113,113,0.08)' : 'rgba(245,158,11,0.08)';
  const border = isRed ? 'rgba(248,113,113,0.25)' : 'rgba(245,158,11,0.25)';
  const label  = isRed ? 'Critical Alert' : 'Operational Alert';
  const loginUrl = (process.env.FRONTEND_URL || 'http://localhost:5173') + '/intelligence';

  const body = `
    ${sectionLabel('Operational Intelligence')}
    ${heading(label)}
    ${goldRule()}
    ${internName ? bodyText(`Regarding: <strong style="color:#e8f0fb;">${internName}</strong>`) : ''}
    ${alertBanner(alertMessage, color, bg, border)}
    ${ctaButton('View Intelligence Dashboard', loginUrl)}
    ${bodyText('Log in to the URIS Intelligence dashboard to review full operational context and take action.')}
  `;
  return {
    subject: `URIS ${label}: ${alertMessage.slice(0, 60)}${alertMessage.length > 60 ? '…' : ''}`,
    html: layout({ title: `URIS ${label}`, previewText: alertMessage, body }),
    text: `URIS ${label}: ${alertMessage}`,
  };
}

/**
 * New chat message notification.
 * Sent to participants who have no active socket connection (offline users).
 *
 * @param {object} opts
 * @param {string} opts.recipientName  - Display name of the recipient
 * @param {string} opts.senderName     - Display name of the message sender
 * @param {string} opts.chatName       - Conversation name (other person's name or group name)
 * @param {string} opts.preview        - First 120 chars of the message content (plain text)
 * @param {string} opts.chatUrl        - Direct link to the conversation
 */
function renderNewChatMessage({ recipientName = 'User', senderName = 'Someone', chatName = 'a conversation', preview = '', chatUrl = '' }) {
  const truncatedPreview = preview.length > 120 ? preview.slice(0, 120) + '…' : preview;
  const url = chatUrl || (process.env.FRONTEND_URL || 'http://localhost:5173') + '/chat';

  const body = `
    ${sectionLabel('New Message')}
    ${heading('You have a new message')}
    ${goldRule()}
    ${bodyText(`Hi <strong style="color:#e8f0fb;">${recipientName}</strong>, <strong style="color:#c9a84c;">${senderName}</strong> sent you a message in <strong style="color:#e8f0fb;">${chatName}</strong>.`)}
    ${truncatedPreview ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
      style="background:rgba(7,8,15,0.6);border:1px solid rgba(201,168,76,0.12);border-left:3px solid rgba(201,168,76,0.4);border-radius:3px;margin:16px 0;">
      <tr>
        <td style="padding:14px 16px;">
          <p style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:rgba(232,240,251,0.7);margin:0;line-height:1.6;font-style:italic;">&ldquo;${truncatedPreview}&rdquo;</p>
        </td>
      </tr>
    </table>` : ''}
    ${ctaButton('Open Conversation', url)}
    ${bodyText('You are receiving this email because you were offline when this message was sent.')}
  `;
  return {
    subject: `${senderName} sent you a message on URIS`,
    html: layout({ title: 'New URIS Message', previewText: `${senderName}: ${truncatedPreview || 'sent you a message'}`, body }),
    text: `Hi ${recipientName}, ${senderName} sent you a message in ${chatName}.\n\n"${truncatedPreview}"\n\nOpen conversation: ${url}`,
  };
}

// ── Template registry ─────────────────────────────────────────────────────────

const TEMPLATES = {
  'password-reset':    renderPasswordReset,
  'password-changed':  renderPasswordChanged,
  'account-approved':  renderAccountApproved,
  'task-assigned':     renderTaskAssigned,
  'gdoc-reminder':     renderGdocReminder,
  'operational-alert': renderOperationalAlert,
  'new-chat-message':  renderNewChatMessage,
};

// ── Main send function ────────────────────────────────────────────────────────

/**
 * Send an email using a named template via Resend.
 * Never throws — always resolves with { success, error? }.
 *
 * @param {object} opts
 * @param {string}  opts.to           - Recipient email address
 * @param {string}  opts.templateName - Key from TEMPLATES registry
 * @param {object}  [opts.templateData] - Data passed to the template renderer
 */
async function sendEmail({ to, templateName, templateData = {} }) {
  // Guard: Resend not configured
  if (!process.env.RESEND_API_KEY) {
    logger.warn({ to, templateName }, 'RESEND_API_KEY not set — skipping email dispatch');
    return { success: false, reason: 'RESEND_NOT_CONFIGURED' };
  }

  // Guard: unknown template
  const renderFn = TEMPLATES[templateName];
  if (!renderFn) {
    logger.error({ templateName }, 'Unknown email template');
    return { success: false, error: `Unknown template: ${templateName}` };
  }

  try {
    const { subject, html, text } = renderFn(templateData);
    const from = process.env.RESEND_FROM || process.env.SMTP_FROM || 'URIS <noreply@uris.app>';

    const resend = getResend();
    const { data, error } = await resend.emails.send({ from, to, subject, html, text });

    if (error) {
      logger.error({ error, to, templateName }, 'Resend API returned error');
      return { success: false, error: error.message };
    }

    logger.info({ to, templateName, id: data?.id }, 'Email sent via Resend');
    return { success: true, id: data?.id };
  } catch (err) {
    logger.error({ err, to, templateName }, 'Email dispatch failed');
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail };
