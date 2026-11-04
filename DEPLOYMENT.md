# Deploying BMSC Online (Free Tier)

Put the app online with **Neon** (database) + **Render** (API) + **Cloudflare Pages** (frontend + PWA), on a domain managed in **Cloudflare**, with email sent through **Resend**. All have free tiers.

```
Phone/Browser  →  app.<domain> (Cloudflare Pages, PWA)  →  api.<domain> (Render, Flask API)  →  Neon (PostgreSQL)
                                                              └→  Resend (email from noreply@<domain>)
```

This project: app `https://app.brothersmachining.net`, API `https://api.brothersmachining.net`.
All accounts (GitHub organization, Cloudflare, Render, Neon, Resend, UptimeRobot) belong to the shop's own Google account, not a developer's.

**Important:** QR camera scanning requires **HTTPS**. Both Pages and Render serve HTTPS, so the worker scan feature works on mobile.

---

## Part 1 — Push code to GitHub

1. Create a repo (this project: `bmsc-system/Capstone`, in the shop's GitHub organization)
2. In PowerShell:

```powershell
cd C:\Users\Janvie\Project\CAPS2
git add .
git commit -m "Initial BMSC platform with PWA"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/CAPS2.git
git push -u origin main
```

---

## Part 2 — Database (Neon — free PostgreSQL)

1. Sign up at https://neon.tech
2. Create a project → name it `bmsc`
3. Copy the **connection string** (looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`)

Keep this for Render in Part 3.

---

## Part 3 — Backend API (Render — free)

1. Sign up at https://render.com
2. **New → Blueprint** (or Web Service)
3. Connect your GitHub repo
4. Render reads [`render.yaml`](render.yaml) automatically (it sets `plan: free`), or create a Web Service manually with **Instance Type: Free**:

| Setting | Value |
|---------|-------|
| Root Directory | `api` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt && flask db upgrade` |
| Start Command | `gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120` |

One gunicorn worker with 8 threads is enough on the free instance. Sign-in, PIN and reset limits are stored in the database, so they stay correct if more workers are added later. If the service was created by hand rather than from the Blueprint, set this start command in the Render dashboard too, and set **Health Check Path** to `/api/v1/health`.

5. **Environment variables** on Render:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Neon connection string |
| `SECRET_KEY` | Random long string |
| `JWT_SECRET_KEY` | Another random long string |
| `CORS_ORIGINS` | `https://app.<domain>` (comma-separate extra origins, e.g. the `*.pages.dev` address) |
| `FRONTEND_URL` | `https://app.<domain>` (used in invitation and reset links) |
| `PUBLIC_APP_URL` | `https://app.<domain>` (the email header logo loads from here) |
| `INVITATION_TOKEN_PEPPER` | Random long string (keep it: changing it voids invitation and reset links already sent) |
| `FLASK_APP` | `wsgi.py` |
| `FLASK_ENV` | `production` |
| `TRUSTED_PROXY_COUNT` | `1` (Render's proxy; lets the API see the client's real address) |
| `EMAIL_BACKEND` | `resend` (see Part 6) |
| `RESEND_API_KEY` | Resend API key with sending access |
| `MAIL_FROM` | `noreply@<domain>` |
| `MAIL_REPLY_TO` | The shop's own email, where client replies should go |
| `NOTIFICATIONS_ENABLED` | `true` to send email; leave unset to only log |

Keep `SECRET_KEY` and `JWT_SECRET_KEY` the same when moving the API to a new service, or everyone is signed out and workers set up their PIN again.

6. Deploy, then add the custom domain: **Settings → Custom Domains → Add** `api.<domain>`. In Cloudflare DNS add a **CNAME** `api` → `<service>.onrender.com` with **DNS only (grey cloud)** so Render can issue the certificate. Health check: `https://api.<domain>/api/v1/health` (database: `/api/v1/health/db`).

7. **Create the first Admin** (one time) — Render Shell, or locally pointing at Neon:

```powershell
cd api
.venv\Scripts\activate
flask create-admin
```

It asks for email, password (hidden, asked twice), full name and mobile number. Sign in as that Admin and invite everyone else from **Users**.

`flask seed` **refuses to run** when `FLASK_ENV` is `production` (or unset). Use it only on a local development database (`FLASK_ENV=development`) with seed passwords set via `SEED_*_PASSWORD` in `api/.env`.

The seed is currently the only thing that creates machine types and operation types. A brand-new live database therefore has none until they are added; the existing live database already has them.

**Disabling demo accounts on a database that was seeded earlier:** run `api/scripts/disable_demo_accounts.py` (see the docstring at the top of that file). It disables every `@bmsc.local` demo account except one Admin and sets that Admin's password from a hidden prompt.

---

## Part 4 — Frontend + PWA (Cloudflare Pages — free)

1. Sign up at https://dash.cloudflare.com (the same account that holds the domain)
2. **Compute → Workers & Pages → Create → Pages → Import an existing Git repository**, choose the repo
3. Settings:

| Setting | Value |
|---------|-------|
| Root directory | `web` |
| Framework preset | React (Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |

4. **Environment variables:**

| Key | Value |
|-----|-------|
| `VITE_API_BASE_URL` | `https://api.<domain>/api/v1` |
| `NODE_VERSION` | `22` |

`VITE_API_BASE_URL` is read at build time: after changing it, **Retry deployment**.

5. Deploy, then **Custom domains → Set up a custom domain** → `app.<domain>`.

Security headers (CSP, HSTS) come from [`web/public/_headers`](web/public/_headers). Its `connect-src` must list the API address, or the browser blocks every request.

6. **Go back to Render** → set `CORS_ORIGINS`, `FRONTEND_URL` and `PUBLIC_APP_URL` to `https://app.<domain>` → redeploy API.

---

## Part 5 — Install as PWA on phone

1. Open `https://app.<domain>` on your phone (Chrome or Safari)
2. **Android Chrome:** Menu → "Install app" or "Add to Home screen"
3. **iPhone Safari:** Share → "Add to Home Screen"

The app opens full-screen like a native app. Workers can use **Scan Tool** from the home screen.

---

## PWA features included

- Installable on mobile/desktop (Add to Home Screen)
- Offline shell caching (app loads even with poor signal)
- Standalone display (no browser bar)
- Auto-updates when you redeploy

Configured in [`web/vite.config.ts`](web/vite.config.ts) via `vite-plugin-pwa`.

---

## Test locally as PWA

```powershell
cd web
npm install
npm run build
npm run preview
```

Open `http://localhost:4173` — Chrome DevTools → Application → Manifest to verify PWA.

---

## Part 6 — Email from the shop's domain (Resend — free)

1. Sign up at https://resend.com → **Domains → Add Domain** → `<domain>` → **Auto configure** with Cloudflare (adds the SPF and DKIM records) → wait for **Verified**.
2. In Cloudflare DNS add a **TXT** `_dmarc` → `v=DMARC1; p=none;`
3. **API Keys → Create API Key** with **Sending access** for `<domain>`; put it in `RESEND_API_KEY` on Render and set `EMAIL_BACKEND=resend`, `MAIL_FROM=noreply@<domain>`, `MAIL_REPLY_TO=<shop email>`.
4. Send a test (Admin → `POST /api/v1/admin/notifications/test`) and check **Show original** in Gmail: SPF, DKIM and DMARC should all pass.

The free plan allows 100 emails a day and 3,000 a month. `EMAIL_BACKEND=gmail_api` (Gmail API with an OAuth refresh token) still works as a fallback.

---

## Part 7 — Uptime monitoring (UptimeRobot — free)

Add HTTP(s) monitors for `https://api.<domain>/api/v1/health` every 5 minutes (also keeps the free Render instance awake), `https://api.<domain>/api/v1/health/db` every 60 minutes (wakes Neon, so not more often), and `https://app.<domain>`.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Login fails online | Check `VITE_API_BASE_URL` matches the API URL + `/api/v1`, then Retry deployment |
| CORS error | Set `CORS_ORIGINS` on Render to the exact app URL (no trailing slash) |
| Requests blocked in the browser console (CSP) | Add the API address to `connect-src` in `web/public/_headers` |
| API sleeps (slow first load) | Render free tier spins down after 15 minutes idle — the UptimeRobot monitor keeps it awake |
| Render certificate stays pending | The Cloudflare `api` record must be **DNS only** (grey cloud) |
| Emails go to spam | Check SPF/DKIM/DMARC pass; a new domain builds trust over the first weeks |
| Camera won't scan | Must use HTTPS, not http:// |
| Empty database | Run `flask create-admin` against Neon `DATABASE_URL` (`flask seed` is refused in production) |

---

## Optional upgrades later

- **Always-on, faster API** — Render paid plan (~$7/mo) removes cold starts and speeds up analytics
- **Redis** — for caching across several API workers
