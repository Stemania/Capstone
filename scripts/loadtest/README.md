# CAPS2 load smoke (Locust)

GET-only after one login per virtual user. Logins are spaced (default 7 seconds) so the API's 10-per-minute per-IP login limit is not tripped. Each user reuses its token. **Do not run against the live/Neon production database or production API unless you mean to.** Do not lower that limit to make a run pass.

## Setup (PowerShell)

```powershell
cd C:\Users\Janvie\Project\CAPS2
python -m pip install locust
$env:LOADTEST_EMAIL = "your-test-user@example.com"
$env:LOADTEST_PASSWORD = "your-password"
# Optional extra accounts, round-robin: "email:password;email:password"
# $env:LOADTEST_ACCOUNTS = "one@example.com:secret;two@example.com:secret"
```

## Run against a URL you choose

Default shape: **25 users**, run **2 minutes**. Leave the spawn rate high; the script itself spaces logins.

```powershell
cd C:\Users\Janvie\Project\CAPS2
locust -f scripts/loadtest/locustfile.py `
  --host https://YOUR-API-HOST `
  --users 25 `
  --spawn-rate 25 `
  --run-time 2m `
  --headless `
  --only-summary
```

Replace `https://YOUR-API-HOST` with the API origin (no `/api/v1` suffix — paths in the script include it).

Locust prints **p50/p95** response times per named endpoint and the overall **error rate** in the summary.

## Local dashboard timing (NFR-002)

From `api/` with the Flask app reachable at `http://localhost:5000`:

```powershell
cd C:\Users\Janvie\Project\CAPS2\api
$env:LOADTEST_EMAIL = "..."
$env:LOADTEST_PASSWORD = "..."
.\.venv\Scripts\python.exe ..\scripts\loadtest\measure_dashboard.py
```
