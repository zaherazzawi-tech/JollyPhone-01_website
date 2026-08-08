// /api/clover-callback.js
// Clover redirects here after a merchant authorizes the app.
//
// Two cases arrive at this URL:
//   1. OAuth callback  — has ?code= → exchange it for a token, store it.
//   2. App launch      — no code (merchant clicked the app tile) → just show a page.
//
// Params Clover sends: merchant_id, client_id, code, employee_id, state.

// Supabase over its REST API rather than the SDK — this repo ships no
// dependencies, same as /api/admin-onboard.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CLOVER_BASE =
  process.env.CLOVER_ENV === "production"
    ? "https://api.clover.com"
    : "https://apisandbox.dev.clover.com";

function page(title, body, ok = true) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Jolly Phone</title></head>
<body style="margin:0;background:#0a0a0a;color:#e8e8e8;font:16px/1.7 system-ui,sans-serif;
display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;">
<main style="max-width:460px;text-align:center;">
  <h1 style="color:${ok ? "#f5822b" : "#ff6b6b"};font-size:1.5rem;margin:0 0 12px;">${title}</h1>
  <p style="margin:0;color:#bbb;">${body}</p>
</main></body></html>`;
}

export default async function handler(req, res) {
  const { code, merchant_id: merchantId, state } = req.query;

  // App-launch path — no code to exchange.
  if (!code) {
    res.setHeader("Content-Type", "text/html");
    return res
      .status(200)
      .send(page("Jolly Phone is connected", "You can close this tab. Your phone agent is running."));
  }

  const appId = process.env.CLOVER_APP_ID;
  const appSecret = process.env.CLOVER_APP_SECRET;

  // Checked before the exchange: the code is one-time, so burning it and then
  // finding we can't store the token loses the connection irrecoverably.
  if (!appId || !appSecret || !SUPABASE_URL || !SERVICE_KEY) {
    console.error("[clover-oauth] missing CLOVER_APP_ID/SECRET or SUPABASE_URL/SERVICE_ROLE_KEY");
    res.setHeader("Content-Type", "text/html");
    return res.status(500).send(page("Setup incomplete", "Contact support@jollyphone.com.", false));
  }

  try {
    // Exchange the one-time code for a long-lived merchant token.
    const tokenResp = await fetch(`${CLOVER_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: appId, client_secret: appSecret, code }),
    });

    const raw = await tokenResp.text();
    if (!tokenResp.ok) {
      console.error("[clover-oauth] token exchange failed", tokenResp.status, raw.slice(0, 300));
      res.setHeader("Content-Type", "text/html");
      return res.status(502).send(page("Connection failed", "Please try connecting again.", false));
    }

    const { access_token: accessToken } = JSON.parse(raw);
    if (!accessToken) throw new Error("no access_token in response");

    // `state` carries the Jolly Phone client_id we set in /api/clover-install.
    // If it's absent (merchant installed straight from the App Market), store the
    // row keyed by merchant_id alone and link it to a client manually.
    const clientId = (state && String(state).trim()) || null;

    // Upsert on merchant_id — `resolution=merge-duplicates` is the REST
    // equivalent of the SDK's { onConflict: "merchant_id" }, and relies on the
    // unique constraint on clover_tokens.merchant_id.
    const saveResp = await fetch(
      `${SUPABASE_URL}/rest/v1/clover_tokens?on_conflict=merchant_id`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify({
          merchant_id: merchantId,
          client_id: clientId,
          access_token: accessToken,
          environment: process.env.CLOVER_ENV === "production" ? "production" : "sandbox",
          connected_at: new Date().toISOString(),
        }),
      }
    );

    if (!saveResp.ok) {
      // The token is valid but unsaved — log loudly so it can be recovered.
      const detail = await saveResp.text();
      console.error("[clover-oauth] supabase upsert failed", saveResp.status, detail.slice(0, 300), {
        merchantId,
        clientId,
      });
      res.setHeader("Content-Type", "text/html");
      return res.status(500).send(page("Almost there", "Contact support@jollyphone.com to finish setup.", false));
    }

    console.log(`[clover-oauth] connected merchant ${merchantId} → client ${clientId || "(unlinked)"}`);

    res.setHeader("Content-Type", "text/html");
    return res
      .status(200)
      .send(page("Connected", "Jolly Phone can now send orders to your POS. You can close this tab."));
  } catch (err) {
    console.error("[clover-oauth] error", err);
    res.setHeader("Content-Type", "text/html");
    return res.status(500).send(page("Connection failed", "Please try connecting again.", false));
  }
}
