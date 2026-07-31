// ============================================================
// api/admin-onboard.js   →   POST /api/admin-onboard
//
// Provisions a whole client in one request:
//   1. clones the Vapi template assistant + points it at the webhook
//   2. writes the clients row (which IS the routing registry)
//   3. creates their Supabase login
//   4. links the login to the client
//
// Every step uses the same client_id, so the five-places mismatch
// that breaks manual onboarding cannot happen.
//
// Admin-only. The caller's token is verified server-side and their
// role is read from the database — never trusted from the request.
//
// No npm dependencies: plain fetch against the Supabase REST,
// Supabase Auth Admin, and Vapi APIs.
//
// Env (Vercel → Settings → Environment Variables):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   <- secret. Never ships to a browser.
//   SUPABASE_ANON_KEY
//   VAPI_API_KEY                <- secret
//   VAPI_TEMPLATE_ASSISTANT_ID  <- the "Jollyphone — General" assistant
//   WEBHOOK_BASE_URL            <- https://lawfirm-production-0766.up.railway.app/vapi-intake
// ============================================================

import crypto from 'node:crypto';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY      = process.env.SUPABASE_ANON_KEY;
const VAPI_KEY      = process.env.VAPI_API_KEY;
const TEMPLATE_ID   = process.env.VAPI_TEMPLATE_ASSISTANT_ID;
const WEBHOOK_BASE  = process.env.WEBHOOK_BASE_URL;

const ID_RE    = /^[a-z0-9][a-z0-9_]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const sbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json'
};

/* ---------------------------------------------------------- helpers */

async function sbREST(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders, ...(init.headers || {}) }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function sbAuthAdmin(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
    ...init,
    headers: { ...sbHeaders, ...(init.headers || {}) }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function vapi(path, init = {}) {
  const res = await fetch(`https://api.vapi.ai/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${VAPI_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

function tempPassword() {
  // 18 url-safe chars — strong, and readable enough to pass along once.
  return crypto.randomBytes(14).toString('base64url').slice(0, 18);
}

function fill(text, vars) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [key, val] of Object.entries(vars)) {
    if (val === null || val === undefined) continue;
    // matches [BUSINESS NAME], [business_name], [Business-Name]
    const loose = key.replace(/[_\s]/g, '[\\s_-]*');
    out = out.replace(new RegExp(`\\[\\s*${loose}\\s*\\]`, 'gi'), String(val));
  }
  return out;
}

/* ---------------------------------------------------------- handler */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  for (const [name, val] of Object.entries({
    SUPABASE_URL, SERVICE_KEY, ANON_KEY, VAPI_KEY, TEMPLATE_ID, WEBHOOK_BASE
  })) {
    if (!val) return res.status(500).json({ error: 'not_configured', missing: name });
  }

  // ---------- 1. who is calling? ----------
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!who.ok) return res.status(401).json({ error: 'invalid_token' });
  const caller = await who.json();

  // Role comes from the database, never from the request body.
  const prof = await sbREST(`profiles?id=eq.${caller.id}&select=role`);
  if (!prof.ok || !prof.body?.length || prof.body[0].role !== 'admin') {
    return res.status(403).json({ error: 'not_admin' });
  }

  // ---------- 2. validate ----------
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const clientId      = String(b.client_id || '').trim().toLowerCase();
  const businessName  = String(b.business_name || '').trim();
  const businessType  = String(b.business_type || '').trim();
  const emailTo       = String(b.email_to || '').trim();
  const loginEmail    = String(b.login_email || '').trim();
  const contactName   = String(b.contact_name || '').trim();
  const timezone      = String(b.timezone || 'America/Los_Angeles').trim();
  const customQ       = String(b.custom_question || '').trim();
  const slackUrl      = String(b.slack_webhook_url || '').trim();
  const notes         = String(b.notes || '').trim();
  const featsIn       = (b.features && typeof b.features === 'object') ? b.features : {};
  const features      = {
    reservations: featsIn.reservations === true,
    orders:       featsIn.orders === true,
    reviews:      featsIn.reviews === true ? 'preview' : false
  };

  const bad = [];
  if (!ID_RE.test(clientId))      bad.push('client_id must be lowercase letters, numbers, or underscores');
  if (!businessName)              bad.push('business_name is required');
  if (!EMAIL_RE.test(emailTo))    bad.push('email_to must be a valid email');
  if (!EMAIL_RE.test(loginEmail)) bad.push('login_email must be a valid email');
  if (slackUrl && !/^https:\/\/hooks\.slack\.com\//.test(slackUrl)) bad.push('slack_webhook_url looks wrong');
  if (bad.length) return res.status(400).json({ error: 'invalid_input', details: bad });

  // ---------- 3. is this id free? ----------
  const existing = await sbREST(`clients?id=eq.${encodeURIComponent(clientId)}&select=id`);
  if (existing.ok && existing.body?.length) {
    return res.status(409).json({ error: 'client_exists', client_id: clientId });
  }

  // Track what we made, so a late failure doesn't leave debris behind.
  const made = { assistantId: null, clientRow: false, userId: null };

  async function rollback(reason) {
    const undone = [];
    if (made.userId) {
      const r = await sbAuthAdmin(`users/${made.userId}`, { method: 'DELETE' });
      undone.push('auth_user:' + (r.ok ? 'ok' : 'failed'));
    }
    if (made.clientRow) {
      const r = await sbREST(`clients?id=eq.${encodeURIComponent(clientId)}`, { method: 'DELETE' });
      undone.push('client_row:' + (r.ok ? 'ok' : 'failed'));
    }
    if (made.assistantId) {
      const r = await vapi(`assistant/${made.assistantId}`, { method: 'DELETE' });
      undone.push('assistant:' + (r.ok ? 'ok' : 'failed'));
    }
    console.error('[onboard] rolled back', clientId, reason, undone);
    return undone;
  }

  try {
    // ---------- 4. clone the Vapi template ----------
    const tpl = await vapi(`assistant/${TEMPLATE_ID}`);
    if (!tpl.ok) {
      return res.status(502).json({ error: 'template_fetch_failed', status: tpl.status, detail: tpl.body });
    }

    const draft = { ...tpl.body };
    for (const k of ['id', 'orgId', 'createdAt', 'updatedAt', 'isServerUrlSecretSet']) delete draft[k];

    const vars = {
      'BUSINESS NAME': businessName,
      'BUSINESS TYPE': businessType || 'business',
      'CUSTOM QUESTION': customQ,
      'BUSINESS QUESTION': customQ
    };

    draft.name = `${businessName} — Jolly Phone`;
    if (draft.firstMessage) draft.firstMessage = fill(draft.firstMessage, vars);
    if (Array.isArray(draft?.model?.messages)) {
      draft.model.messages = draft.model.messages.map(m =>
        m && typeof m.content === 'string' ? { ...m, content: fill(m.content, vars) } : m
      );
    }

    // The client_id rides on the server URL — this is what routes the call.
    const serverUrl = `${WEBHOOK_BASE}?client_id=${encodeURIComponent(clientId)}`;
    draft.server = { ...(draft.server || {}), url: serverUrl };
    delete draft.serverUrl; // avoid the deprecated field fighting the new one

    const created = await vapi('assistant', { method: 'POST', body: JSON.stringify(draft) });
    if (!created.ok) {
      return res.status(502).json({ error: 'assistant_create_failed', status: created.status, detail: created.body });
    }
    made.assistantId = created.body?.id || null;

    // ---------- 5. the clients row (this IS the routing registry) ----------
    const rowRes = await sbREST('clients', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        id: clientId,
        name: businessName,
        business_type: businessType || null,
        timezone,
        status: 'active',
        email_to: emailTo,
        slack_webhook_url: slackUrl || null,
        vapi_assistant_id: made.assistantId,
        custom_question: customQ || null,
        agent_type: 'general',
        features,
        notes: notes || null,
        created_by: caller.id
      })
    });
    if (!rowRes.ok) {
      const undone = await rollback('client_row_failed');
      return res.status(502).json({ error: 'client_row_failed', detail: rowRes.body, rolled_back: undone });
    }
    made.clientRow = true;

    // ---------- 6. their login ----------
    const password = tempPassword();
    const userRes = await sbAuthAdmin('users', {
      method: 'POST',
      body: JSON.stringify({
        email: loginEmail,
        password,
        email_confirm: true,            // skip the confirmation email
        user_metadata: { full_name: contactName || null, client_id: clientId }
      })
    });
    if (!userRes.ok) {
      const undone = await rollback('user_create_failed');
      const dup = userRes.status === 422 || /already/i.test(JSON.stringify(userRes.body || ''));
      return res.status(dup ? 409 : 502).json({
        error: dup ? 'login_email_taken' : 'user_create_failed',
        detail: userRes.body,
        rolled_back: undone
      });
    }
    made.userId = userRes.body?.id || null;

    // ---------- 7. link login -> client ----------
    const linkRes = await sbREST('profiles', {
      method: 'POST',
      body: JSON.stringify({
        id: made.userId,
        client_id: clientId,
        full_name: contactName || null,
        role: 'owner'
      })
    });
    if (!linkRes.ok) {
      const undone = await rollback('profile_link_failed');
      return res.status(502).json({ error: 'profile_link_failed', detail: linkRes.body, rolled_back: undone });
    }

    // ---------- done ----------
    return res.status(200).json({
      ok: true,
      client_id: clientId,
      business_name: businessName,
      assistant_id: made.assistantId,
      assistant_name: draft.name,
      server_url: serverUrl,
      login_email: loginEmail,
      temp_password: password,          // shown once — never stored anywhere readable
      next_steps: [
        'In Vapi, assign a phone number to this assistant (Inbound Settings).',
        'Publish the assistant if it is not already live.',
        'Make one test call and confirm the email, the Slack alert, and the dashboard row.',
        'Send the login and temporary password separately from the email thread.'
      ]
    });

  } catch (err) {
    const undone = await rollback('unexpected:' + err.message);
    console.error('[onboard] unexpected', err);
    return res.status(500).json({ error: 'unexpected', message: err.message, rolled_back: undone });
  }
}
