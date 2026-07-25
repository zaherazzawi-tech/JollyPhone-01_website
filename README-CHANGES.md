# 01_website — what changed

_July 25, 2026_

## ⚠️ READ THIS FIRST — do not replace your whole folder

Your upload only included the **root-level files**. These subfolders were not in it,
and they are still needed:

| Missing | Used by |
|---|---|
| `api/demo-call.js` | the orb's "Get a call" button (`index.html` line ~957) |
| `api/contact.js` | the Contact Sales form (`index.html` line ~1047) |
| `uploads/Oxanium/…ttf` | the self-hosted Oxanium `@font-face` |
| `_ds/nocturne-…/` | `ds-base.js` (see note at the bottom) |

**Copy the files from this zip into your existing folder. Do not delete and replace it**
— that would remove your two working Vercel functions and the site's fonts.

---

## Changed files

### `index.html` — modified
Two small additions, nothing else touched:

1. **Footer link.** A "Client login" link next to the email address, separated by a
   small copper dot. Points at `dashboard.html`.
2. **Footer CSS.** Four rules added directly under the existing `footer` rule:
   `.foot-links`, `.foot-links .sep`, `.client-login`, and its hover.

The link sits in the footer rather than the nav on purpose: it's useful to clients
and invisible to prospects, and it needs no auth check on the marketing page. If you'd
rather it be a nav item, move the `<a class="client-login">` into `<nav class="nav">`
— the nav's existing link styles will pick it up.

### `dashboard.html` — **now the real client dashboard** (was the mock)
Supabase login, live call feed, detail drawer, notifications.

**Before this works you must fill in two values** at the top of the `<script>` block:

```js
const SUPABASE_URL      = 'https://YOUR-PROJECT-REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
```

Both come from Supabase → Settings → API. The anon key is safe in page source —
row-level security is what protects the data. **Never put the service role key here.**

Until they're filled in, the page shows a "Not configured yet" screen rather than
failing silently.

### `demo-dashboard.html` — **new name for the old mock**
The fake-data sales prop that was previously at `dashboard.html`. Renamed so the real
dashboard could take the obvious URL.

Reasoning: a client typing `jollyphone.com/dashboard` should reach *their* dashboard,
not a page of invented restaurant calls. The mock is something you show on your own
laptop during a pitch — it doesn't need the primary URL.

If you had linked to `dashboard.html` as the demo anywhere, update it to
`demo-dashboard.html`.

---

## Unchanged but worth flagging

- **`hello@jollyphone.com`** still appears in three places (contact fallback, footer,
  and the mailto fallback in the form JS). Now that the domain is verified you can
  swap these for a real address. Left alone because I don't know which you want.
- **FAQ, "Does it sound like a robot?"** — the answer currently reads *"No. Most callers
  never notice."* Your own punch list flagged this as implying deception, since the
  agents do disclose they're AI. The following sentence already handles it honestly;
  it's the opener that oversells. Left alone as it's your copy decision.
- **`ds-base.js`** loads a `_ds/nocturne-…` bundle that wasn't in the upload. Every
  style the page uses is inline in `index.html`, so this looks like a leftover from the
  Claude Design phase. If that folder doesn't exist in your repo, the script is a
  harmless console error you can delete — but check before removing it.

---

## Deploy

1. Copy `index.html`, `dashboard.html`, and `demo-dashboard.html` into `01_website/`
2. Fill in the two Supabase values in `dashboard.html`
3. Commit and push to `JollyPhone-01_website`
4. Vercel auto-deploys
5. Visit `jollyphone.com/dashboard.html` and sign in

Verify after deploy: the footer link appears, sign-in works, and your test call from
the `azzawi` client shows up in the feed.
