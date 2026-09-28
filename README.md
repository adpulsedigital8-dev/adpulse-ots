# AdPulse OOH Tracking System (AdPulse OTS)

Field executives capture billboard photos and videos from their phones; the office manages sites,
bookings and campaigns, generates branded PowerPoint/PDF decks, and each client gets a private
dashboard showing only their own sites.

**Stack:** static web app (`public/`) + Supabase (database, login, photo storage) + one Vercel
function (`api/sample.js`) for the AI photo scan.

```
public/
  index.html            the whole app (UI + logic)
  claude-shim.js        backend adapter: connects the app to Supabase and /api/sample
  config.js             YOUR Supabase URL + anon key (edit this)
  manifest.webmanifest  install-to-home-screen (PWA)
  icons/
api/sample.js           AI "Scan photo with AI" (keeps the Anthropic key on the server)
supabase/schema.sql     tables, security rules, storage bucket
supabase/seed.sql       your current data (18 sample sites, 3 campaigns, settings, 1 site, 1 client)
vercel.json             hosting config + /_blob/ photo links
```

Without `config.js` filled in, the app still opens in **offline demo mode** (data stays in that browser).

---

## Go live in 6 steps

### 1. GitHub
Create a repo (e.g. `adpulse-ots`) and push this folder to it.

### 2. Supabase
1. Create a project at supabase.com. Pick a region close to Pakistan (Mumbai or Singapore).
2. **SQL Editor** → paste and run `supabase/schema.sql`, then `supabase/seed.sql`.
3. **Authentication → Providers**: keep **Email** on (magic link). Optional: turn on **Google**.
4. **Authentication → URL Configuration**: set **Site URL** to your Vercel address
   (e.g. `https://adpulse-ots.vercel.app`, later your own domain) and add it under **Redirect URLs**.
5. **Authentication → Emails → SMTP**: for real use, add your own SMTP (e.g. your company mail).
   Supabase's built-in email only sends a few sign-in emails per hour.
6. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 3. Put your keys in two files
- `public/config.js` → `supabaseUrl`, `supabaseAnonKey` (and `googleLogin: true` if you enabled Google).
- `vercel.json` → replace `YOUR-PROJECT-REF` in the `/_blob/` rewrite with your project ref
  (the part before `.supabase.co`).

Commit and push.

### 4. Vercel
1. **Add New → Project** → import the GitHub repo. Framework preset: **Other**. No build command.
2. **Environment Variables**:
   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | from console.anthropic.com |
   | `SUPABASE_URL` | same as config.js |
   | `SUPABASE_ANON_KEY` | same as config.js |
   | `ANTHROPIC_MODEL` | optional, default `claude-sonnet-5` |
3. Deploy. Every push to `main` redeploys automatically.

### 5. First sign-in
Open the site and sign in with your email. **The first account becomes admin.**
Everyone after that starts as a client.

- **Team members** (field executives, planners): they sign in once, then in Supabase
  **Table Editor → members** set their `role` to `admin`.
- **Clients**: they sign in, type their company name and request access. You approve them on the
  **Clients** page and pick their campaigns. They only ever see those sites, dates, photos and OTS.

### 6. Own domain (optional)
Vercel → Project → Domains → add e.g. `ots.adpulse.pk`, then update the Supabase Site URL and Redirect URLs.

---

## How security works
- All rules live in the database (Row Level Security in `schema.sql`), not in the browser.
- `admin` = your team: reads and writes everything.
- `client` = reads only `portal/u_<their id>` (a snapshot the app builds from their campaigns) and
  their own access request. Clients cannot read the `sites`, `campaigns` or `clients` data.
- Photos/videos: only admins can upload or delete. Files are served from a public bucket under long
  random names. If you need them fully private, switch the bucket to private and serve signed URLs.
- The Anthropic key never reaches the browser; `/api/sample` only runs for signed-in admins.

## Things that now work better than on claude.ai
- **Use my current location** reads the phone's GPS directly (HTTPS on your own domain).
- **Install on phone**: open the site in Chrome/Safari → Add to Home Screen.
- Downloads (PowerPoint, PDF, CSV) save straight to the device.

## Costs to plan for (check current prices)
- Vercel: the free Hobby plan is for non-commercial use; a business needs **Pro**.
- Supabase: free plan has 1 GB file storage, which photos/videos fill quickly; **Pro** has 100 GB.
- Anthropic API: pay per AI scan.
