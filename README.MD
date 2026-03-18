# Minimal PowerSync Nest React Demo

An end-to-end local-first demo that combines:

- NestJS for authentication and write APIs
- PostgreSQL as the source of truth
- PowerSync for filtered replication into a local SQLite database
- React + Vite + Electron for the desktop client

The app demonstrates a practical split between writes and reads:

- Writes go to the NestJS backend, either directly through REST endpoints or through PowerSync's upload queue
- Reads come from PowerSync's local SQLite database and update reactively as PostgreSQL changes are replicated

## What This Repo Demonstrates

- JWT authentication with NestJS and Passport
- Prisma models backed by PostgreSQL UUIDs
- PowerSync replication from PostgreSQL to a local SQLite database
- Per-user and admin sync scoping with PowerSync buckets
- Offline-friendly CRUD by writing locally and uploading changes back to the backend
- A desktop shell using Electron with a React renderer

## Architecture

```text
Electron + React UI
	-> AuthContext stores JWT locally
	-> PowerSync client connects with JWT
	-> Local SQLite serves reactive reads
	-> Local writes are queued for upload

PowerSync upload queue
	-> POST /powersync/upload on NestJS backend
	-> Prisma transaction writes to PostgreSQL

PostgreSQL
	-> logical replication
	-> PowerSync service
	-> filtered sync back to each client
```

## Repository Layout

```text
backend/    NestJS API, Prisma schema, auth, products, PowerSync upload endpoint
frontend/   React + Vite + Electron client with PowerSync integration
powersync/  Docker Compose and PowerSync configuration
docs/       Implementation notes, RBAC reference, upload-flow reference
```

## Core Behavior

### Authentication

- Users register and log in through the NestJS API
- JWTs include:
	- `sub`: the user ID
	- `role`: `USER` or `ADMIN`
	- `aud`: `powersync`
- PowerSync validates those tokens using the shared HS256 secret configured in `powersync/config/config.yaml`

### Authorization and Sync Scope

The backend and PowerSync enforce access in complementary ways:

- Backend REST endpoints restrict product writes to the record owner
- PowerSync sync rules decide which rows a client can replicate locally

The current PowerSync config uses two buckets:

- `user_products`: syncs only products owned by the authenticated user
- `admin_products`: syncs all products when the authenticated user has the `ADMIN` role

That means:

- normal users only replicate their own products
- admins can replicate all products

### Read and Write Model

- The UI reads products from the local PowerSync SQLite database using reactive queries
- The current dashboard demo performs local SQLite writes first
- PowerSync uploads queued CRUD transactions to `POST /powersync/upload`
- The backend applies those operations in a Prisma transaction
- PostgreSQL changes are then replicated back through PowerSync

This gives you a realistic local-first sync loop while keeping PostgreSQL as the system of record.

## Tech Stack

### Backend

- NestJS 11
- Prisma 7
- PostgreSQL
- JWT auth with Passport
- Swagger / OpenAPI

### Frontend

- React 19
- Vite 7
- Electron 40
- `@powersync/web`
- `@powersync/react`

### Sync Layer

- PowerSync service in Docker
- MongoDB replica set for PowerSync internal storage

## Prerequisites

Install these before running the repo:

- Node.js 20+
- npm
- Docker Desktop
- PostgreSQL 15+ running locally on port `5432`

This repo does not include a PostgreSQL container. You need a local PostgreSQL instance available to both:

- the NestJS backend on `localhost:5432`
- the PowerSync container via `host.docker.internal:5432`

## Environment Variables

### Backend

Create `backend/.env` from `backend/.env.example`:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/minimaldemo?schema=public"
JWT_SECRET="supersecret"
PORT=3000
```

### Frontend

Create `frontend/.env` from `frontend/.env.example`:

```env
VITE_POWERSYNC_URL=http://localhost:8080
VITE_API_BASE_URL=http://localhost:3000
```

### PowerSync

The main PowerSync settings live in `powersync/config/config.yaml`.

Important values:

- PostgreSQL replication user: `powersync_user`
- PostgreSQL host from inside Docker: `host.docker.internal`
- PowerSync API port: `8080`
- JWT audience: `powersync`
- JWT secret encoded as base64url in the `jwks.keys[0].k` field

## Database Setup

### 1. Create the database

Create a PostgreSQL database named `minimaldemo`.

Example with `psql`:

```sql
CREATE DATABASE minimaldemo;
```

### 2. Create the PowerSync replication user

Run the following SQL against PostgreSQL:

```sql
CREATE ROLE powersync_user WITH LOGIN PASSWORD 'powersync123';
ALTER ROLE powersync_user WITH REPLICATION;

GRANT CONNECT ON DATABASE minimaldemo TO powersync_user;
GRANT USAGE ON SCHEMA public TO powersync_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_user;
```

If you later harden Row Level Security further and want the replication role to bypass it, you may also need:

```sql
ALTER ROLE powersync_user WITH BYPASSRLS;
```

### 3. Install backend dependencies and run Prisma

```powershell
cd backend
npm install
npx prisma generate
npx prisma migrate dev
```

The Prisma migrations in this repo create the application schema and the PowerSync publication.

## Local Development Quick Start

Run the stack in this order.

### 1. Start the backend

```powershell
cd backend
npm install
npm run start:dev
```

Backend URLs:

- API root: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/api`

### 2. Start PowerSync

```powershell
cd powersync
docker compose up -d
```

Check logs:

```powershell
docker compose logs powersync --follow
```

PowerSync URL:

- `http://localhost:8080`

### 3. Start the frontend Electron app

```powershell
cd frontend
npm install
npm run dev
```

What this does:

- starts the Vite dev server on port `5173`
- waits for the React app to be ready
- launches Electron and loads the Vite app inside it

## First Run Walkthrough

1. Register a new user in the app.
2. Log in.
3. Wait for PowerSync to connect.
4. Create a product from the dashboard.
5. The product is inserted locally first, uploaded to the backend, written to PostgreSQL, and then synced back through PowerSync.

## User Roles

The Prisma schema defines two roles:

- `USER`
- `ADMIN`

Newly registered accounts default to `USER`.

If you want to test admin replication behavior, promote a user manually in PostgreSQL or Prisma Studio:

```powershell
cd backend
npx prisma studio
```

Then update that user's `role` to `ADMIN`.

## API Summary

### Public auth endpoints

- `POST /auth/register`
- `POST /auth/login`

### Authenticated endpoints

- `GET /auth/profile`
- `POST /products`
- `GET /products`
- `GET /products/:id`
- `PATCH /products/:id`
- `DELETE /products/:id`
- `POST /powersync/upload`

### Health endpoint

- `GET /`

Swagger documents the backend API at `http://localhost:3000/api`.

## Product Access Rules

### Backend REST rules

- `USER` can only read and modify their own products
- `ADMIN` can read all products through `GET /products` and `GET /products/:id`
- update and delete operations are still owner-scoped in the current service implementation

### PowerSync rules

- `USER` syncs only rows where `Product.ownerId = token_parameters.user_id`
- `ADMIN` receives all products through a separate bucket

This difference is intentional for the sync demo, but it also means admin read behavior is broader in the replicated client dataset than the owner-only write behavior enforced by the upload endpoint.

## Useful Commands

### Backend

```powershell
cd backend
npm run start:dev
npm run build
npm run test
npm run test:e2e
npm run lint
npx prisma studio
```

### Frontend

```powershell
cd frontend
npm run dev
npm run build
npm run preview
npm run dist
```

### PowerSync

```powershell
cd powersync
docker compose up -d
docker compose down
docker compose restart powersync
docker compose logs powersync --follow
```

## Important Implementation Notes

### JWT and PowerSync must agree

These values must stay aligned across backend and PowerSync:

- backend `JWT_SECRET`
- PowerSync `jwks.keys[0].k`
- backend JWT `audience: 'powersync'`
- PowerSync `client_auth.audience: ['powersync']`
- backend JWT `sub`
- PowerSync `jwt_claims.user_id: sub`

If they drift, PowerSync authentication fails even if normal backend login still works.

### Why `host.docker.internal` is used

PowerSync runs inside Docker, so `localhost` inside the container refers to the container itself, not your machine.

Use this in PowerSync config:

```yaml
uri: postgresql://powersync_user:powersync123@host.docker.internal:5432/minimaldemo
```

### Linux note

If `host.docker.internal` is unavailable on Linux, add this to the PowerSync service in `powersync/docker-compose.yml`:

```yaml
extra_hosts:
	- "host.docker.internal:host-gateway"
```

## Troubleshooting

### PowerSync cannot connect to PostgreSQL

Check:

- PostgreSQL is running locally on port `5432`
- the database `minimaldemo` exists
- `powersync_user` was created and granted read access
- `powersync/config/config.yaml` uses `host.docker.internal`, not `localhost`

### PowerSync rejects JWTs

Check:

- backend `JWT_SECRET` matches the PowerSync key material
- the PowerSync `k` value is base64url-encoded
- backend JWTs include `aud: powersync`
- PowerSync `audience` includes `powersync`

### Frontend opens but product sync is empty

Check:

- the backend is running on port `3000`
- PowerSync is running on port `8080`
- `frontend/.env` points at the correct backend and PowerSync URLs
- the logged-in user actually owns products, or has `ADMIN` role

### Uploads fail

Check:

- `POST /powersync/upload` is reachable from the frontend
- the JWT is present in the request
- the product payload is valid
- backend logs for fatal versus transient processing errors

### Users see the wrong data

Check the sync rules in `powersync/config/config.yaml`.

For this repo, role-based access depends on bucket selection, not conditional SQL inside one bucket.

## Additional Documentation

If you want the lower-level implementation notes, see:

- `docs/POWERSYNC_IMPLEMENTATION_GUIDE.md`
- `docs/PowerSync_RBAC.md`
- `docs/UPLOAD_DATA_IMPLEMENTATION.md`

## Current Limitations

- PostgreSQL provisioning is not containerized in this repo
- Root-level scripts are not provided; each app is started from its own folder
- Admin users can replicate all products, but backend write operations remain owner-scoped
- The dashboard code is intentionally demo-oriented and currently favors local PowerSync writes over direct REST product writes

## Recommended Next Improvements

- add a Postgres container for one-command local startup
- add root workspace scripts for booting backend, frontend, and PowerSync together
- add seed scripts for demo users and products
- align admin write semantics between REST endpoints and PowerSync upload handling
- add automated end-to-end tests around sync and role behavior
