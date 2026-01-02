# PowerSync Implementation Guide

## Overview
This project implements PowerSync as a **read-only replication layer** between PostgreSQL and the frontend's local SQLite database. All Create, Update, Delete operations go through the NestJS backend API, and PowerSync automatically syncs changes to connected clients in real-time.

## Architecture

```
User Browser (React)
  └─> PowerSync SQLite (local, read-only)
       └─> PowerSync Service (Docker) ←─ logical replication
            └─> PostgreSQL (localhost)
                 ↑
                 └─ NestJS API (write operations) ←─ User API calls
```

## Key Components

### 1. Backend (NestJS)

#### JWT Configuration
**File:** `backend/src/auth/auth.module.ts`

```typescript
signOptions: {
  expiresIn: '1d',
  audience: 'powersync',  // REQUIRED for PowerSync JWT validation
}
```

**Critical points:**
- JWT must include `sub` claim with user ID (automatically set in `auth.service.ts`)
- JWT must include `aud: 'powersync'` claim (configured in signOptions)
- Secret must match PowerSync config (`JWT_SECRET` in `.env`)

#### PowerSync Auth Endpoint
**File:** `backend/src/powersync/powersync.controller.ts`

```typescript
@Get('auth')
auth(@CurrentUser() user: { id: string }) {
  return {
    user_id: user.id,  // PowerSync uses this to identify the user
  };
}
```

**Purpose:** JWT-protected endpoint that PowerSync can optionally call (not used in our symmetric key setup, but good for validation)

#### Database Schema
**File:** `backend/prisma/schema.prisma`

- Use **native PostgreSQL UUID types**: `@db.Uuid`
- Product has `ownerId` field linking to User
- Enables Row Level Security at database level

#### Database Migration
**File:** `backend/prisma/migrations/20260102130000_add_products_rls/migration.sql`

```sql
-- Create publication for logical replication
CREATE PUBLICATION powersync FOR ALL TABLES;

-- Enable Row Level Security
ALTER TABLE "Product" ENABLE ROW LEVEL SECURITY;

-- Create RLS policy (optional - PowerSync enforces at sync level)
CREATE POLICY products_owner ON "Product"
  USING (("ownerId" = current_setting('app.user_id')::uuid));
```

**Important:** RLS at database level is optional since PowerSync enforces filtering at the sync bucket level. However, it provides defense-in-depth.

#### Database User Setup
Run these SQL commands to create the PowerSync replication user:

```sql
-- Create role with replication permissions
CREATE ROLE powersync_user WITH LOGIN PASSWORD 'powersync123';
ALTER ROLE powersync_user WITH REPLICATION;

-- Grant database access
GRANT CONNECT ON DATABASE minimaldemo TO powersync_user;
GRANT USAGE ON SCHEMA public TO powersync_user;

-- Grant read-only access to all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_user;

-- Optional: Bypass RLS for PowerSync (if using database-level RLS)
ALTER ROLE powersync_user WITH BYPASSRLS;
```

### 2. PowerSync Service (Docker)

#### Docker Compose
**File:** `powersync/docker-compose.yml`

- PowerSync service on port 8080
- MongoDB 7.0 replica set for internal sync bucket storage
- Uses `host.docker.internal` to connect to local PostgreSQL

#### PowerSync Configuration
**File:** `powersync/config/config.yaml`

**Database Connection:**
```yaml
replication:
  connections:
    - type: postgresql
      uri: postgresql://powersync_user:powersync123@host.docker.internal:5432/minimaldemo
      sslmode: disable
```

**Critical: Use `host.docker.internal` instead of `localhost` to connect to host machine's PostgreSQL from Docker.**

**Sync Rules:**
```yaml
sync_rules:
  content: |
    bucket_definitions:
      user_products:
        # CRITICAL: Only create bucket for authenticated user
        parameters: SELECT token_parameters.user_id
        data:
          - SELECT * FROM "Product" WHERE "ownerId" = bucket.user_id
```

**Why this matters:**
- `SELECT token_parameters.user_id` creates ONE bucket per authenticated user (from JWT)
- ❌ Wrong: `SELECT id as user_id FROM "User"` creates buckets for ALL users
- Each user only syncs their own products based on `ownerId`

**JWT Authentication:**
```yaml
client_auth:
  supabase: false
  
  # Symmetric key (HS256) matching backend JWT_SECRET
  jwks:
    keys:
      - kty: oct
        alg: HS256
        k: c3VwZXJzZWNyZXQ  # base64url("supersecret")
  
  # Must match JWT 'aud' claim from backend
  audience: ['powersync']
  
  # Map JWT 'sub' claim to 'user_id'
  jwt_claims:
    user_id: sub
```

**Critical points:**
- `k` value is base64url-encoded secret (NOT base64, NOT plain text)
- Use: `echo -n "supersecret" | base64` then convert `=` to empty, `+` to `-`, `/` to `_`
- `audience` must match backend JWT signOptions
- `jwt_claims` maps JWT's `sub` claim to PowerSync's `user_id`

### 3. Frontend (React + Vite)

#### Vite Configuration
**File:** `frontend/vite.config.ts`

```typescript
export default defineConfig({
  optimizeDeps: {
    exclude: ['@journeyapps/wa-sqlite', '@powersync/web']
  },
  worker: {
    format: 'es'
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  }
})
```

**Why:** Required for SQLite WASM and Web Workers to function properly.

#### App Setup
**File:** `frontend/src/App.tsx`

**Schema Definition:**
```typescript
const schema = new Schema([
  new Table({
    name: 'Product',  // Must match PostgreSQL table name
    columns: [
      new Column({ name: 'id', type: ColumnType.TEXT }),
      new Column({ name: 'name', type: ColumnType.TEXT }),
      new Column({ name: 'price', type: ColumnType.REAL }),
      new Column({ name: 'description', type: ColumnType.TEXT }),
      new Column({ name: 'ownerId', type: ColumnType.TEXT }),
      new Column({ name: 'createdAt', type: ColumnType.TEXT }),
    ],
  }),
]);
```

**PowerSync Initialization:**
```typescript
const { isAuthenticated, token, isLoading } = useAuth();
const [powerSync, setPowerSync] = React.useState<PowerSyncDatabase | null>(null);

React.useEffect(() => {
  if (isLoading) return;
  
  // Disconnect when user logs out
  if (!isAuthenticated || !token) {
    if (powerSync) {
      powerSync.disconnectAndClear();
      setPowerSync(null);
    }
    return;
  }
  
  // Initialize/reconnect when token changes
  const connector = {
    fetchCredentials: async () => ({
      endpoint: 'http://localhost:8080',
      token: token  // Current user's JWT
    }),
    uploadData: async () => {}  // Read-only mode
  };
  
  const db = new PowerSyncDatabase({ schema, database: { dbFilename: 'powersync.db' } });
  await db.init();
  await db.connect(connector);
  setPowerSync(db);
}, [isAuthenticated, token, isLoading]);
```

**Critical points:**
- PowerSync instance is recreated when token changes (different user logs in)
- `disconnectAndClear()` properly cleans up on logout
- Token from auth context is used for real-time JWT validation

#### Using PowerSync in Components
**File:** `frontend/src/pages/DashboardPage.tsx`

```typescript
// Separate component that only renders when PowerSync is ready
const ProductsList = () => {
  const status = useStatus();  // Connection status
  const { data: products, isLoading, error } = useQuery<Product>(
    'SELECT * FROM Product',
    []
  );
  
  // Products automatically update when data changes!
  return (/* JSX */);
};

const DashboardPage = () => {
  const powerSync = usePowerSync();
  
  return (
    <div>
      {!powerSync ? (
        <p>Initializing PowerSync...</p>
      ) : (
        <ProductsList />  // Only renders when ready
      )}
    </div>
  );
};
```

**Important:** Separate component pattern prevents hook errors when PowerSync is null.

## Important Implementation Details

### 1. Row Level Security (RLS) Enforcement

RLS is enforced at **two levels**:

1. **PowerSync Sync Level (Primary):**
   - Sync rules filter: `WHERE "ownerId" = bucket.user_id`
   - Each user's bucket only contains their products
   - Most secure: data never reaches client's device

2. **Database Level (Optional Defense-in-Depth):**
   - PostgreSQL RLS policy on Product table
   - Protects against direct database access
   - Not strictly necessary for PowerSync-only access

### 2. JWT Token Flow

```
1. User logs in → Backend generates JWT with:
   - sub: user.id (UUID)
   - aud: 'powersync'
   - Signed with JWT_SECRET

2. Frontend stores token → Passes to PowerSync connector

3. PowerSync validates JWT:
   - Verifies signature using symmetric key
   - Checks audience claim
   - Extracts user_id from 'sub' claim

4. PowerSync creates sync bucket:
   - Uses user_id from JWT
   - Syncs only products where ownerId = user_id
```

### 3. User Switching

When a different user logs in:

```
1. Auth context token changes
2. App.tsx useEffect detects change
3. Old PowerSync instance: disconnectAndClear()
4. New PowerSync instance: init() + connect() with new token
5. New bucket synced for new user
6. Old user's data cleared from local SQLite
```

### 4. Critical Configuration Values

**Must match across all systems:**

| Config | Backend | PowerSync | Purpose |
|--------|---------|-----------|---------|
| JWT Secret | `JWT_SECRET="supersecret"` | `k: c3VwZXJzZWNyZXQ` | JWT signing/validation |
| JWT Audience | `audience: 'powersync'` | `audience: ['powersync']` | JWT claim validation |
| User ID Claim | `sub: user.id` | `jwt_claims: { user_id: sub }` | User identification |
| Database | `localhost:5432/minimaldemo` | `host.docker.internal:5432/minimaldemo` | PostgreSQL connection |

## Common Issues & Solutions

### Issue: Users seeing each other's products
**Cause:** Sync rules using `SELECT id FROM "User"` instead of `SELECT token_parameters.user_id`
**Fix:** Update sync rules to use `token_parameters.user_id` - creates bucket only for authenticated user

### Issue: "Could not find an appropriate key in the keystore"
**Cause:** JWT secret not base64url-encoded correctly
**Fix:** Encode secret as base64url (not plain base64): `echo -n "secret" | base64 | tr '+/' '-_' | tr -d '='`

### Issue: "JWT payload is missing a required claim 'aud'"
**Cause:** Backend not including audience in JWT signOptions
**Fix:** Add `audience: 'powersync'` to JwtModule.registerAsync signOptions

### Issue: PowerSync can't connect to PostgreSQL
**Cause:** Using `localhost` instead of `host.docker.internal` in Docker config
**Fix:** Update PowerSync config URI to use `host.docker.internal:5432`

### Issue: React hook errors (Cannot read properties of null)
**Cause:** Calling `useStatus()` or `useQuery()` when PowerSync is null
**Fix:** Use separate component pattern - only render component with hooks when PowerSync exists

### Issue: Products not updating in real-time
**Cause:** Not using reactive hooks
**Fix:** Use `useQuery()` hook instead of manual `db.getAll()` - automatically updates on data changes

### Issue: Old user's data persists after login as new user
**Cause:** Not calling `disconnectAndClear()` on token change
**Fix:** Implement useEffect that calls `disconnectAndClear()` when token changes

## Testing RLS

1. Create User A and add products
2. Create User B and add products
3. Log in as User A → Should see only User A's products
4. Log out and log in as User B → Should see only User B's products
5. Check PowerSync logs:
   ```
   user_id: "uuid-for-user-a"
   buckets: 1 ["user_products[\"uuid-for-user-a\"]"]
   ```

## Commands Reference

**Start backend:**
```bash
cd backend
npm run start:dev
```

**Start frontend:**
```bash
cd frontend
npm run dev
```

**Start PowerSync:**
```bash
cd powersync
docker compose up -d
```

**View PowerSync logs:**
```bash
docker compose logs powersync --follow
```

**Restart PowerSync (after config changes):**
```bash
docker compose restart powersync
```

**Reset everything:**
```bash
docker compose down -v  # Clear MongoDB data
rm -rf frontend/powersync.db*  # Clear client SQLite
npx prisma migrate reset  # Reset and reapply migrations
```

## Performance Considerations

- **Local SQLite:** Queries are instant (ms)
- **Sync Latency:** Changes appear in ~100-500ms
- **Initial Sync:** First load takes 1-2 seconds
- **Offline Support:** Queries work offline, sync resumes when online

## Security Best Practices

1. **Never expose PowerSync user credentials** in client code
2. **Use environment variables** for all secrets
3. **Validate JWT audience claim** in PowerSync config
4. **Implement RLS at database level** for defense-in-depth
5. **Use HTTPS in production** for PowerSync endpoint
6. **Rotate JWT secrets regularly**
7. **Monitor PowerSync logs** for unusual access patterns

## Production Checklist

- [ ] Use strong JWT secret (not "supersecret")
- [ ] Enable SSL for PostgreSQL connection
- [ ] Use HTTPS for PowerSync endpoint
- [ ] Configure proper CORS headers
- [ ] Set up monitoring and alerting
- [ ] Implement rate limiting on backend API
- [ ] Configure PowerSync telemetry preferences
- [ ] Set up backups for MongoDB (sync bucket storage)
- [ ] Use production-ready PostgreSQL instance
- [ ] Configure proper firewall rules

## Summary

This implementation provides:
✅ Real-time data synchronization
✅ Per-user data isolation (RLS)
✅ Offline-capable queries
✅ Minimal backend API surface (write-only)
✅ JWT-based authentication
✅ Automatic reconnection on user change
✅ Type-safe queries with React hooks

Key takeaway: **PowerSync enforces RLS at the sync bucket level** - each user's JWT determines which data syncs to their device, ensuring data isolation from the start.
