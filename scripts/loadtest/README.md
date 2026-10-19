# CAPS2 load smoke (Locust)

GET-only after one login per virtual user. **Do not run against the live/Neon production database or production API unless you mean to.**

## Setup (PowerShell)

```powershell
cd C:\Users\Janvie\Project\CAPS2
python -m pip install locust
$env:LOADTEST_EMAIL = "your-test-user@example.com"
$env:LOADTEST_PASSWORD = "your-password"
```

## Run against a URL you choose

Default shape: **25 users**, spawn **5/s**, run **2 minutes**.

```powershell
cd C:\Users\Janvie\Project\CAPS2
locust -f scripts/loadtest/locustfile.py `
  --host https://YOUR-API-HOST `
  --users 25 `
  --spawn-rate 5 `
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
