# OAuth Permission Tracking System

## Overview

The permission tracking system distinguishes between:
1. **Basic OAuth Login** - Authentication only (profile, email)
2. **Extended Permissions** - API access for automation (Gmail, Drive, Calendar, etc.)

This integrates with automation tools like **Composio**, **Arcade**, and **Nango** for tool authorization.

## Architecture

```
┌─────────────────┐
│  OAuth Login    │
│  (Auth0)        │
└────────┬────────┘
         │
         ├─► Basic Profile (always granted)
         │   - sub (user ID)
         │   - email
         │   - name
         │
         └─► Extended Scopes (user chooses)
             - gmail.readonly
             - drive.file
             - calendar.events
             └─► Stored in external_connections.scopes
                 └─► Auto-grants service_permissions
```

## Database Schema

### `external_connections`
Stores OAuth connection metadata:
- `access_token_encrypted` - OAuth access token
- `refresh_token_encrypted` - OAuth refresh token
- `token_expires_at` - Token expiration
- `scopes` - Comma-separated list of granted scopes

### `service_permissions`
Tracks granular service-level permissions:
- `service_name` - gmail, drive, calendar, etc.
- `permission_level` - read, write, full
- `granted_at` - When permission was granted
- `is_active` - Whether permission is active
- `last_used_at` - Last time permission was used

## Usage

### 1. Basic Login (No Extended Permissions)

User clicks "Login with Google" → Gets basic profile only.

```typescript
// Settings.tsx or login component
window.location.href = '/auth/login?connection=google-oauth2';
```

**Scopes requested:** `openid profile email`

**Result:**
- User authenticated
- No API access tokens
- Cannot use Gmail/Drive/Calendar integrations

### 2. Extended Permissions (For Automation Tools)

User connects account with specific scopes for tool integration.

```typescript
// In integration settings or tool configuration
const connectWithScopes = async () => {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
  ].join(' ');
  
  window.location.href = `/auth/login?connection=google-oauth2&scope=${encodeURIComponent(scopes)}`;
};
```

**Result:**
- User authenticated
- Access tokens stored with scopes
- Service permissions auto-granted based on scopes
- Available for Composio/Arcade/Nango tools

### 3. Checking Permissions

```typescript
import { hasServicePermission, getAutomationToolPermissions } from '@/lib/oauth/permission-tracker';

// Check if user has Gmail read permission
const canReadGmail = hasServicePermission(userId, connectionId, 'gmail', 'read');

// Get all permissions for automation tools
const toolPermissions = await getAutomationToolPermissions(userId);
// Returns: [{ provider: 'google', serviceName: 'gmail', permissionLevel: 'read', scopes: [...] }]
```

### 4. Granting/Revoking Permissions

```typescript
import { grantServicePermission, revokeServicePermission } from '@/lib/oauth/permission-tracker';

// Grant Gmail read permission
await grantServicePermission(userId, connectionId, 'gmail', 'read');

// Revoke permission
await revokeServicePermission(userId, connectionId, 'gmail');
```

## Service Definitions

| Service | Default Scopes | Permission Levels |
|---------|---------------|-------------------|
| gmail | `gmail.readonly`, `gmail.send` | read, write, full |
| drive | `drive.readonly`, `drive.file` | read, write, full |
| calendar | `calendar.readonly`, `calendar.events` | read, write, full |
| contacts | `contacts.readonly` | read |
| docs | `documents.readonly` | read |
| sheets | `spreadsheets.readonly`, `spreadsheets` | read, write, full |
| slides | `presentations.readonly` | read |
| tasks | `tasks.readonly` | read |
| keep | `keep.readonly` | read |
| photos | `photoslibrary.readonly` | read |
| youtube | `youtube.readonly` | read, write, full |
| maps | `mapsplatform` | read |

## Integration with Automation Tools

### Composio

```typescript
// Check permission before using Composio tool
const hasPermission = hasServicePermission(userId, connectionId, 'gmail', 'read');

if (!hasPermission) {
  // Redirect to grant permission
  return redirect('/settings/integrations?request=gmail');
}

// Use Composio tool
const composio = await Composio.create({ apiKey: process.env.COMPOSIO_API_KEY });
const result = await composio.execute({
  tool: 'gmail_read_emails',
  connectionId,
});
```

### Arcade

```typescript
// Get permissions for Arcade tools
const permissions = await getAutomationToolPermissions(userId);

const gmailPermission = permissions.find(p => 
  p.provider === 'google' && p.serviceName === 'gmail'
);

if (gmailPermission) {
  // User has Gmail permission, can use Arcade Gmail tools
  const arcade = await Arcade.create({ token: gmailPermission.scopes[0] });
  // ...
}
```

### Nango

```typescript
// Similar pattern for Nango
const permissions = await getAutomationToolPermissions(userId);

// Map to Nango connections
const nangoConnections = permissions.map(p => ({
  providerConfigKey: p.provider,
  connectionId: p.connectionId.toString(),
  scopes: p.scopes,
}));
```

## UI Components

### Permissions Manager

```tsx
import OAuthPermissionsManager from '@/components/oauth/permissions-manager';

// In settings page
<OAuthPermissionsManager userId={user.id} />
```

Features:
- View all connected accounts
- See granted scopes
- Toggle service permissions on/off
- Disconnect accounts
- View permission usage stats

## Security Considerations

1. **Token Storage**: All tokens encrypted with `ENCRYPTION_KEY`
2. **Scope Validation**: Scopes validated against known patterns
3. **Permission Levels**: Hierarchy (read < write < full) enforced
4. **Audit Logging**: Permission usage logged for security auditing
5. **Token Refresh**: Automatic refresh with retry limits
6. **Expiration Handling**: Expired tokens marked, user prompted to reconnect

## Migration from Basic Auth

For existing users with basic OAuth login:

```typescript
// Check if user needs extended permissions
const connection = await getConnection(userId, 'google');

if (connection && !connection.scopes.includes('gmail.readonly')) {
  // Prompt user to grant extended permissions
  showUpgradePermissionsModal();
}
```

## API Endpoints

### `GET /api/oauth/permissions`
Get all permissions for current user

**Response:**
```json
{
  "connections": [
    {
      "id": 1,
      "provider": "google",
      "providerDisplayName": "Google",
      "isConnected": true,
      "scopes": ["gmail.readonly", "calendar.readonly"],
      "permissions": [
        { "serviceName": "gmail", "permissionLevel": "read", "isActive": true },
        { "serviceName": "calendar", "permissionLevel": "read", "isActive": true }
      ]
    }
  ]
}
```

### `POST /api/oauth/permissions`
Grant or revoke permissions

**Request:**
```json
{
  "action": "grant",
  "connectionId": 1,
  "serviceName": "gmail",
  "permissionLevel": "read"
}
```

**or**
```json
{
  "action": "revoke",
  "connectionId": 1,
  "serviceName": "gmail"
}
```

## Best Practices

1. **Request minimum scopes initially** - Start with basic login, request extended scopes when needed
2. **Explain why** - Tell users why you need each permission
3. **Granular control** - Let users grant/revoke individual services
4. **Show usage** - Display when permissions were last used
5. **Auto-expire** - Prompt re-authentication for expired tokens
6. **Audit trail** - Log all permission grants and usage

## Troubleshooting

### "Token expired" error
- User needs to reconnect account
- Refresh token may have expired
- Solution: Redirect to `/auth/login?connection=google-oauth2&prompt=consent`

### Permission not granted
- Check `service_permissions.is_active = TRUE`
- Verify scopes in `external_connections.scopes`
- Ensure token hasn't expired

### Automation tool fails
- Verify permission level matches tool requirements
- Check token expiration
- Review permission usage logs
