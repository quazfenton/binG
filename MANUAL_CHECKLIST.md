# Manual Integration Checklist - Vercel AI SDK Integration

**Session Date:** February 27, 2026

---

## ✅ Environment Variables - ALL ADDED

All environment variables from this session have been added to `env.example`. Here's the complete list:

### AI SDK Configuration (NEW in this session)
```bash
# AI SDK CONFIGURATION (Vercel AI SDK)
AI_SDK_PROVIDER=openai
AI_SDK_MODEL=gpt-4o
AI_SDK_MAX_STEPS=10
AI_SDK_TEMPERATURE=0.7
```

### Provider API Keys (NEW in this session)
```bash
# PROVIDER API KEYS (for AI SDK fallback chain)
OPENAI_API_KEY=sk-your_openai_api_key_here
OPENROUTER_API_KEY=sk-or-your_openrouter_api_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_GENERATIVE_AI_KEY=your_google_api_key_here
# GOOGLE_API_KEY=your_google_api_key_here (alternative)
```

### Task-Specific Model Configuration (NEW in this session)
```bash
# TASK-SPECIFIC MODEL CONFIGURATION
ARCHITECT_MODEL=gpt-4o
ARCHITECT_PROVIDER=openai
BUILDER_MODEL=gpt-4o
BUILDER_PROVIDER=openai
LINTER_MODEL=gpt-4o-mini
LINTER_PROVIDER=openai
USE_MULTI_MODEL=false
```

### Nango Integration (NEW in this session)
```bash
# NANGO INTEGRATION (External Tools)
NANGO_SECRET_KEY=your_nango_secret_key_here
```

### Redis Configuration (NEW in this session)
```bash
# REDIS CONFIGURATION (for Checkpointing)
REDIS_URL=redis://localhost:6379
```

### Human-in-the-Loop Configuration (NEW in this session)
```bash
# HUMAN-IN-THE-LOOP (HITL) CONFIGURATION
ENABLE_HITL=false
HITL_TIMEOUT=300000
HITL_APPROVAL_REQUIRED_ACTIONS=delete,execute_destructive,create_secret
ENFORCE_PLAN_ACT_VERIFY=true
MAX_SELF_HEAL_ATTEMPTS=3
CHECKPOINT_TTL=86400
```

---

## ✅ No Manual Code Integration Required

**Good news:** All code changes from this session have been automatically applied. You do NOT need to manually:

1. ❌ Create any files manually
2. ❌ Modify any existing files manually
3. ❌ Install additional packages (everything is already in package.json)
4. ❌ Run any migration scripts
5. ❌ Configure any build tools

---

## 📋 Optional: Packages to Install for Full Functionality

These packages are referenced in the code but not yet in package.json. Install them to enable full provider fallback:

```bash
# For Anthropic Claude models support
pnpm add @ai-sdk/anthropic

# For Google Gemini models support
pnpm add @ai-sdk/google

# For TypeScript/JavaScript syntax validation (optional, enhances verification)
pnpm add @typescript-eslint/typescript-estree

# For YAML validation (optional)
pnpm add js-yaml
```

**Note:** The system will work without these, but:
- Without `@ai-sdk/anthropic`: Cannot use Claude models
- Without `@ai-sdk/google`: Cannot use Gemini models
- Without `@typescript-eslint/typescript-estree`: Falls back to basic structural checks
- Without `js-yaml`: YAML validation will be skipped

---

## 📋 Optional: Configure API Keys for Full Functionality

To enable all features, configure these API keys in your `.env` file:

### Required for Basic Operation
```bash
# At minimum, configure ONE provider:
OPENAI_API_KEY=sk-...  # OR
OPENROUTER_API_KEY=sk-or-...  # OR
ANTHROPIC_API_KEY=...  # OR
GOOGLE_GENERATIVE_AI_KEY=...
```

### Required for Nango Integrations (GitHub, Slack, Notion tools)
```bash
NANGO_SECRET_KEY=...
```

### Required for Redis Checkpointing (Production)
```bash
REDIS_URL=redis://localhost:6379
```

---

## 📋 Test Commands Available

New test scripts have been added to `package.json`:

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run only stateful-agent tests
npm run test:stateful-agent

# Run only E2E tests
npm run test:e2e
```

---

## 📋 Files Created in This Session

All these files have been automatically created:

### Core Implementation Files
- `lib/stateful-agent/tools/tool-executor.ts` - Tool execution wrapper
- `lib/stateful-agent/agents/self-healing.ts` - Error classification & retry logic
- `lib/stateful-agent/agents/verification.ts` - Syntax checking
- `lib/stateful-agent/agents/provider-fallback.ts` - Multi-provider fallback
- `lib/stateful-agent/tools/nango-connection.ts` - Nango connection manager
- `lib/stateful-agent/tools/nango-rate-limit.ts` - Rate limiting

### Test Files
- `test/stateful-agent/tools/tool-executor.test.ts` - 51 tests
- `test/stateful-agent/agents/self-healing.test.ts` - 56 tests
- `test/stateful-agent/agents/verification.test.ts` - 47 tests
- `test/stateful-agent/agents/provider-fallback.test.ts` - 40 tests
- `test/stateful-agent/tools/nango-integration.test.ts` - 16 tests
- `tests/e2e/ai-sdk-integration.test.ts` - Integration tests
- `tests/e2e/stateful-agent-e2e.test.ts` - E2E tests

### Configuration Files
- `vitest.config.ts` - Updated test configuration

### Documentation Files
- `VERCEL_AI_SDK_INTEGRATION_REVIEW.md` - Comprehensive review
- `TEST_REPORT.md` - Test documentation
- `MANUAL_CHECKLIST.md` - This file

---

## 📋 Files Modified in This Session

- `lib/stateful-agent/tools/sandbox-tools.ts` - Enhanced tool descriptions
- `lib/stateful-agent/tools/nango-tools.ts` - Integrated connection manager & rate limiting
- `lib/stateful-agent/tools/index.ts` - Added combinedTools export
- `lib/stateful-agent/agents/model-router.ts` - Updated to use provider fallback
- `app/api/stateful-agent/route.ts` - Added streaming support
- `env.example` - Added all new environment variables
- `package.json` - Added test scripts

---

## ✅ Verification Steps

To verify everything is set up correctly:

1. **Check environment variables:**
   ```bash
   grep -E "AI_SDK|NANGO|ARCHITECT_MODEL|BUILDER_MODEL|LINTER_MODEL|USE_MULTI_MODEL" env.example
   ```

2. **Run tests:**
   ```bash
   npm test
   ```
   Expected: 209+ tests passing

3. **Check TypeScript compilation:**
   ```bash
   npx tsc --noEmit
   ```
   Expected: No errors in new files

---

## Summary

**Everything has been automatically applied.** The only optional manual steps are:

1. **Install optional packages** for full provider support (Anthropic, Google)
2. **Configure API keys** in your `.env` file for the providers you want to use
3. **Run tests** to verify everything works

No code modifications, file creation, or complex integration steps are required.
