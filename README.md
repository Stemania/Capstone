# Brothers Machine Shop — Production Scheduling Platform

Web-based production scheduling with efficiency analytics foundation, job order management, worker progress tracking, and QR tool tracking.

## Tech Stack

- **Frontend:** React + TypeScript + Vite + Ant Design
- **Backend:** Python Flask (Blueprints) + SQLAlchemy
- **Database:** PostgreSQL
- **Cache:** Redis (wired for future session/queue use)
- **Auth:** JWT access + refresh tokens, bcrypt, RBAC

## Prerequisites

- Docker Desktop (for PostgreSQL + Redis)
- Python 3.11+
- Node.js 18+

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d
```

### 2. Backend setup

```bash
cd api
python -m venv .venv

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
copy .env.example .env

flask db init          # first time only
flask db migrate -m "Initial schema"
flask db upgrade
flask seed
python wsgi.py
```

API runs at `http://localhost:5000`.

### 3. Frontend setup

```bash
cd web
copy .env.example .env
npm install
npm run dev
```

Web app runs at `http://localhost:5173`.

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@bmsc.local | Admin123! |
| Office Staff | office@bmsc.local | Office123! |
| Production Worker | worker1@bmsc.local | Worker123! |

Additional workers: worker2@bmsc.local … worker4@bmsc.local (same password).

## Environment Variables

### API (`api/.env`)

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| REDIS_URL | Redis connection string |
| SECRET_KEY | Flask secret key |
| JWT_SECRET_KEY | JWT signing key |
| CORS_ORIGINS | Allowed frontend origins |

### Web (`web/.env`)

| Variable | Description |
|----------|-------------|
| VITE_API_BASE_URL | Backend API base URL |

## Running Tests

```bash
cd api
pytest
```

## API Documentation

Import `postman/BMSC_API.postman_collection.json` into Postman. Set the `baseUrl` variable to `http://localhost:5000/api/v1`.

## Project Structure

```
/api   — Flask REST API
/web   — React SPA
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module organization and extension points.

## Deploy Online + PWA

See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step instructions to deploy on **Neon + Render + Vercel** (free tier) and install as a mobile PWA.

## Features (Current Scope)

1. **Job Order Creation** — Admin/Office Staff create jobs with operations and skill-based worker suggestions
2. **Worker Progress** — Production workers view assigned jobs and update operation status
3. **QR Tool Tracking** — Workers scan tools to borrow/return; Admin views logs and custody

## Out of Scope (Future Capstone Modules)

- Efficiency Analytics
- Inventory Management
- SMS Notifications
