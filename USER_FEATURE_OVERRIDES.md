# User Feature Overrides Implementation

## Overview

Users can now override environment variables for **OpenCode** and **Nullclaw** features through the Settings panel. Preferences are:
- ✅ Saved to **localStorage** (immediate, works offline)
- ✅ Synced to **database** (persists across devices when logged in)
- ✅ Applied to **CSS data attributes** (for UI feature gating)
- ✅ Checked by **server-side code** (affects backend behavior)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Settings Panel (components/settings.tsx)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  OpenCode [ON]  Nullclaw [OFF]                       │  │
│  └──────────────────────────────────────────────────────┘  │
│         ↓                                                   │
│  localStorage.setItem('user_env_overrides', ...)           │
│         ↓                                                   │
│  fetch('/api/user/preferences', { method: 'POST', ... })  │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  API Route (app/api/user/preferences/route.ts)              │
│  - Authenticates user                                       │
│  - Validates keys (only OPENCODE_ENABLED, NULLCLAW_ENABLED)│
│  - Saves to database                                        │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  Database (user_preferences table)                          │
│  user_id | preferences | updated_at                         │
│  --------|-------------|------------                        │
│  user123 | {"OPENCODE  | 2026-03-16...                     │
│          | _ENABLED":  |                                     │
│          | true}       |                                     │
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  Server-Side Code                                           │
│  const flags = await getEffectiveFeatureFlags(userId);     │
│  if (flags.OPENCODE_ENABLED) { /* Use OpenCode */ }        │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Created/Modified

### New Files:
1. **`app/api/user/preferences/route.ts`** - API endpoints for GET/POST preferences
2. **`lib/utils/feature-flags.ts`** - Helper functions for checking feature flags
3. **`migrations/0003_add_user_preferences.sql`** - Database migration

### Modified Files:
1. **`components/settings.tsx`** - Added User Feature Overrides section

---

## Usage

### In Client Components:
```typescript
// Check via CSS attribute (for UI gating)
const isOpenCodeEnabled = typeof window !== 'undefined' && 
  document.documentElement.getAttribute('data-opencode_enabled') === 'true';

// Or fetch from server
const response = await fetch('/api/user/preferences');
const { preferences } = await response.json();
```

### In Server Components/API Routes:
```typescript
import { getEffectiveFeatureFlags } from '@/lib/utils/feature-flags';

// Get effective flags (user prefs override env vars)
const flags = await getEffectiveFeatureFlags(userId);

if (flags.OPENCODE_ENABLED) {
  // Use OpenCode integration
} else {
  // Use default LLM
}

// Or check single flag
const canUseNullclaw = await isFeatureEnabled('NULLCLAW_ENABLED', userId);
```

### In CSS:
```css
/* Show/hide features based on user preference */
html[data-opencode_enabled="true"] .opencode-feature {
  display: block;
}

html[data-nullclaw_enabled="true"] .nullclaw-ui {
  display: flex;
}
```

---

## Database Schema

```sql
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY,
  preferences JSONB NOT NULL DEFAULT '{"OPENCODE_ENABLED": false, "NULLCLAW_ENABLED": false}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### GET /api/user/preferences
Get current user's feature preferences.

**Response:**
```json
{
  "success": true,
  "preferences": {
    "OPENCODE_ENABLED": true,
    "NULLCLAW_ENABLED": false
  }
}
```

### POST /api/user/preferences
Save feature preference override.

**Request:**
```json
{
  "OPENCODE_ENABLED": true
}
```

**Response:**
```json
{
  "success": true,
  "preferences": {
    "OPENCODE_ENABLED": true
  },
  "message": "Preferences saved successfully"
}
```

---

## Feature Flag Priority

1. **User Preferences** (highest priority - from database)
2. **Environment Variables** (fallback - from .env)
3. **Defaults** (lowest priority - hardcoded false)

```typescript
// Example priority resolution
userPrefs.OPENCODE_ENABLED (if exists)  → true/false
  ↓
process.env.OPENCODE_ENABLED (if exists) → 'true'/'false'
  ↓
DEFAULT_FLAGS.OPENCODE_ENABLED           → false
```

---

## Migration

Run the migration to add the `user_preferences` table:

```bash
# If you have a migration runner
pnpm migrate

# Or manually
sqlite3 data/bing.db < migrations/0003_add_user_preferences.sql
```

---

## Security

- ✅ **Authentication required** - Only logged-in users can save preferences
- ✅ **Key validation** - Only `OPENCODE_ENABLED` and `NULLCLAW_ENABLED` allowed
- ✅ **Type validation** - Values must be boolean
- ✅ **SQL injection protection** - Uses parameterized queries

---

## Future Enhancements

- [ ] Add more feature flags (V2_ENABLED, FAST_AGENT_ENABLED, etc.)
- [ ] Admin panel to manage global feature flags
- [ ] A/B testing support with percentage rollouts
- [ ] Feature flag analytics (track usage/engagement)
- [ ] Team/org-level feature flags (for enterprise)
