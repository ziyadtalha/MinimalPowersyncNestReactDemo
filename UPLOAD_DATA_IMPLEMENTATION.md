# PowerSync Upload Data Implementation

## Overview
This implementation enables **client-to-server write propagation** for PowerSync. Local SQLite changes are automatically queued and uploaded to your NestJS backend, which applies them to PostgreSQL. PowerSync then replicates the changes back to all clients.

## Architecture

```
Client (React)
  └─> Local SQLite (PowerSync)
       └─> Upload Queue
            └─> uploadData() → POST /powersync/upload
                                    ↓
Backend (NestJS)                    
  └─> PowerSyncService
       └─> Prisma Transaction → PostgreSQL
                                    ↓
PowerSync Service (Docker)          ↓
  └─> Replication ←──────────────────┘
       └─> All Clients (via sync_rules)
```

## Implementation Details

### Client Side (`frontend/src/App.tsx`)

The `uploadData` function in the PowerSync connector:

1. **Fetches pending transactions**: `database.getNextCrudTransaction()`
2. **POSTs to backend**: Sends batch to `POST /powersync/upload` with JWT auth
3. **Handles responses**:
   - **Success (2xx)**: Calls `transaction.complete()` to remove from queue
   - **Client errors (4xx)**: Discards transaction (likely data validation issue)
   - **Server errors (5xx)**: Throws error to trigger automatic retry
   - **Network errors**: Throws error to trigger automatic retry

### Server Side (`backend/src/powersync/`)

#### PowerSyncController
- **Endpoint**: `POST /powersync/upload`
- **Auth**: Protected by JWT guard
- **Accepts**: Batch of CRUD operations
- **Returns**: `{ success: boolean, processed: number }`

#### PowerSyncService
- **Transaction processing**: Wraps all operations in a Prisma transaction
- **Operation types**:
  - `PUT`: Upsert (insert or update)
  - `PATCH`: Update existing record (validates ownership)
  - `DELETE`: Delete record (validates ownership)
- **Error classification**:
  - **Fatal errors** (discarded, not retried):
    - Prisma errors: P2002 (unique constraint), P2003 (foreign key), P2025 (not found)
    - Validation errors
    - Not-found/permission errors
  - **Transient errors** (retried by client):
    - Network errors
    - Database deadlocks
    - Temporary server issues

## Usage

### Creating Records Locally

```typescript
// In your React component
const powerSync = usePowerSync();

// Insert directly into local SQLite (use ISO-8601 format for timestamps)
await powerSync.execute(
  `INSERT INTO Product (id, name, price, description, ownerId, createdAt)
   VALUES (uuid(), ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
  [name, price, description, userId]
);

// PowerSync automatically:
// 1. Adds this to the upload queue
// 2. Calls uploadData() to send to backend
// 3. Backend applies to PostgreSQL
// 4. PowerSync replicates back to all clients
```

### Monitoring Uploads

Check browser console for logs:
- `Uploading transaction with X operations`
- `Upload successful: { success: true, processed: X }`
- `Upload failed:` (with error details)

Check backend logs for:
- `Received upload batch with X operations from user <userId>`
- `Successfully processed X operations for user <userId>`
- `Fatal error processing transaction - discarding:` (for discarded transactions)

## Configuration

### Environment Variables

Frontend (`frontend/.env`):
```env
VITE_POWERSYNC_URL=http://localhost:8080
VITE_API_URL=http://localhost:3000
```

Backend (`backend/.env`):
```env
JWT_SECRET=supersecret
DATABASE_URL=postgresql://...
```

### Adding New Tables

To support uploads for new tables:

1. **Add to PowerSync schema** (`frontend/src/App.tsx`):
```typescript
const schema = new Schema([
  new Table({ name: 'YourTable', columns: [...] }),
]);
```

2. **Add table mapping** (`backend/src/powersync/powersync.service.ts`):
```typescript
const modelMap: Record<string, string> = {
  Product: 'product',
  YourTable: 'yourTable', // Add your Prisma model name
};
```

## Error Handling

### Retry Logic
- PowerSync SDK automatically retries failed uploads with exponential backoff
- Transient errors (network, 5xx) are retried
- Fatal errors (validation, 4xx) are discarded after logging

### Dead Letter Queue (Optional)
For production, consider saving discarded transactions:

```typescript
// In PowerSyncService.processCrudBatch()
if (isFatal) {
  // Save to dead letter queue for manual review
  await this.deadLetterQueue.save({
    userId,
    transaction,
    error: error.message,
    timestamp: new Date(),
  });
  return { success: true, processed: 0 };
}
```

## Testing

### Manual Test Flow

1. **Start services**:
```powershell
# Terminal 1: PowerSync
cd powersync
docker-compose up

# Terminal 2: Backend
cd backend
npm run start:dev

# Terminal 3: Frontend
cd frontend
npm run dev
```

2. **Create product locally**:
   - Login to the app
   - Open browser console
   - Create a product (uncomment the fake error in DashboardPage.tsx to force local insert)

3. **Verify upload**:
   - Check console: "Uploading transaction with 1 operations"
   - Check backend logs: "Successfully processed 1 operations"
   - Check database: Product appears in PostgreSQL
   - Check UI: Product appears in list (replicated back via PowerSync)

### Automated Testing

See [todo #5] for end-to-end test implementation.

## Troubleshooting

### Uploads not working
- Check JWT token is valid and includes `aud: 'powersync'`
- Verify `VITE_API_URL` points to your backend
- Check backend logs for authentication errors
- Ensure PowerSyncModule is imported in AppModule

### Transactions being discarded
- Check backend logs for "Fatal error" messages
- Verify data validation (required fields, types)
- Check ownership validation (ownerId matches user)

### Changes not appearing
- Verify PowerSync is connected (check status in UI)
- Check sync_rules include the table
- Verify user has permissions per sync_rules bucket

## Security Considerations

1. **Ownership validation**: All operations validate `ownerId` matches authenticated user
2. **JWT authentication**: All uploads require valid JWT
3. **SQL injection**: Prisma provides parameterized queries
4. **Rate limiting**: Consider adding rate limits to `/powersync/upload`
5. **Input validation**: Add DTO validation for complex data types

## Performance

- **Batch processing**: Multiple operations sent in single request
- **Database transactions**: All ops in batch are atomic
- **Automatic retries**: Failed uploads don't block successful ones
- **Queue management**: PowerSync handles queue persistence

## Architecture Decision: Local Operations vs API Calls

### When to Use Local Operations (PowerSync Upload Queue)

Use local SQLite operations for:

✅ **Simple CRUD on user-owned data:**
- Creating/updating/deleting user's own records
- Example: User editing their own products, posts, comments
- **Why:** Instant UI updates, works offline, automatic queue management

✅ **High-frequency writes:**
- Form autosave, draft documents
- Mobile apps with spotty connectivity
- Real-time collaborative features (with conflict resolution)
- **Why:** Better UX, reduces server load, automatic retry

✅ **Bulk operations:**
- Importing data, batch updates
- Multi-step wizards with rollback
- **Why:** All-or-nothing transaction semantics

### When to Use Direct API Calls

Use backend API for:

❌ **Operations requiring server-side logic:**
- Payment processing, inventory checks
- Email notifications, webhooks
- Complex calculations, AI/ML processing
- **Why:** Cannot be done client-side

❌ **Operations requiring immediate validation:**
- Checking unique constraints across all users
- Rate limiting, fraud detection
- Admin actions with audit logs
- **Why:** Server has global view

❌ **Operations with side effects:**
- Creating related records (order → order items → invoice)
- File uploads, image processing
- Third-party API calls
- **Why:** Need synchronous confirmation

❌ **Role-based operations beyond ownership:**
- Admin modifying other users' data
- Approval workflows, state transitions
- Cross-entity operations
- **Why:** Complex authorization logic

❌ **Operations on tables without sync_rules:**
- Internal tables (logs, analytics, audit trails)
- Configuration tables
- Session management
- **Why:** Not replicated to clients

### Hybrid Pattern (Recommended)

For user-owned CRUD operations, support both:

```typescript
const createProduct = async (data: ProductInput, options?: { useLocal?: boolean }) => {
  if (options?.useLocal && powerSync && navigator.onLine === false) {
    // Use local insert for offline support
    await powerSync.execute(
      `INSERT INTO Product (...) VALUES (...)`,
      [...]
    );
  } else {
    // Use API for immediate validation
    await client.post('/products', data);
  }
};
```

**Benefits:**
- API by default (immediate validation, side effects)
- Fallback to local when offline
- User can toggle based on preference

### Decision Matrix

| Scenario | Method | Reason |
|----------|--------|--------|
| User creates their own product | **Local** | Offline support, instant feedback |
| User updates their profile | **Local** | Frequent changes, offline support |
| User deletes their comment | **Local** | Ownership validated, simple operation |
| Admin bans a user | **API** | Cross-entity operation, audit required |
| User places an order | **API** | Payment processing, inventory check |
| User saves draft post | **Local** | High-frequency, works offline |
| User uploads avatar | **API** | File processing, CDN upload |
| User toggles notification setting | **API** | Needs immediate effect |
| Bulk import 100 records | **Local** | Transaction semantics, progress tracking |
| Check username availability | **API** | Requires global uniqueness check |

### Implementation Guidelines

1. **Default to API** unless you have a specific reason for local operations
2. **Use local operations** for offline-first features
3. **Validate on server** even for local operations (via upload endpoint)
4. **Handle conflicts** when local operations fail validation
5. **Audit sensitive operations** server-side regardless of write path

## Complex RBAC Scenarios

### Scenario 1: Admins Can Modify Any Record

**Current:** Admins see all products but can only modify their own.

**Solution:** Add role check in upload validation:

```typescript
// backend/src/powersync/powersync.service.ts
private async applyCrudOperation(tx: any, userId: string, op: CrudOperation) {
  const { type: table, id, data: opData } = op;
  const model = this.getPrismaModel(tx, table);
  
  // Get user role
  const user = await tx.user.findUnique({ 
    where: { id: userId },
    select: { role: true }
  });
  
  switch (op.op) {
    case 'PATCH': {
      // Admins can update any record, users only their own
      const whereClause = user?.role === 'ADMIN'
        ? { id }
        : { id, ownerId: userId };
        
      const updateResult = await model.updateMany({
        where: whereClause,
        data: opData,
      });
      
      if (updateResult.count === 0) {
        throw new BadRequestException('Record not found or insufficient permissions');
      }
      break;
    }
    
    case 'DELETE': {
      // Admins can delete any record, users only their own
      const whereClause = user?.role === 'ADMIN'
        ? { id }
        : { id, ownerId: userId };
        
      await model.deleteMany({ where: whereClause });
      break;
    }
  }
}
```

### Scenario 2: Manager Role (Hierarchical Access)

**Requirement:** Managers can modify records of users in their team.

**Schema:**
```prisma
model User {
  id        String  @id @default(uuid())
  role      Role    @default(USER)
  managerId String? @db.Uuid
  manager   User?   @relation("TeamMembers", fields: [managerId], references: [id])
  team      User[]  @relation("TeamMembers")
}
```

**sync_rules:**
```yaml
manager_products:
  parameters: |
    SELECT id AS manager_id
    FROM "User"
    WHERE id = token_parameters.user_id AND role = 'MANAGER'
  
  data:
    - |
      SELECT p.*
      FROM "Product" p
      INNER JOIN "User" u ON p."ownerId" = u.id
      WHERE u."managerId" = bucket.manager_id OR p."ownerId" = bucket.manager_id
```

**Upload validation:**
```typescript
case 'PATCH': {
  const user = await tx.user.findUnique({ 
    where: { id: userId },
    select: { role: true, team: { select: { id: true } } }
  });
  
  const record = await model.findUnique({ where: { id } });
  
  const canModify = 
    record.ownerId === userId || // Own record
    user.role === 'ADMIN' || // Admin privilege
    (user.role === 'MANAGER' && user.team.some(m => m.id === record.ownerId)); // Team member
    
  if (!canModify) {
    throw new BadRequestException('Insufficient permissions');
  }
  
  await model.update({ where: { id }, data: opData });
  break;
}
```

### Scenario 3: Field-Level Permissions

**Requirement:** Users can update `name` and `description`, but only admins can update `price`.

**Upload validation:**
```typescript
case 'PATCH': {
  const user = await tx.user.findUnique({ where: { id: userId } });
  
  // Check if non-admin is trying to modify restricted fields
  const restrictedFields = ['price', 'status', 'featured'];
  const hasRestrictedChanges = restrictedFields.some(field => field in opData);
  
  if (hasRestrictedChanges && user.role !== 'ADMIN') {
    throw new BadRequestException('Insufficient permissions to modify restricted fields');
  }
  
  await model.updateMany({
    where: { id, ownerId: userId },
    data: opData,
  });
  break;
}
```

### Scenario 4: Soft Deletes with Approval

**Requirement:** Users can "soft delete" (mark as archived), but permanent deletion requires admin approval.

**Schema:**
```prisma
model Product {
  id          String    @id
  isArchived  Boolean   @default(false)
  deletedAt   DateTime?
}
```

**Upload validation:**
```typescript
case 'PATCH': {
  // Allow users to soft delete their own records
  if (opData.isArchived === true && opData.deletedAt) {
    await model.updateMany({
      where: { id, ownerId: userId },
      data: { isArchived: true, deletedAt: new Date() },
    });
  } else {
    // Normal update
    await model.updateMany({
      where: { id, ownerId: userId },
      data: opData,
    });
  }
  break;
}

case 'DELETE': {
  const user = await tx.user.findUnique({ where: { id: userId } });
  
  // Only admins can permanently delete
  if (user.role !== 'ADMIN') {
    throw new BadRequestException('Only admins can permanently delete records');
  }
  
  await model.delete({ where: { id } });
  break;
}
```

### Scenario 5: Time-Based Permissions

**Requirement:** Users can only edit records within 24 hours of creation.

**Upload validation:**
```typescript
case 'PATCH': {
  const record = await model.findUnique({ 
    where: { id },
    select: { ownerId: true, createdAt: true }
  });
  
  if (record.ownerId !== userId) {
    throw new BadRequestException('Not your record');
  }
  
  const hoursSinceCreation = 
    (Date.now() - record.createdAt.getTime()) / (1000 * 60 * 60);
    
  if (hoursSinceCreation > 24) {
    throw new BadRequestException('Edit window expired (24 hours)');
  }
  
  await model.update({ where: { id }, data: opData });
  break;
}
```

### Best Practices for Complex RBAC

1. **Fetch user role from database** (don't trust JWT claims)
2. **Validate permissions before applying operations**
3. **Use descriptive error messages** for debugging
4. **Log permission failures** for security auditing
5. **Keep sync_rules aligned with upload validation**
6. **Test with multiple user roles** and edge cases
7. **Document permission logic** in code comments

## Next Steps

- [ ] Add end-to-end tests
- [ ] Implement dead letter queue for failed transactions
- [ ] Add metrics/monitoring for upload success rates
- [ ] Add UI toggle for local vs server insert modes
- [ ] Add offline persistence for upload queue
