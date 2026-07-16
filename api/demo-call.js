// /api/demo-call.js  — Vercel serverless function
// Fires a Vapi outbound call to the number a prospect entered on the site,
// so they experience the agent live. Rate-limited + validated so a public
// "call anyone" button can't be abused.
//
// Deploy: drop this at /api/demo-call.js in your Vercel project.
// Env vars to set in Vercel → Settings → Environment Variables:
//   VAPI_API_KEY            - your Vapi private API key (server-side only!)
//   VAPI_PHONE_NUMBER_ID    - id of a number you own in Vapi (the caller ID)
//   VAPI_DEMO_ASSISTANT_ID  - the demo/showcase assistant to run
// Optional:
//   DEMO_MAX_PER_HOUR       - per-number cap (default 2)
//   DEMO_MAX_GLOBAL_HOUR    - global cap across all callers (default 60)

// Simple in-memory rate limiting. Note: serverless instances are ephemeral,
// so this is best-effort (resets on cold start) and each instance counts
// separately — the real ceiling is roughly (caps × live instances). Good
// enough to stop casual abuse, not a hard guarantee.
// TODO(pre-launch): back these counters with a shared store (Upstash/Redis)
// so the caps hold across instances and survive cold starts.
const hits = new Map();          // phone -> [timestamps]
let globalHits = [];             // timestamps across everyone

const HOUR = 60 * 60 * 1000;

function tooMany(phone) {
  const now = Date.now();
  const perNum = Number(process.env.DEMO_MAX_PER_HOUR || 2);
  const perGlobal = Number(process.env.DEMO_MAX_GLOBAL_HOUR || 60);

  globalHits = globalHits.filter((t) => now - t < HOUR);
  if (globalHits.length >= perGlobal) return "busy";

  const arr = (hits.get(phone) || []).filter((t) => now - t < HOUR);
  if (arr.length >= perNum) return "limit";

  arr.push(now); hits.set(phone, arr);
  globalHits.push(now);
  return null;
}

// Strict E.164: + then a non-zero country code then 7–14 more digits.
const E164 = /^\+[1-9]\d{7,14}$/;

// Normalize to E.164 (Vapi needs +countrycode). Assumes US/Canada if 10 digits.
// Callers type "(555) 123-4567" far more often than "+15551234567", so we
// normalize first and validate the result — a bare "+1" or "+0..." must not
// reach Vapi just because it starts with a plus.
function toE164(raw) {
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return null;

  let candidate = null;
  if (String(raw).trim().startsWith("+")) candidate = "+" + digits;
  else if (digits.length === 10) candidate = "+1" + digits;
  else if (digits.length === 11 && digits[0] === "1") candidate = "+" + digits;
  else return null; // unknown format — reject rather than guess

  return E164.test(candidate) ? candidate : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { phone, confirmed } = req.body || {};

    // Require an explicit confirmation flag from the UI ("yes, this is my number").
    // This only stops accidental calls: the flag is client-supplied, so anyone
    // curl-ing this endpoint can just send confirmed:true. It is not proof the
    // caller owns the number.
    // TODO(pre-launch): replace with a real OTP round-trip — POST here sends a
    // code, a second call verifies it, and only a verified number reaches Vapi.
    // Until that lands, the rate limits above are the only real abuse ceiling.
    if (!confirmed) {
      return res.status(400).json({ ok: false, error: "not_confirmed" });
    }

    const number = toE164(phone);
    if (!number) {
      return res.status(400).json({ ok: false, error: "bad_number" });
    }

    const limited = tooMany(number);
    if (limited === "limit") {
      return res.status(429).json({ ok: false, error: "rate_limited",
        message: "That number's had its demo calls for the hour — try again later." });
    }
    if (limited === "busy") {
      return res.status(429).json({ ok: false, error: "global_busy",
        message: "The demo line is swamped right now — give it a minute." });
    }

    const { VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, VAPI_DEMO_ASSISTANT_ID } = process.env;
    if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID || !VAPI_DEMO_ASSISTANT_ID) {
      return res.status(500).json({ ok: false, error: "not_configured" });
    }

    const vapiRes = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assistantId: VAPI_DEMO_ASSISTANT_ID,
        phoneNumberId: VAPI_PHONE_NUMBER_ID,
        customer: { number },
      }),
    });

    if (!vapiRes.ok) {
      const detail = await vapiRes.text().catch(() => "");
      console.error("Vapi call failed:", vapiRes.status, detail);
      return res.status(502).json({ ok: false, error: "call_failed" });
    }

    // callId is the handle for looking this call up in Vapi later (support,
    // debugging). Safe to hand to the client — it is not a credential.
    const call = await vapiRes.json().catch(() => ({}));
    return res.status(200).json({ ok: true, callId: call.id ?? null });
  } catch (err) {
    console.error("demo-call error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
