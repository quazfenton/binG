# Mastra Integration - Installation & Setup Guide

**Date**: February 27, 2026
**Status**: ✅ **CODE COMPLETE** - Installation Required

---

## 📦 Installation

### Step 1: Install Mastra Packages

```bash
cd C:\Users\ceclabs\Downloads\binG

# Install core Mastra packages
pnpm add @mastra/core @mastra/agents @mastra/workflows

# Install additional packages if needed
pnpm add @mastra/memory @mastra/evals @mastra/mcp
```

### Step 2: Verify Installation

```bash
# Check packages installed
pnpm list @mastra/core

# Should show: @mastra/core@x.x.x
```

---

## 🔧 TypeScript Configuration

### Update tsconfig.json (if needed)

Ensure path aliases are configured:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@/lib/*": ["lib/*"]
    }
  }
}
```

---

## 📝 Environment Variables

Add to `.env.local`:

```env
# Mastra Configuration
MASTRA_TELEMETRY_ENABLED=false
MASTRA_DEFAULT_MODEL=openai/gpt-4o
MASTRA_FAST_MODEL=openai/gpt-4o-mini
MASTRA_CODER_MODEL=anthropic/claude-3-5-sonnet-20241022
MASTRA_COST_EFFECTIVE_MODEL=google/gemini-2-0-flash
MASTRA_MAX_STEPS=10
MASTRA_ENABLE_SUSPEND_RESUME=true

# Optional: Custom storage (uses existing DATABASE_URL by default)
# MASTRA_STORAGE_URL=postgresql://...
```

---

## 🚀 Usage Examples

### Example 1: Run Code Agent Workflow

```typescript
// Client-side code
const response = await fetch('/api/mastra/workflow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    task: 'Create a hello world TypeScript file',
    ownerId: 'user-123',
    workflowType: 'code-agent',
  }),
});

// Read SSE stream
const reader = response.body?.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader!.read();
  if (done) break;
  
  const event = decoder.decode(value);
  console.log('Event:', event);
}
```

### Example 2: HITL Approval Flow

```typescript
// Start workflow
const startResponse = await fetch('/api/mastra/workflow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    code: 'export const hello = "world";',
    description: 'Simple export statement',
    ownerId: 'user-123',
    workflowType: 'hitl-code-review',
  }),
});

// Workflow suspends for approval
// Get runId from response or status endpoint

// Approve the code
const approveResponse = await fetch('/api/mastra/resume', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    runId: 'xxx-xxx-xxx',
    approved: true,
  }),
});
```

### Example 3: Check Workflow Status

```typescript
const statusResponse = await fetch(
  '/api/mastra/status?runId=xxx-xxx-xxx&workflowType=code-agent'
);

const status = await statusResponse.json();
console.log('Workflow status:', status);
```

---

## 📁 File Structure

```
lib/mastra/
├── index.ts                    # Main exports
├── mastra-instance.ts          # Mastra configuration
├── models/
│   └── model-router.ts         # Model selection (4 tiers)
├── tools/
│   └── index.ts                # 7 schema-validated tools
└── workflows/
    ├── code-agent-workflow.ts  # Planner → Executor → Critic
    └── hitl-workflow.ts        # Suspend/resume for approval

app/api/mastra/
├── workflow/route.ts           # SSE streaming execution
├── resume/route.ts             # HITL resume endpoint
└── status/route.ts             # Status check endpoint
```

---

## 🛠️ Available Tools

### Virtual Filesystem Tools

| Tool | Description |
|------|-------------|
| `WRITE_FILE` | Create or update files |
| `READ_FILE` | Read file contents |
| `DELETE_PATH` | Delete files/directories |
| `LIST_FILES` | List directory contents |

### Sandbox Execution Tools

| Tool | Description |
|------|-------------|
| `EXECUTE_CODE` | Run code in sandbox |
| `SYNTAX_CHECK` | Validate syntax before execution |
| `INSTALL_DEPS` | Install package dependencies |

---

## 🔄 Model Tiers

| Tier | Model | Cost/1M tokens | Use Case |
|------|-------|----------------|----------|
| `fast` | GPT-4o-mini | ~$0.15 | Simple tasks, classification |
| `reasoning` | GPT-4o | ~$2.50 | Analysis, planning |
| `coder` | Claude 3.5 Sonnet | ~$3.00 | Code generation |
| `costEffective` | Gemini 2.0 Flash | ~$0.075 | Draft generation |

---

## 🐛 Troubleshooting

### Error: Cannot find module '@mastra/core'

**Solution**: Install packages:
```bash
pnpm add @mastra/core @mastra/agents @mastra/workflows
```

### Error: Workflow not found

**Solution**: Ensure workflow is registered in `mastra-instance.ts`:
```typescript
export const mastra = new Mastra({
  workflows: {
    'code-agent': codeAgentWorkflow,
    'hitl-code-review': hitlWorkflow,
  },
});
```

### Error: Database connection failed

**Solution**: Ensure `DATABASE_URL` is set in `.env.local`:
```env
DATABASE_URL=postgresql://user:pass@localhost:5432/bing
```

---

## ✅ Verification Checklist

- [ ] Mastra packages installed
- [ ] TypeScript compiles without errors
- [ ] Environment variables configured
- [ ] API endpoints respond
- [ ] Workflow execution works
- [ ] HITL suspend/resume works
- [ ] Model routing works

---

## 📚 Documentation Links

- [Mastra Docs](https://mastra.ai/docs)
- [Agents Overview](https://mastra.ai/docs/agents/overview)
- [Workflows Overview](https://mastra.ai/docs/workflows/overview)
- [Tools Overview](https://mastra.ai/docs/tools/overview)
- [Suspend/Resume](https://mastra.ai/docs/workflows/suspend-and-resume)

---

**Status**: ✅ **READY FOR INSTALLATION**
**Next Step**: Run `pnpm add @mastra/core @mastra/agents @mastra/workflows`
