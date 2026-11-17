import {passwordProblem,passwordRequirements} from './password-policy.mjs';
const SITE = 'https://shammynoor.github.io/gpinsightiq-temporary/';
const ORIGIN = new URL(SITE).origin;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailAddress = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const authOptions = { persistSession: false, autoRefreshToken: false };

const messages = {
  pending: {
    subject: 'Approval needed for a GP Insight IQ viewer',
    heading: 'A viewer is waiting for approval',
    description: 'A viewer has accepted your invitation and is waiting for access to your practice.',
    instructions: 'Sign in to GP Insight IQ and open Users & approvals to review their request.',
    action: 'Open GP Insight IQ'
  },
  approved: {
    subject: 'Your GP Insight IQ access has been approved',
    heading: 'Your practice access is approved',
    description: 'Your practice administrator has approved your access to GP Insight IQ.',
    instructions: 'You can now sign in with the email address and password you chose when you created your account.',
    action: 'Sign in to GP Insight IQ'
  }
};

const escapeHtml = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function approvalEmail({ subject, heading, description, instructions, action }) {
  const link = escapeHtml(SITE);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f6f9;color:#344f63;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(description)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f6f9">
    <tr><td align="center" style="padding:28px 12px">
      <!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:600px;border:1px solid #e0e7ee">
        <tr><td bgcolor="#102b49" style="padding:24px;color:#ffffff;font-size:27px;font-weight:bold">
          GP Insight<span style="color:#25c9b7;font-size:17px">IQ</span>
        </td></tr>
        <tr><td style="padding:28px 24px;font-size:16px;line-height:1.6">
          <h1 style="margin:0 0 16px;color:#102b49;font-size:25px;line-height:1.25">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 12px">${escapeHtml(description)}</p>
          <p style="margin:0 0 24px">${escapeHtml(instructions)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr><td bgcolor="#00766d" style="padding:12px 20px;border-radius:8px">
              <a href="${link}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:bold">${escapeHtml(action)}</a>
            </td></tr>
          </table>
          <p style="margin:22px 0 0;color:#536e83;font-size:13px">
            If the button doesn’t work, open this link in your browser.<br>
            <a href="${link}" style="color:#006c63;word-break:break-all">${link}</a>
          </p>
        </td></tr>
        <tr><td bgcolor="#f8fafc" style="padding:18px 24px;border-top:1px solid #e0e7ee;color:#536e83;font-size:12px;line-height:1.6">
          <strong>Predict demand. Plan capacity. Improve access.</strong><br>GP Insight IQ Support
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body></html>`;
}

export function makeHandler({ env, createClient, fetch: send }) {
  async function notify(recipient, message) {
    if (!recipient) return null;
    try {
      const tenant = env('MICROSOFT_TENANT_ID');
      const app = env('MICROSOFT_CLIENT_ID');
      const secret = env('MICROSOFT_CLIENT_SECRET');
      const from = env('MICROSOFT_FROM_EMAIL');
      if (!uuid.test(tenant ?? '') || !uuid.test(app ?? '') || !secret || !emailAddress.test(from ?? '')) return false;
      const tokenResponse = await send('https://login.microsoftonline.com/' + tenant + '/oauth2/v2.0/token', {
        method: 'POST',
        signal: AbortSignal.timeout(8000),
        body: new URLSearchParams({ client_id: app, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
      });
      if (!tokenResponse.ok) return false;
      const { access_token: accessToken } = await tokenResponse.json();
      if (!accessToken) return false;
      const delivery = await send('https://graph.microsoft.com/v1.0/users/' + encodeURIComponent(from) + '/sendMail', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          message: {
            subject: message.subject,
            from: { emailAddress: { address: from, name: 'GP Insight IQ Support' } },
            body: { contentType: 'HTML', content: approvalEmail(message) },
            toRecipients: [{ emailAddress: { address: recipient } }],
            replyTo: [{ emailAddress: { address: from, name: 'GP Insight IQ' } }]
          },
          saveToSentItems: true
        })
      });
      return delivery.status === 202;
    } catch {
      return false;
    }
  }
  const notifyAdministrator = recipient => notify(recipient, messages.pending);

  return async request => {
    const headers = {
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'Vary': 'Origin'
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    const origin = request.headers.get('origin');
    if (origin && origin !== ORIGIN) return reply(403, { error: 'Origin not allowed.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'POST required.' });
    try {
      const body = await request.text();
      if (body.length > 2048) return reply(400, { error: 'Invalid request.' });
      let input;
      try { input = JSON.parse(body); } catch { return reply(400, { error: 'Invalid request.' }); }
      const url = env('SUPABASE_URL');
      if (input?.action === 'register') {
        const { token, password } = input;
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (typeof token !== 'string' || !uuid.test(token)) return reply(400, { error: 'This invitation link is invalid. Ask your practice administrator for a new link.' });
        if (!emailAddress.test(email) || email.length > 254) return reply(400, { error: 'Enter a valid email address.' });
        const passwordError = passwordProblem(password);
        if (passwordError) return reply(400, { error: passwordError });
        const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
        if (!serviceKey) return reply(503, { error: 'Account creation is temporarily unavailable.' });
        const service = createClient(url, serviceKey, { auth: authOptions });
        const { data: invite, error: lookupError } = await service.rpc('iq_viewer_registration_details', { p_token: token, p_email: email });
        if (lookupError) return reply(503, { error: 'Could not check the invitation. Try again.' });
        if (!invite) return reply(403, { error: 'This invitation has expired, has already been accepted, or was sent to a different email address. If you already have an account, sign in.' });
        if (invite.role !== 'viewer') return reply(200, { use_standard_signup: true });
        if (invite.confirmed) return reply(409, { error: 'An account already exists for this email address. Select Sign in to accept your invitation.' });
        const credentials = { password, email_confirm: true, app_metadata: { iq_viewer_invitation: token } };
        const result = invite.user_id
          ? await service.auth.admin.updateUserById(invite.user_id, credentials)
          : await service.auth.admin.createUser({ email, ...credentials });
        if (result.error?.code === 'weak_password') {
          const reasons = result.error.reasons || result.error.weak_password?.reasons || [];
          return reply(400, { error: reasons.includes('pwned') ? 'This password has appeared in a data breach. Choose a different, unique password.' : 'This password was rejected. ' + passwordRequirements });
        }
        if (result.error || !result.data.user) return reply(409, { error: 'The account could not be created. Check the invitation, or sign in if you already created an account.' });
        return reply(200, { registered: true, email_submitted: await notifyAdministrator(invite.administrator_email) });
      }

      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'Sign in first.' });
      const client = createClient(url, env('SUPABASE_ANON_KEY'), { auth: authOptions, global: { headers: { Authorization: authorization } } });
      const { data: identity, error: authError } = await client.auth.getUser(authorization.slice(7));
      if (authError || !identity?.user) return reply(401, { error: 'Sign in again to continue.' });
      if (input?.action === 'accept' && typeof input.token === 'string' && uuid.test(input.token)) {
        const { data: recipient, error } = await client.rpc('iq_accept_invitation_for_notification', { p_token: input.token });
        if (error) return reply(403, { error: 'This invitation is invalid, has expired, or was sent to a different email address.' });
        return reply(200, { accepted: true, email_submitted: await notifyAdministrator(recipient) });
      }
      if (input?.action === 'approve' && typeof input.practice === 'string' && uuid.test(input.practice)
          && typeof input.user === 'string' && uuid.test(input.user)) {
        const { data: recipient, error } = await client.rpc('iq_approve_viewer_for_notification', {
          p_practice: input.practice, p_user: input.user, p_resend: input.resend === true
        });
        if (error) return reply(403, { error: 'You do not have permission to approve this viewer.' });
        const submitted = await notify(recipient, messages.approved);
        return reply(200, { approved: true, email_submitted: submitted });
      }
      return reply(400, { error: 'Invalid request.' });
    } catch {
      return reply(500, { error: 'The request could not be completed. Try again.' });
    }
  };
}
