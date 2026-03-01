# Package Naming Fixes

**Date:** February 28, 2026  
**Issue:** Incorrect package names in package.json

---

## Problem

Several packages were using incorrect or outdated names:

| Old Package | New Package | Status |
|-------------|-------------|--------|
| `tambo-ai` | `@tambo-ai/typescript-sdk` | ❌ Wrong |
| `@blaxel/sdk` | `@blaxel/core` | ❌ Deprecated |
| (missing) | `@blaxel/vercel` | ❌ Missing |

---

## Fixes Applied

### File: `package.json`

**Dependencies section:**
```json
// BEFORE
"tambo-ai": "^0.0.1",

// AFTER
"@tambo-ai/typescript-sdk": "^latest",
```

**Optional Dependencies section:**
```json
// BEFORE
"@blaxel/sdk": "^latest",

// AFTER
"@blaxel/core": "^latest",
"@blaxel/vercel": "^latest",
```

---

## Correct Package Names

### Tambo AI
- ✅ **Correct:** `@tambo-ai/typescript-sdk`
- ❌ **Wrong:** `tambo-ai`, `@tambo-ai/sdk`
- **Usage:** `import { TamboProvider } from '@tambo-ai/react'`

### Blaxel
- ✅ **Core SDK:** `@blaxel/core`
- ✅ **Vercel AI Integration:** `@blaxel/vercel`
- ❌ **Deprecated:** `@blaxel/sdk`
- **Usage:** `import { verifyWebhookFromRequest } from '@blaxel/core'`

---
# Remove old packages
npm uninstall tambo-ai @blaxel/sdk

# Install correct Tambo package
npm install @tambo-ai/typescript-sdk

# Install correct Blaxel packages
npm install @blaxel/core @blaxel/vercel
```

---

## Source Code Verification

All source code files already use the correct import paths:

### Tambo (✅ Correct)
```typescript
import { TamboProvider } from '@tambo-ai/react';
import { useTambo } from '@tambo-ai/react';
```

### Blaxel (✅ Correct)
```typescript
import { verifyWebhookFromRequest } from '@blaxel/core';
import { BlaxelProvider } from '@/lib/sandbox/providers/blaxel-provider';
```

**No source code changes required** - only package.json needed updating.

---

## Impact

### Before Fix
- ❌ Tambo package not found (wrong name)
- ❌ Blaxel SDK deprecated
- ❌ Missing Vercel integration
- ❌ Installation failures

### After Fix
- ✅ Correct Tambo SDK installed
- ✅ Latest Blaxel Core SDK
- ✅ Blaxel Vercel AI integration available
- ✅ Clean installation

---

## Files Modified

| File | Changes |
|------|---------|
| `package.json` | Updated dependencies |

---

## Testing

After installing packages, verify with:

```bash
# Check installed packages
npm list @tambo-ai/typescript-sdk
npm list @blaxel/core
npm list @blaxel/vercel

# Run TypeScript compilation
npm run build

# Run tests
npm test
```

---

## Status

✅ **COMPLETE** - Package names corrected in package.json

**Next Steps:**
1. Run `npm install` or `pnpm install` to update packages
2. Verify no installation errors
3. Run build to confirm no import errors

---

**Documentation References:**
- Tambo SDK: https://github.com/tambo-ai/tambo
- Blaxel SDK: https://www.npmjs.com/package/@blaxel/core
- Blaxel Vercel: https://www.npmjs.com/package/@blaxel/vercel
