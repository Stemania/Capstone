# Deploying BMSC Online (Free Tier)

Put the app online with **Neon** (database) + **Render** (API) + **Vercel** (frontend + PWA). All have free tiers suitable for capstone demos.

```
Phone/Browser  →  Vercel (PWA)  →  Render (Flask API)  →  Neon (PostgreSQL)
```

**Important:** QR camera scanning requires **HTTPS**. Once deployed on Vercel, the worker scan feature works on mobile.

---

## Part 1 — Push code to GitHub

1. Create a repo at https://github.com/new
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
4. Render reads [`render.yaml`](render.yaml) automatically, or create manually:

| Setting | Value |
|---------|-------|
| Root Directory | `api` |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt && flask db upgrade` |
| Start Command | `gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 1 --threads 8 --timeout 120` |

Keep **one** gunicorn worker: the sign-in limit (10 attempts per minute) is counted in the worker's memory, so a second worker would double it. Threads keep requests concurrent. If the service was created by hand rather than from the Blueprint, set this start command in the Render dashboard too.

5. **Environment variables** on Render:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Neon connection string |
| `SECRET_KEY` | Random long string |
| `JWT_SECRET_KEY` | Another random long string |
| `CORS_ORIGINS` | `https://YOUR-APP.vercel.app` (set after Part 4) |
| `FLASK_APP` | `wsgi.py` |
| `FLASK_ENV` | `production` |
| `TRUSTED_PROXY_COUNT` | `1` (Render's proxy; lets the API see the client's real address) |

6. Deploy. Copy your API URL, e.g. `https://bmsc-api.onrender.com`

7. **Create the first Admin** (one time) — Render Shell, or locally pointing at Neon:

```powershell
cd api
.venv\Scripts\activate
flask create-admin
```

It asks for email, password (hidden, asked twice), full name and mobile number. Sign in as that Admin and invite everyone else from **Users**.

`flask seed` **refuses to run** when `FLASK_ENV` is `production` (or unset): it creates demo accounts whose passwords are published in this repository. Use it only on a local development database (`FLASK_ENV=development`).

The seed is currently the only thing that creates machine types and operation types. A brand-new live database therefore has none until they are added; the existing live database already has them.

**Disabling demo accounts on a database that was seeded earlier:** run `api/scripts/disable_demo_accounts.py` (see the docstring at the top of that file). It disables every `@bmsc.local` demo account except one Admin and sets that Admin's password from a hidden prompt.

---

## Part 4 — Frontend + PWA (Vercel — free)

1. Sign up at https://vercel.com
2. **Add New Project** → import your GitHub repo
3. Settings:

| Setting | Value |
|---------|-------|
| Root Directory | `web` |
| Framework | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

4. **Environment variable:**

| Key | Value |
|-----|-------|
| `VITE_API_BASE_URL` | `https://bmsc-api.onrender.com/api/v1` |

5. Deploy. You get a URL like `https://caps2.vercel.app`

6. **Go back to Render** → update `CORS_ORIGINS` to your Vercel URL → redeploy API.

---

## Part 5 — Install as PWA on phone

1. Open your Vercel URL on your phone (Chrome or Safari)
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

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Login fails online | Check `VITE_API_BASE_URL` matches Render URL + `/api/v1` |
| CORS error | Set `CORS_ORIGINS` on Render to exact Vercel URL (no trailing slash) |
| API sleeps (slow first load) | Render free tier spins down after inactivity — wait ~30s |
| Camera won't scan | Must use HTTPS (Vercel URL), not http:// |
| Empty database | Run `flask create-admin` against Neon `DATABASE_URL` (`flask seed` is refused in production) |
| Sign-in limit seems doubled | Start command must use `--workers 1` |

---

## Optional upgrades later

- **Custom domain** — Vercel + Render both support this
- **Redis** — Upstash free tier for caching
- **Always-on API** — Render paid plan (~$7/mo) prevents cold starts
