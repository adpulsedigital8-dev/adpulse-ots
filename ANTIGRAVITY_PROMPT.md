# Prompt for Google Antigravity

Paste everything below the line into Antigravity with this folder open as the workspace.

---

You are working on **AdPulse OOH Tracking System (AdPulse OTS)**, a production web app for AdPulse IMC,
an outdoor-advertising agency in Karachi. It is already fully built and working. Your job is to take it
live on **Vercel + Supabase** and then add a few improvements, **without rewriting or redesigning the app**.

## What already exists (read these first)
- `README.md`: deployment steps and the security model.
- `public/index.html`: the entire app: UI, CSS design system (AdPulse red/teal themes), and all logic
  (capture with watermark, Site Agent, sites, campaigns, client portal, presentation studio, campaign alerts agent).
- `public/claude-shim.js`: backend adapter. The app calls `window.claude.use("db" | "assets" | "user" | "sample" | "downloads")`.
  The shim implements those with Supabase (table `public.docs`, storage bucket `media`, Auth, table `public.members`)
  and the Vercel function `api/sample.js`. **Keep this API contract.** If you change storage, change it inside the shim only.
- `supabase/schema.sql`: tables, Row Level Security, triggers, storage policies. `supabase/seed.sql`: current data.
- `api/sample.js`: server-side Claude call for "Scan photo with AI" (admins only).

## Rules
1. Do not change the app's look, colors, fonts, animations, texts or workflows unless a task below says so.
2. Security stays in the database (RLS). Never put the Anthropic key or a Supabase service-role key in `public/`.
3. Clients (role `client`) must never be able to read `sites/*`, `campaigns/*`, `clients/*`, `settings/*` or `decks/*`.
   After every change, test with a client account that it only sees its own `portal/u_<id>` data.
4. Keep the app working on a 390 px wide phone: no horizontal scroll, touch targets at least 44 px.
5. Make small commits with clear messages.

## Task 1: Deploy (do this first, step by step with me)
Follow README steps 1 to 5. Ask me for the Supabase URL, anon key and project ref, then:
- fill `public/config.js` and the `/_blob/` rewrite in `vercel.json`
- walk me through running `schema.sql` then `seed.sql` in the Supabase SQL editor
- set the Vercel env vars and deploy
- verify: sign in (magic link), first account is admin, sites load, a status change syncs live
  between two browsers, a photo upload shows up, PPTX and PDF export download, AI scan returns suggestions.

## Task 2: Team management page (admin only)
Add a **Team** page under Settings: list rows from `public.members` (name, email, role, joined), let an admin
switch a person between **Team (admin)** and **Client**, and remove access. Use the existing card/chip/button
styles. Add an RLS-safe RPC in `schema.sql` for role changes that refuses to demote the last admin.

## Task 3: Real map
Replace the schematic Karachi map (`mapHTML()` and `pinPop()` in index.html) with **Leaflet + OpenStreetMap**
tiles. Keep the same colored status pins, drop-in animation, and the pop-up card (photo, code, status, "Open site").
Use it on the Dashboard, Sites (Map view) and the client portal. Fit bounds to the visible sites.

## Task 4: Offline install (PWA)
Add a service worker that caches the app shell (index.html, claude-shim.js, icons, fonts) so the app opens
without internet. The capture upload queue already persists in IndexedDB (`QDB` in index.html) and retries
when back online; keep that behaviour.

## Task 5 (optional, later): code structure
Split `public/index.html` into modules with Vite (css, capture, sites, campaigns, studio, portal, agent),
keeping behaviour identical. Only do this after Tasks 1 to 4 are live and tested.

## Test checklist before every deploy
- Phone (390 px): capture a photo and a video, Site Agent suggests a match, Confirm & save works.
- Offline: turn on airplane mode, capture, reload, turn internet back on: the capture uploads by itself.
- Admin: create a campaign with dates, sites get booked; campaign alert popup appears for campaigns ending in 7 days.
- Client account: sees only its campaigns; cannot load other data even from the browser console
  (`await (await claude.use("db")).collection("sites").get()` must return 0 docs).
- Presentation: PPTX opens in PowerPoint with logo, photos and OTS box; PDF matches.
