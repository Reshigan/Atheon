/**
 * Email Notification Service
 * Sends transactional emails via Microsoft Graph API (OAuth2 client credentials flow)
 * using Azure AD app registration, or falls back to storing email records for external pickup.
 */

import type { Env } from '../types';

export interface EmailPayload {
  to: string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  from?: string;
  replyTo?: string;
  tenantId: string;
}

export interface EmailResult {
  id: string;
  sent: boolean;
  channel: 'msgraph' | 'queued';
  error?: string;
}

// ── Email Templates ──

export function getAlertEmailTemplate(title: string, message: string, severity: string, actionUrl?: string): { html: string; text: string } {
  const severityColor: Record<string, string> = {
    critical: '#DC2626', high: '#EA580C', medium: '#D97706', low: '#2563EB', info: '#6B7280',
  };
  const color = severityColor[severity] || '#6B7280';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="background:#1F2937;border-radius:12px;padding:32px;border-left:4px solid ${color}">
      <div style="display:flex;align-items:center;margin-bottom:16px">
        <span style="background:${color};color:#fff;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600;text-transform:uppercase">${severity}</span>
      </div>
      <h1 style="color:#F9FAFB;font-size:20px;margin:0 0 12px">${title}</h1>
      <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 24px">${message}</p>
      ${actionUrl ? `<a href="${actionUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">View Details</a>` : ''}
    </div>
    <p style="color:#6B7280;font-size:12px;text-align:center;margin-top:24px">Atheon\u2122 Enterprise Intelligence Platform</p>
  </div>
</body>
</html>`;

  const text = `[${severity.toUpperCase()}] ${title}\n\n${message}${actionUrl ? `\n\nView details: ${actionUrl}` : ''}\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

export function getApprovalEmailTemplate(catalystName: string, action: string, confidence: number, reasoning: string, approvalUrl: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="background:#1F2937;border-radius:12px;padding:32px;border-left:4px solid #F59E0B">
      <span style="background:#F59E0B;color:#000;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600">APPROVAL REQUIRED</span>
      <h1 style="color:#F9FAFB;font-size:20px;margin:16px 0 12px">${catalystName}: ${action}</h1>
      <div style="background:#111827;border-radius:8px;padding:16px;margin:16px 0">
        <p style="color:#9CA3AF;font-size:12px;margin:0 0 4px">Confidence Score</p>
        <p style="color:#F9FAFB;font-size:24px;font-weight:700;margin:0">${(confidence * 100).toFixed(0)}%</p>
      </div>
      <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 24px">${reasoning}</p>
      <div>
        <a href="${approvalUrl}?action=approve" style="display:inline-block;background:#10B981;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;margin-right:12px">Approve</a>
        <a href="${approvalUrl}?action=reject" style="display:inline-block;background:#EF4444;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Reject</a>
      </div>
    </div>
    <p style="color:#6B7280;font-size:12px;text-align:center;margin-top:24px">Atheon\u2122 Enterprise Intelligence Platform</p>
  </div>
</body>
</html>`;

  const text = `[APPROVAL REQUIRED] ${catalystName}: ${action}\n\nConfidence: ${(confidence * 100).toFixed(0)}%\n\n${reasoning}\n\nApprove: ${approvalUrl}?action=approve\nReject: ${approvalUrl}?action=reject\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

export function getEscalationEmailTemplate(catalystName: string, action: string, escalationLevel: string, reason: string, actionUrl: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="background:#1F2937;border-radius:12px;padding:32px;border-left:4px solid #DC2626">
      <span style="background:#DC2626;color:#fff;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600">ESCALATION: ${escalationLevel.toUpperCase()}</span>
      <h1 style="color:#F9FAFB;font-size:20px;margin:16px 0 12px">${catalystName}: ${action}</h1>
      <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 24px">${reason}</p>
      <a href="${actionUrl}" style="display:inline-block;background:#3B82F6;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500">Review Action</a>
    </div>
    <p style="color:#6B7280;font-size:12px;text-align:center;margin-top:24px">Atheon\u2122 Enterprise Intelligence Platform</p>
  </div>
</body>
</html>`;

  const text = `[ESCALATION: ${escalationLevel.toUpperCase()}] ${catalystName}: ${action}\n\n${reason}\n\nReview: ${actionUrl}\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Welcome Email Template (User Creation with Password) ──

export function getWelcomeEmailTemplate(
  name: string,
  email: string,
  temporaryPassword: string,
  loginUrl: string,
  theme: 'dark' | 'light' = 'dark'
): { html: string; text: string } {
  const isDark = theme === 'dark';
  const bg = isDark ? '#16161e' : '#f8f9fa';
  const cardBg = isDark ? '#1e1e2a' : '#ffffff';
  const textColor = isDark ? '#f0f0f2' : '#1a1a2e';
  const mutedText = isDark ? '#9a9ab0' : '#6b7280';
  const accent = '#f5c542';
  const accentDark = '#d4941a';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const codeBg = isDark ? '#111118' : '#f3f4f6';
  const codeColor = isDark ? '#f5c542' : '#d4941a';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:linear-gradient(135deg,${accent},${accentDark});width:56px;height:56px;border-radius:16px;line-height:56px;font-size:28px;font-weight:800;color:#16161e">A</div>
      <h1 style="color:${textColor};font-size:24px;margin:12px 0 4px;font-weight:700">Welcome to Atheon</h1>
      <p style="color:${mutedText};font-size:14px;margin:0">Enterprise Intelligence Platform</p>
    </div>
    <div style="background:${cardBg};border-radius:12px;padding:32px;border:1px solid ${borderColor}">
      <p style="color:${textColor};font-size:16px;margin:0 0 16px">Hi ${name},</p>
      <p style="color:${mutedText};font-size:14px;line-height:1.6;margin:0 0 24px">Your Atheon account has been created. Use the credentials below to sign in for the first time. You will be prompted to change your password after logging in.</p>
      <div style="background:${codeBg};border-radius:8px;padding:20px;margin:0 0 24px;border:1px solid ${borderColor}">
        <p style="color:${mutedText};font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Your Login Credentials</p>
        <p style="color:${textColor};font-size:14px;margin:0 0 4px"><strong>Email:</strong> ${email}</p>
        <p style="color:${textColor};font-size:14px;margin:0"><strong>Temporary Password:</strong> <code style="background:${isDark ? '#2a2a3a' : '#e5e7eb'};padding:2px 8px;border-radius:4px;color:${codeColor};font-size:15px;font-weight:600">${temporaryPassword}</code></p>
      </div>
      <div style="text-align:center;margin:0 0 24px">
        <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,${accent},${accentDark});color:#16161e;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Sign In to Atheon</a>
      </div>
      <div style="border-top:1px solid ${borderColor};padding-top:16px">
        <p style="color:${mutedText};font-size:12px;line-height:1.5;margin:0">
          <strong style="color:${textColor}">Security Tip:</strong> Please change your password immediately after your first login. Never share your credentials with anyone.
        </p>
      </div>
    </div>
    <p style="color:${mutedText};font-size:12px;text-align:center;margin-top:24px">Atheon\u2122 Enterprise Intelligence Platform</p>
  </div>
</body>
</html>`;

  const text = `Welcome to Atheon!\n\nHi ${name},\n\nYour account has been created.\n\nEmail: ${email}\nTemporary Password: ${temporaryPassword}\n\nSign in at: ${loginUrl}\n\nPlease change your password after your first login.\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Password Reset Confirmation Template ──

export function getPasswordResetEmailTemplate(
  name: string,
  resetUrl: string,
  theme: 'dark' | 'light' = 'dark'
): { html: string; text: string } {
  const isDark = theme === 'dark';
  const bg = isDark ? '#16161e' : '#f8f9fa';
  const cardBg = isDark ? '#1e1e2a' : '#ffffff';
  const textColor = isDark ? '#f0f0f2' : '#1a1a2e';
  const mutedText = isDark ? '#9a9ab0' : '#6b7280';
  const accent = '#f5c542';
  const accentDark = '#d4941a';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:linear-gradient(135deg,${accent},${accentDark});width:56px;height:56px;border-radius:16px;line-height:56px;font-size:28px;font-weight:800;color:#16161e">A</div>
    </div>
    <div style="background:${cardBg};border-radius:12px;padding:32px;border:1px solid ${borderColor}">
      <h2 style="color:${textColor};font-size:20px;margin:0 0 16px">Reset Your Password</h2>
      <p style="color:${mutedText};font-size:14px;line-height:1.6;margin:0 0 24px">Hi ${name}, we received a request to reset your password. Click the button below to set a new password:</p>
      <div style="text-align:center;margin:0 0 24px">
        <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,${accent},${accentDark});color:#16161e;padding:12px 32px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">Reset Password</a>
      </div>
      <p style="color:${mutedText};font-size:12px;line-height:1.5;margin:0">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    </div>
    <p style="color:${mutedText};font-size:12px;text-align:center;margin-top:24px">Atheon\u2122 Enterprise Intelligence Platform</p>
  </div>
</body>
</html>`;

  const text = `Reset Your Password\n\nHi ${name}, click the link below to reset your password:\n${resetUrl}\n\nThis link expires in 1 hour.\n\n-- Atheon Enterprise Intelligence Platform`;

  return { html, text };
}

// ── Get Microsoft Graph API access token via OAuth2 client credentials ──

async function getMsGraphToken(env: Env): Promise<string> {
  const tenantId = env.AZURE_AD_TENANT_ID;
  const clientId = env.AZURE_AD_CLIENT_ID;
  const clientSecret = env.AZURE_AD_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Azure AD credentials (AZURE_AD_TENANT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET)');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    throw new Error(`Azure AD token error (${resp.status}): ${errorText}`);
  }

  const data = await resp.json<{ access_token: string }>();
  return data.access_token;
}

// ── Send Email via Microsoft Graph API ──

export async function sendEmail(payload: EmailPayload, env: Env): Promise<EmailResult> {
  const id = crypto.randomUUID();
  const senderEmail = payload.from || 'atheon@vantax.co.za';

  try {
    const accessToken = await getMsGraphToken(env);

    // Build the Graph API sendMail payload
    const graphPayload = {
      message: {
        subject: payload.subject,
        body: {
          contentType: 'HTML',
          content: payload.htmlBody,
        },
        toRecipients: payload.to.map(email => ({
          emailAddress: { address: email },
        })),
        ...(payload.replyTo ? {
          replyTo: [{ emailAddress: { address: payload.replyTo } }],
        } : {}),
      },
      saveToSentItems: false,
    };

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`;
    const resp = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(graphPayload),
    });

    if (resp.ok || resp.status === 202) {
      return { id, sent: true, channel: 'msgraph' };
    }

    const errorText = await resp.text().catch(() => '');
    console.error(`MS Graph sendMail error (${resp.status}):`, errorText);
    return { id, sent: false, channel: 'queued', error: `MS Graph HTTP ${resp.status}: ${errorText}` };
  } catch (err) {
    console.error('Email send error:', err);
    return { id, sent: false, channel: 'queued', error: (err as Error).message };
  }
}

// ── Queue email in D1 for external pickup (fallback) ──

export async function queueEmail(db: D1Database, payload: EmailPayload): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, text_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, payload.tenantId, JSON.stringify(payload.to), payload.subject, payload.htmlBody, payload.textBody || '', 'pending').run();
  return id;
}

// ── Send or queue email ──

export async function sendOrQueueEmail(db: D1Database, payload: EmailPayload, env: Env): Promise<EmailResult> {
  // Try to send directly via Microsoft Graph API
  const result = await sendEmail(payload, env);

  if (!result.sent) {
    // Queue for later delivery
    const queueId = await queueEmail(db, payload);
    return { id: queueId, sent: false, channel: 'queued', error: result.error };
  }

  // Log successful send
  await db.prepare(
    'INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, text_body, status, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\'))'
  ).bind(result.id, payload.tenantId, JSON.stringify(payload.to), payload.subject, payload.htmlBody, payload.textBody || '', 'sent').run().catch(() => {});

  return result;
}
