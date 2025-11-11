# Tambo Integration Plan

## Overview

Integrate Tambo AI (@tambo-ai/react) as a modular enhancement to enable generative UI components in chat responses without disrupting existing functionality.

## Integration Strategy: Hybrid Approach

Keep existing chat system fully functional while adding Tambo as an optional enhancement layer for advanced features.

### Architecture
```
User Message
    ↓
Priority Router (existing)
    ├─ Standard Response → Existing Message Bubble
    └─ Tambo-Enhanced Response → Tambo Component Rendering
```

## Key Design Decisions

1. **Non-Breaking Integration**: Tambo wraps chat area, doesn't replace it
2. **Conditional Rendering**: Use Tambo components only when response includes generative UI
3. **Fallback Handling**: Always fall back to existing message bubbles
4. **Feature Flag**: Easy to enable/disable Tambo via environment variable

## Implementation Phases

### Phase 1: Setup Tambo Provider

**Files:**
- `package.json` (MODIFIED) - Add @tambo-ai/react
- `app/layout.tsx` (MODIFIED) - Wrap with TamboProvider
- `contexts/tambo-context.tsx` (NEW) - Tambo configuration and state
- `.env` (MODIFIED) - Add TAMBO_API_KEY

### Phase 2: Create Tambo Components Registry

**Files:**
- `components/tambo/tambo-components.tsx` (NEW) - Register UI components
- `components/tambo/tambo-tools.tsx` (NEW) - Register tools/functions

### Phase 3: Enhance Message Rendering

**Files:**
- `components/message-bubble.tsx` (MODIFIED) - Detect and render Tambo components
- `components/tambo/tambo-message-renderer.tsx` (NEW) - Tambo-specific rendering logic

### Phase 4: Integrate with Chat Panel

**Files:**
- `components/chat-panel.tsx` (MODIFIED) - Use Tambo hooks for sending messages
- `hooks/use-tambo-chat.ts` (NEW) - Wrapper around Tambo hooks

## Out of Scope (v1)

- **Complete replacement of existing chat** - Tambo is additive only
- **Migration of all existing functionality to Tambo** - Hybrid approach
- **Tambo UI component library** - Use custom components initially
- **Advanced Tambo features** - Focus on basic generative UI first

## Implementation Details

### Environment Variables
```env
NEXT_PUBLIC_TAMBO_ENABLED=false
NEXT_PUBLIC_TAMBO_API_KEY=your_api_key
```

### TamboProvider Wrapper
```typescript
// Only wrap if enabled
{TAMBO_ENABLED ? (
  <TamboProvider {...config}>
    {children}
  </TamboProvider>
) : children}
```

### Message Detection
```typescript
// Check if message contains Tambo component
const isTamboMessage = message.metadata?.useTambo || 
                       message.components?.length > 0;

return isTamboMessage ? (
  <TamboMessageRenderer message={message} />
) : (
  <MessageBubble message={message} /> // Existing
);
```

## Benefits

1. ✅ Non-breaking - existing chat continues to work
2. ✅ Modular - easy to enable/disable
3. ✅ Flexible - can gradually migrate features
4. ✅ Safe - fallback to existing system always available

## Next Steps

1. Install @tambo-ai/react package
2. Create TamboProvider wrapper
3. Implement component detection logic
4. Test with simple Tambo component
5. Expand component library as needed
