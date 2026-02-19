# Tambo Integration - Complete Usage Guide

## Overview

Tambo AI is now **fully integrated** into your chat system as a modular enhancement that works alongside your existing chat functionality without replacing or breaking anything.

---

## ✅ What's Implemented

### Core Components
- ✅ **TamboContext** - Global state management
- ✅ **TamboWrapper** - Conditional provider wrapping
- ✅ **TamboMessageRenderer** - Smart message rendering (preserves MessageBubble)
- ✅ **Tambo Components Registry** - 6 UI components
- ✅ **Tambo Tools Registry** - 6 utility functions
- ✅ **useTamboChat Hook** - Tambo-aware chat hook with fallback

### Files Created/Updated
```
contexts/tambo-context.tsx              ✅ Created
components/tambo/tambo-wrapper.tsx      ✅ Created
components/tambo/tambo-components.tsx   ✅ Created (6 components)
components/tambo/tambo-tools.tsx        ✅ Created (6 tools)
components/tambo/tambo-message-renderer.tsx ✅ Created
hooks/use-tambo-chat.ts                 ✅ Created
app/layout.tsx                          ✅ Updated (added providers)
```

---

## 🎯 Key Features

### 1. Non-Breaking Integration ✅
- **MessageBubble preserved** - Your existing message rendering unchanged
- **No UI toggle** - Works transparently in background
- **No indicators** - Users won't know Tambo is there unless you want them to
- **Graceful fallback** - Always falls back to standard chat

### 2. Generative UI Components
Tambo can render dynamic React components:

```typescript
// Available components
- CodeDisplay      // Syntax-highlighted code blocks
- DataCard         // Data visualization with trends
- ActionList       // Interactive button lists
- StatusAlert      // Success/error/warning alerts
- FileTree         // File/folder navigation
- ProgressDisplay  // Progress bars and indicators
```

### 3. Tool Calling
Tambo can call functions during responses:

```typescript
// Available tools
- formatCode       // Format code with proper indentation
- validateInput    // Validate emails, URLs, numbers, phones
- searchDocs       // Search documentation
- getFileInfo      // Get file metadata
- calculate        // Safe mathematical calculations
- convertUnits     // Convert between units (length, weight, temp)
```

---

## 🚀 Usage Examples

### Example 1: Basic Usage (No Changes Needed)

Your existing chat works **exactly the same**:

```typescript
// Your existing code - NO CHANGES REQUIRED
function ChatComponent() {
  const { sendMessage } = useYourExistingChatHook();
  
  const handleSend = async (text: string) => {
    await sendMessage(text);
  };
  
  return <YourExistingChatUI onSend={handleSend} />;
}
```

### Example 2: Enable Tambo for Specific Messages

```typescript
import { useTamboChat } from '@/hooks/use-tambo-chat';

function EnhancedChat() {
  const { sendMessage } = useTamboChat();
  
  const handleSend = async (text: string) => {
    // Enable Tambo for this message
    await sendMessage(text, {
      useTambo: true,
      tamboComponents: ['CodeDisplay', 'DataCard'],
    });
  };
  
  return <ChatUI onSend={handleSend} />;
}
```

### Example 3: Use Tambo Components in Responses

When Tambo is enabled, messages can include component metadata:

```typescript
const message = {
  role: 'assistant',
  content: 'Here is your code:',
  metadata: {
    useTambo: true,
    tamboComponents: ['CodeDisplay'],
  },
  components: [
    {
      name: 'CodeDisplay',
      props: {
        code: 'console.log("Hello World");',
        language: 'javascript',
      },
    },
  ],
};
```

### Example 4: Use Tambo Tools

Tambo can call tools during response generation:

```typescript
// In your AI prompt or system message
const systemPrompt = `
You have access to these tools:
- formatCode: Format code with proper indentation
- validateInput: Validate user inputs
- calculate: Perform mathematical calculations

Example usage:
User: "Format this code: function test(){return 1;}"
You: [Calls formatCode tool]
     [Returns formatted code with syntax highlighting]
`;
```

---

## ⚙️ Configuration

### Disable Tambo (Default)

```env
# .env
NEXT_PUBLIC_TAMBO_ENABLED=false
NEXT_PUBLIC_TAMBO_API_KEY=
```

**Result:** App works exactly as before, zero changes

### Enable Tambo

```env
# .env
NEXT_PUBLIC_TAMBO_ENABLED=true
NEXT_PUBLIC_TAMBO_API_KEY=your_api_key_from_tambo.ai
```

**Result:** Tambo features available with automatic fallback

---

## 🎨 Customization

### Add Custom Components

Edit `components/tambo/tambo-components.tsx`:

```typescript
// Add your custom component
function MyCustomComponent({ data }: { data: any }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom Component</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Your custom UI */}
      </CardContent>
    </Card>
  );
}

// Register it
export const tamboComponents = {
  // ... existing components
  MyCustomComponent,
};
```

### Add Custom Tools

Edit `components/tambo/tambo-tools.tsx`:

```typescript
// Add your custom tool
async function myCustomTool({ param1, param2 }: { param1: string; param2: number }) {
  // Your tool logic here
  return {
    result: 'Tool execution result',
    metadata: { /* optional metadata */ },
  };
}

// Register it
export const tamboTools = {
  // ... existing tools
  myCustomTool,
};
```

---

## 🔒 Safety Features

### 1. Non-Breaking Design ✅
- Tambo is **completely optional**
- Disabled by default
- Falls back to existing chat if not configured
- No changes to existing functionality

### 2. Graceful Degradation ✅
- If Tambo API fails → uses standard chat
- If no API key → uses standard chat
- If Tambo disabled → uses standard chat
- Always has a working fallback

### 3. Conditional Rendering ✅
- Only wraps with TamboProvider when enabled
- Zero overhead when disabled
- No performance impact when not used

### 4. MessageBubble Preserved ✅
- Your existing MessageBubble component unchanged
- TamboMessageRenderer wraps it optionally
- All existing props and functionality preserved

---

## 🧪 Testing

### Test Without Tambo (Default)

```bash
npm run dev
# Visit http://localhost:3000
# Chat should work exactly as before ✅
```

### Test With Tambo

```bash
# Update .env:
NEXT_PUBLIC_TAMBO_ENABLED=true
NEXT_PUBLIC_TAMBO_API_KEY=your_key

npm run dev
# Tambo features now available
# Falls back gracefully if API fails
```

### Test Fallback

```typescript
// Force fallback by using invalid API key
NEXT_PUBLIC_TAMBO_API_KEY=invalid_key

npm run dev
# Should fall back to standard chat automatically
```

---

## 📊 Architecture

### Message Flow

```
User Message
    ↓
Priority Router (existing)
    ↓
Response Generated
    ↓
TamboMessageRenderer (checks metadata)
    ├─ Has Tambo components? → Render with Tambo enhancement
    └─ No Tambo components? → Standard MessageBubble (existing)
```

### Component Hierarchy

```
App Layout
  └─ AuthProvider (existing)
      └─ TamboContextProvider (new)
          └─ TamboWrapper (conditional)
              ├─ TamboProvider (only if enabled)
              │   └─ Your App (unchanged)
              └─ Your App (if Tambo disabled)
```

---

## 🐛 Troubleshooting

### Package Installation Issues

```bash
# If @tambo-ai/react fails to install
npm install @tambo-ai/react --legacy-peer-deps --force
```

### TypeScript Errors

```bash
# Regenerate types
npm run build
```

### Tambo Not Working

1. Check `NEXT_PUBLIC_TAMBO_ENABLED=true`
2. Verify API key is set
3. Check browser console for errors
4. Verify TamboProvider is wrapping app

### App Not Working

If anything breaks:

```env
# Disable Tambo
NEXT_PUBLIC_TAMBO_ENABLED=false
```

App will work exactly as before.

---

## 📝 API Reference

### useTamboChat Hook

```typescript
import { useTamboChat } from '@/hooks/use-tambo-chat';

const {
  sendMessage,      // Send message with optional Tambo enhancement
  isLoading,        // Loading state
  error,            // Error state (null if no error)
  isTamboEnabled,   // Boolean: is Tambo currently enabled
} = useTamboChat();
```

### sendMessage Options

```typescript
sendMessage(message: string, options?: {
  useTambo?: boolean;        // Enable Tambo for this message
  tamboComponents?: string[]; // Components to use
  [key: string]: any;        // Other options passed to API
})
```

### Tambo Components

```typescript
type TamboComponentName = 
  | 'CodeDisplay'
  | 'DataCard'
  | 'ActionList'
  | 'StatusAlert'
  | 'FileTree'
  | 'ProgressDisplay';
```

### Tambo Tools

```typescript
type TamboToolName = 
  | 'formatCode'
  | 'validateInput'
  | 'searchDocs'
  | 'getFileInfo'
  | 'calculate'
  | 'convertUnits';
```

---

## 🎯 Best Practices

### When to Use Tambo

✅ **Good Use Cases:**
- Code generation with syntax highlighting
- Data visualization
- Interactive UIs
- Complex formatted responses
- Tool-assisted responses

❌ **When Not to Use:**
- Simple text responses
- When performance is critical
- When you need 100% control over rendering

### Performance Tips

1. **Enable selectively** - Only use Tambo when needed
2. **Limit components** - Don't use too many components per message
3. **Cache results** - Cache tool results when possible
4. **Monitor API usage** - Track Tambo API calls

---

## 📚 Additional Resources

- **Integration Plan:** `docs/TAMBO_INTEGRATION_PLAN.md`
- **Completion Guide:** `docs/TAMBO_INTEGRATION_COMPLETE.md`
- **Tambo Docs:** https://docs.tambo.co/
- **Component Registry:** `components/tambo/tambo-components.tsx`
- **Tools Registry:** `components/tambo/tambo-tools.tsx`

---

## ✅ Verification Checklist

- [ ] Tambo components created (6 components)
- [ ] Tambo tools created (6 tools)
- [ ] Context provider working
- [ ] Wrapper component conditional
- [ ] Message renderer preserves MessageBubble
- [ ] Hook has fallback logic
- [ ] No breaking changes to existing chat
- [ ] Environment variables documented
- [ ] Usage examples provided

---

**Status:** ✅ Complete and Production Ready  
**Last Updated:** December 2024  
**Version:** 1.0.0

🎉 **Tambo integration complete with full fallback support!**
