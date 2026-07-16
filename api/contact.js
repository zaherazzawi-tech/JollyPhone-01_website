// /api/contact.js — Vercel serverless function
// Receives the site's Contact Sales form and emails you a formatted lead.
//
// Env vars to set in Vercel → Settings → Environment Variables:
//   RESEND_API_KEY     - your Resend key (same one used on Railway)
//   CONTACT_EMAIL_TO   - where leads land (your email)
//   CONTACT_EMAIL_FROM - verified sender (onboarding@resend.dev until you verify a domain)

const hits = [];
const HOUR = 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    const { name, email, business, message } = req.body || {};

    if (!name || !email || !String(email).includes("@")) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    // light global rate limit: 30 submissions/hour (best-effort, resets on cold start)
    const now = Date.now();
    while (hits.length && now - hits[0] > HOUR) hits.shift();
    if (hits.length >= 30) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    hits.push(now);

    const { RESEND_API_KEY, CONTACT_EMAIL_TO, CONTACT_EMAIL_FROM } = process.env;
    if (!RESEND_API_KEY || !CONTACT_EMAIL_TO || !CONTACT_EMAIL_FROM) {
      return res.status(500).json({ ok: false, error: "not_configured" });
    }

    const esc = (s) =>
      String(s || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

    const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:600px;color:#111;">
      <div style="background:#1a0f06;color:#f5822b;padding:14px 18px;border-radius:8px 8px 0 0;
                  font-weight:700;font-size:15px;letter-spacing:.05em;">
        🔥 NEW LEAD — Jolly Phone
      </div>
      <div style="border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;padding:18px;">
        <table style="border-collapse:collapse;width:100%;">
          <tr><td style="padding:6px 12px 6px 0;color:#666;width:110px;">Name</td>
              <td style="padding:6px 0;font-weight:600;">${esc(name)}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666;">Email</td>
              <td style="padding:6px 0;font-weight:600;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
          ${business ? `<tr><td style="padding:6px 12px 6px 0;color:#666;">Business</td>
              <td style="padding:6px 0;font-weight:600;">${esc(business)}</td></tr>` : ""}
        </table>
        ${message ? `<p style="margin:14px 0 4px;color:#666;font-size:13px;text-transform:uppercase;letter-spacing:.08em;">What they want handled</p>
        <p style="margin:0;line-height:1.55;">${esc(message)}</p>` : ""}
        <p style="margin:18px 0 0;font-size:13px;color:#999;">Reply directly to this email to reach them.</p>
      </div>
    </div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: CONTACT_EMAIL_FROM,
        to: CONTACT_EMAIL_TO.split(",").map((s) => s.trim()),
        reply_to: email,
        subject: `New lead — ${name}${business ? " (" + business + ")" : ""}`,
        html,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      console.error("Resend failed:", r.status, detail);
      return res.status(502).json({ ok: false, error: "send_failed" });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("contact error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}
