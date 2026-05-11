# 9Router Multi-Tenant Fork - DB Migration

## Overview

This fork adds `userId` scoping to 9Router's SQLite database for multi-tenant per-user isolation.

## Files to Modify

### 1. src/lib/db/migrations/002-user-scoped-connections.js

Create new migration file:

```javascript
export async function up(db) {
  // Add userId column to providerConnections
  db.run(`ALTER TABLE providerConnections ADD COLUMN userId TEXT`)
  
  // Create index for fast user-scoped queries
  db.run(`CREATE INDEX idx_providerConnections_userId ON providerConnections(userId)`)
  
  // Add index on provider + userId for fast lookups
  db.run(`CREATE INDEX idx_providerConnections_provider_userId ON providerConnections(provider, userId)`)
}

export async function down(db) {
  db.run(`DROP INDEX IF EXISTS idx_providerConnections_userId`)
  db.run(`DROP INDEX IF EXISTS idx_providerConnections_provider_userId`)
  db.run(`ALTER TABLE providerConnections DROP COLUMN userId`)
}
```

### 2. src/lib/db/repos/connectionsRepo.js

Modify functions to accept optional userId parameter:

```javascript
export async function getProviderConnections(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  
  // ADD THIS: Filter by userId if provided
  if (filter.userId) {
    where.push('userId = ?');
    params.push(filter.userId);
  }
  
  if (filter.provider) { where.push('provider = ?'); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push('isActive = ?'); params.push(filter.isActive ? 1 : 0); }
  
  const sql = `SELECT * FROM providerConnections${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const rows = db.all(sql, params);
  const list = rows.map(rowToConn);
  list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return list;
}

export async function createProviderConnection(data) {
  // ADD THIS: Accept userId in data
  const db = await getAdapter();
  const now = new Date().toISOString();
  // ... existing logic, just add userId to the row
  
  db.transaction(() => {
    // Check for existing OAuth connection for same email+provider+userId
    let existing = null;
    if (data.authType === 'oauth' && data.email && data.userId) {
      existing = db.get(
        `SELECT * FROM providerConnections WHERE provider = ? AND email = ? AND userId = ?`,
        [data.provider, data.email, data.userId]
      )
    }
    // ...
  })
}
```

### 3. src/app/api/oauth/[provider]/[action]/route.js

Modify to pass userId from authenticated session:

```javascript
// In POST /exchange handler, add userId from session:
if (action === 'exchange') {
  const { code, redirectUri, codeVerifier, state, meta, userId } = body;
  
  // Get user from session (depends on your auth setup)
  // const userId = getSessionUserId(request) 
  
  const tokenData = await exchangeTokens(provider, code, redirectUri, codeVerifier, state, meta);

  const connection = await createProviderConnection({
    provider,
    authType: 'oauth',
    userId: userId || 'default', // ADD THIS
    ...tokenData,
    expiresAt: tokenData.expiresIn 
      ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString() 
      : null,
    testStatus: 'active',
  });
}
```

### 4. src/app/api/providers/route.js

Filter connections by userId (get from session/header):

```javascript
export async function GET(request) {
  // Get userId from header (your app passes this)
  const userId = request.headers.get('x-user-id')
  
  const allConnections = await getProviderConnections();
  
  // Filter by userId if provided
  const userConnections = userId 
    ? allConnections.filter(c => c.userId === userId)
    : allConnections
  
  // ... rest of logic
}

export async function POST(request) {
  const userId = request.headers.get('x-user-id')
  const body = await request.json();
  
  // Add userId to the connection
  const newConnection = await createProviderConnection({
    userId: userId || 'default', // ADD THIS
    ...body,
    // ... rest
  })
}
```

### 5. src/app/api/keys/route.js

Create keys scoped to userId:

```javascript
export async function POST(request) {
  const userId = request.headers.get('x-user-id')
  const body = await request.json();
  
  // Create key with userId scoping
  const key = await createApiKey({
    ...body,
    userId: userId || 'default'
  })
}
```

## Docker Deployment

```bash
# Build with modifications
docker build -t 9router-mt .

# Run with userId header passthrough
docker run -d --name 9router -p 20128:20128 --env-file .env 9router-mt

# Example: Your app calls 9Router with user context
curl -X POST http://localhost:20128/v1/chat/completions \\
  -H 'Authorization: Bearer sk-user-key' \\
  -H 'x-user-id: user-123' \\
  -H 'Content-Type: application/json'
```

## Notes

- Default `userId = 'default'` for backward compatibility with existing installations
- All queries should include userId for multi-tenant isolation
- Consider adding encryption for accessToken/refreshToken at rest
- Backup the database before running migrations