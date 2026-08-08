// /api/clover-install.js
// Sends a merchant to Clover to authorize the app.
// Usage: link them to https://jollyphone.vercel.app/api/clover-install?client=wowkabab
//
// The `client` param is YOUR client_id (the same one Vapi sends), passed through
// Clover as `state` so the callback knows which Jolly Phone client this token
// belongs to. Without it you get a token you can't route.

const CLOVER_OAUTH_BASE =
  process.env.CLOVER_ENV === "production"
    ? "https://www.clover.com"
    : "https://sandbox.dev.clover.com";

export default function handler(req, res) {
  const appId = process.env.CLOVER_APP_ID;
  if (!appId) return res.status(500).send("CLOVER_APP_ID not configured");

  const client = String(req.query.client || "").trim();
  if (!client) {
    return res.status(400).send("Missing ?client= (your Jolly Phone client_id)");
  }

  const url =
    `${CLOVER_OAUTH_BASE}/oauth/authorize` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(client)}`;

  res.redirect(302, url);
}
