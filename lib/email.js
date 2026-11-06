// Outbound email. Uses Resend (https://resend.com) when RESEND_API_KEY is set;
// otherwise reports that mail is not configured so callers can fall back to
// showing a link for the user to share themselves.

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Cellar <onboarding@resend.dev>';

function isEmailConfigured() {
  return !!RESEND_API_KEY;
}

async function sendMail({ to, subject, text, html }) {
  if (!isEmailConfigured()) return { sent: false, reason: 'not_configured' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`Resend error ${resp.status}: ${body.slice(0, 300)}`);
      return { sent: false, reason: 'provider_error' };
    }
    return { sent: true };
  } catch (err) {
    console.error('Send mail error:', err.message);
    return { sent: false, reason: 'provider_error' };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inviteEmail({ ownerName, link, expiresDays }) {
  const who = ownerName || 'Someone';
  const subject = `${who} invited you to their Cellar`;
  const text = `${who} has invited you to share their wine, whiskey & spirits cellar.\n\n`
    + `Open this link to choose a password and start using it:\n${link}\n\n`
    + `The link expires in ${expiresDays} days. If you weren't expecting this, you can ignore it.`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:32px 16px;background:#F8F6F3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1A1A1E">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #E8E4DF;border-radius:12px;padding:28px">
    <h2 style="margin:0 0 12px;font-size:20px">${escapeHtml(who)} invited you to their Cellar</h2>
    <p style="margin:0 0 20px;line-height:1.5;color:#4A4640">You've been invited to share a wine, whiskey &amp; spirits collection. Choose a password and you'll see and edit the same cellar.</p>
    <p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#8B1E2D;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Accept invitation</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#6B6560">Or paste this link into your browser:<br><a href="${escapeHtml(link)}" style="color:#8B1E2D;word-break:break-all">${escapeHtml(link)}</a></p>
    <p style="margin:16px 0 0;font-size:13px;color:#6B6560">The link expires in ${expiresDays} days. If you weren't expecting this, you can ignore it.</p>
  </div></body></html>`;
  return { subject, text, html };
}

module.exports = { sendMail, isEmailConfigured, inviteEmail };
