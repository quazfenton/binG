# User API Keys & Credentials Guide

**Manage your personal API keys for enhanced AI functionality**

---

## 🎯 Overview

The **API Keys & Credentials** feature allows users to:

1. **Override server-side API keys** with personal keys
2. **Store credentials securely** in browser localStorage (encrypted)
3. **Pre-authorize OAuth connections** for seamless tool usage
4. **Export/Import keys** for backup and migration

---

## 🔐 Security

### How Keys Are Stored

| Storage Method | Encryption | Access |
|---------------|------------|--------|
| **localStorage** | XOR + Base64 | Client-side only |
| **Database** (optional) | Application-level | Server-side backup |

**Important Notes:**
- Keys are **never sent to our servers** unless you explicitly save to database
- localStorage encryption uses browser-specific salt
- Clearing browser data will remove localStorage keys (export first!)
- Database storage requires authentication

---

## 📱 Accessing the Settings Page

1. Navigate to `/settings` in your browser
2. Log in if not already authenticated
3. Click on the **API Keys** tab

---

## 🔑 Managing API Keys

### Adding a New API Key

1. Go to Settings → API Keys
2. Find the provider you want to configure
3. Click in the input field
4. Paste your API key
5. Click **Save Changes**

### Supported Providers

#### LLM Providers
- **OpenAI** - GPT-4, GPT-3.5-turbo
- **Anthropic** - Claude models
- **Google** - Gemini models
- **Mistral AI** - Mistral models
- **Together AI** - Various open models
- **Replicate** - Image generation
- **OpenRouter** - Multi-model access

#### Tools & MCP
- **Composio** - Tool integrations
- **Nango** - OAuth integrations

#### OAuth Tokens (Coming Soon)
- **Notion** - Pages and databases
- **Slack** - Channel messaging
- **GitHub** - Repository management
- **Google Workspace** - Gmail, Calendar, Drive

#### Other Services
- **Serper** - Web search
- **Exa** - Semantic search

### Viewing/Editing Keys

- Click the **eye icon** 👁️ to show/hide a key
- Edit the value directly in the input field
- Click the **trash icon** 🗑️ to delete a specific key

### Exporting Keys

1. Click **Export** button
2. Keys are copied to clipboard as JSON
3. Save the JSON securely (password manager recommended)

**Example Export:**
```json
{
  "openai_api_key": "sk-...",
  "anthropic_api_key": "sk-ant-...",
  "notion_oauth_token": "secret_..."
}
```

### Importing Keys

1. Click **Import** button
2. Paste your exported JSON
3. Click **Import Keys**
4. Keys are loaded into localStorage

### Clearing All Keys

1. Click **Clear All** button
2. Confirm the action
3. All keys are removed from localStorage

⚠️ **Warning:** This action cannot be undone!

---

## 🔄 How Keys Are Used

### Priority Order

When the AI needs to use an API:

1. **User-provided key** (from localStorage) - **Highest priority**
2. **Server-side key** (from environment variables)
3. **Fallback** (if configured)

### Example Flow

```typescript
// In your LLM call implementation
import { getUserAPIKey } from '@/lib/user/user-api-keys'

function getOpenAIKey() {
  // Check user key first
  const userKey = getUserAPIKey('openai_api_key')
  if (userKey) {
    return userKey  // Use user's key
  }
  
  // Fall back to server key
  return process.env.OPENAI_API_KEY
}
```

---

## 🗄️ Database Persistence (Optional)

For authenticated users, keys can be persisted to the database:

### Benefits
- **Cross-device sync** - Access keys from any device
- **Backup** - Keys survive browser data clearing
- **Security** - Server-side encryption

### How to Enable

Database persistence is automatic for authenticated users when you save keys.

### API Endpoints

```http
GET /api/user/api-keys
Authorization: Bearer <token>

Response: {
  "hasKeys": true,
  "updatedAt": "2026-03-03T12:00:00Z"
}
```

```http
POST /api/user/api-keys
Authorization: Bearer <token>
Content-Type: application/json

{
  "encryptedKeys": "..."
}

Response: {
  "success": true,
  "message": "API keys saved successfully"
}
```

```http
DELETE /api/user/api-keys
Authorization: Bearer <token>

Response: {
  "success": true,
  "message": "API keys deleted successfully"
}
```

---

## 🔮 OAuth Pre-Authorization (Coming Soon)

### What Is It?

Pre-authorize OAuth connections so the AI can use services without prompting for authentication each time.

### Supported Services

| Service | Capabilities | Status |
|---------|-------------|--------|
| **Notion** | Create pages, query databases | Coming Soon |
| **Slack** | Send messages, read channels | Coming Soon |
| **GitHub** | Create issues, manage repos | Coming Soon |
| **Google** | Gmail, Calendar, Drive | Coming Soon |

### How It Works

1. Click **Connect** for a service
2. Authorize via OAuth flow
3. Token is stored securely
4. AI can use the service automatically

---

## 🛠️ For Developers

### Using User API Keys in Your Code

```typescript
import {
  getUserAPIKeys,
  getUserAPIKey,
  setUserAPIKey,
  hasUserAPIKey,
} from '@/lib/user/user-api-keys'

// Get all keys
const allKeys = getUserAPIKeys()

// Get specific key
const openaiKey = getUserAPIKey('openai_api_key')

// Check if key exists
if (hasUserAPIKey('anthropic_api_key')) {
  // Use user's Anthropic key
}

// Set a key
setUserAPIKey('openai_api_key', 'sk-...')

// Delete a key
deleteUserAPIKey('openai_api_key')
```

### Adding New Provider Support

1. Add to `UserAPIKeys` interface:
```typescript
export interface UserAPIKeys {
  // ... existing keys
  new_provider_api_key?: string
}
```

2. Add to `API_KEY_FIELDS`:
```typescript
{
  key: 'new_provider_api_key',
  label: 'New Provider API Key',
  description: 'For New Provider services',
  category: 'llm',  // or 'tools', 'oauth', 'other'
  placeholder: '...',
}
```

3. Use in your integration:
```typescript
const apiKey = getUserAPIKey('new_provider_api_key')
if (apiKey) {
  // Use user's key
} else {
  // Use server key
}
```

---

## 🔒 Security Best Practices

### DO ✅
- Export your keys regularly for backup
- Use strong, unique API keys
- Clear keys when switching devices
- Review configured keys periodically

### DON'T ❌
- Share your exported keys JSON
- Store keys in plain text
- Use the same key across multiple services
- Leave keys on shared devices

---

## 🐛 Troubleshooting

### "Keys not saving"
- Check browser localStorage is enabled
- Ensure you clicked **Save Changes**
- Try clearing browser cache

### "Keys not working"
- Verify the key is correct (no extra spaces)
- Check the key hasn't expired
- Ensure the key has required permissions

### "Lost my keys after browser clear"
- Use **Export** before clearing browser data
- Import keys from backup after clearing

### "Keys not syncing across devices"
- Database persistence requires authentication
- Export from one device, import on another

---

## 📊 Database Schema

```sql
CREATE TABLE user_api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    encrypted_keys TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

---

## 📝 Migration History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-03 | Initial implementation |
| | | - localStorage storage |
| | | - 15+ provider support |
| | | - Export/Import functionality |
| | | - Database persistence |

---

**Last Updated:** March 3, 2026  
**Version:** 1.0
