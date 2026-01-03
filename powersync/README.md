# PowerSync service (local dev)

This folder contains the PowerSync service configuration and a concise developer guide for running PowerSync with this demo. The project uses PowerSync as a read-only replication layer: the NestJS backend is the authoritative write API and PowerSync replicates Postgres changes to each client's local SQLite database.

## Quick start
1. Ensure Postgres is running on the host at `localhost:5432` and the database `minimaldemo` exists.
2. Create the PowerSync role and apply migrations (publication + optional RLS):

```bash
-- in Postgres (psql or equivalent)
CREATE ROLE powersync_user WITH LOGIN PASSWORD 'powersync123';
ALTER ROLE powersync_user WITH REPLICATION;
GRANT CONNECT ON DATABASE minimaldemo TO powersync_user;
GRANT USAGE ON SCHEMA public TO powersync_user;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_user;
```

3. Start the backend API:

```bash
cd backend
npm run start:dev
```

4. Start PowerSync (docker):

```bash
cd powersync
docker compose up -d
```

5. Tail PowerSync logs to confirm it's running:

```bash
docker compose logs powersync --follow
```

## Key files
- `config/config.yaml` — PowerSync config (replication, sync rules, client auth)
- `docker-compose.yml` — PowerSync + MongoDB services

## Important PowerSync configuration notes

- Use `host.docker.internal` when connecting from PowerSync (Docker) to the host Postgres instance. Example:

```yaml
replication:
  connections:
    - type: postgresql
      uri: postgresql://powersync_user:powersync123@host.docker.internal:5432/minimaldemo
      sslmode: disable
```

- JWT validation (symmetric HS256) must match your backend `JWT_SECRET`. In `config.yaml` we use the base64url-encoded form of the secret:

```yaml
client_auth:
  jwks:
    keys:
      - kty: oct
        alg: HS256
        k: c3VwZXJzZWNyZXQ  # base64url(supersecret)
  audience: ['powersync']
  jwt_claims:
    user_id: sub
```

Notes:
- `k` must be base64url-encoded (not plain text). Example encoding for `supersecret` → `c3VwZXJzZWNyZXQ`.
- `audience` must match the `aud` claim the backend signs into the JWT.
- `jwt_claims.user_id: sub` ensures PowerSync uses the JWT `sub` claim as the `user_id` for bucket creation and filtering.

## Sync rules — per-user buckets (CRITICAL)

Do not use queries that enumerate all users (e.g. `SELECT id FROM "User"`) — that creates buckets for every user and can cause clients to download other users' data. Instead use `token_parameters.user_id` so a client creates only their own bucket:

```yaml
sync_rules:
  content: |
    bucket_definitions:
      user_products:
        parameters: SELECT token_parameters.user_id
        data:
          - SELECT * FROM "Product" WHERE "ownerId" = bucket.user_id
```

This ensures each authenticated client only syncs rows where `ownerId` equals the authenticated user's ID.

## Backend (NestJS) highlights

- JWT sign options (must match PowerSync config):

```ts
signOptions: { expiresIn: '1d', audience: 'powersync' }
```

- JWT payload must include `sub: <user.id>`; the project sets this in `AuthService` when signing tokens.

## Frontend (React) highlights

- Initialize PowerSync only after a user is authenticated. Recreate the PowerSync client whenever the auth token changes so each user gets a fresh, per-user connection (and old user's data is cleared).
- Use `PowerSyncContext` (from `@powersync/react`) to provide the initialized `PowerSyncDatabase` instance to components.
- Use the provided React hooks from `@powersync/react`:
  - `usePowerSync()` — access the client instance
  - `useStatus()` — connection/sync status
  - `useQuery()` / `useSuspenseQuery()` — reactive queries that automatically update when data changes

Example patterns implemented in this demo:

- App initialization uses an auth-aware `AppContent` that:
  - disconnects and clears PowerSync on logout
  - initializes PowerSync on login using the latest JWT token

- Components call hooks only when PowerSync is available. Use a small child component that renders when the client is ready so hooks are not invoked conditionally.

## RLS (Row Level Security)

- Primary enforcement in this setup is at the sync layer (sync rules using the token-derived `user_id`). This prevents other users' rows from being sent to a client.
- For defense-in-depth enable DB-level RLS and set an RLS policy like:

```sql
ALTER TABLE public."Product" ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_owner ON public."Product"
  USING (("ownerId" = current_setting('app.user_id')::uuid));
```

PowerSync can set the `app.user_id` DB session variable when it authenticates if you return `postgres.session_variables` from an auth endpoint.

## Troubleshooting / common issues

- Users seeing each other's products: ensure sync rules use `token_parameters.user_id` (not a query that returns all users).
- "Could not find an appropriate key": ensure the `k` value is base64url-encoded.
- "JWT missing aud": add `audience: 'powersync'` to backend JWT sign options.
- PowerSync can't reach Postgres: use `host.docker.internal` for Docker -> host connections.
- React hook errors when PowerSync is null: only render components that call `useQuery`/`useStatus` once `usePowerSync()` returns a non-null client.

## Commands

Start backend:
```bash
cd backend
npm run start:dev
```

Start frontend:
```bash
cd frontend
npm run dev
```

Start/Restart PowerSync:
```bash
cd powersync
docker compose up -d
docker compose restart powersync
```

View logs:
```bash
docker compose logs powersync --follow
```

## Testing RLS

1. Create User A and add products in the backend.
2. Create User B and add products.
3. Log in as User A → dashboard should show only User A's products.
4. Log out, log in as User B → dashboard should show only User B's products.
5. Check PowerSync logs to see which `user_id` is associated with the connection and confirm only that user's bucket is active.

## Notes

- This README focuses on development setup. For production, secure secrets, enable SSL, and harden configuration (see implementation guide file `POWERSYNC_IMPLEMENTATION_GUIDE.md`).

---
Updated to reflect latest configuration: per-user buckets using `token_parameters.user_id`, JWT claim mapping `jwt_claims.user_id: sub`, and the frontend pattern that recreates PowerSync when the auth token changes.
