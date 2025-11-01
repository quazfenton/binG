# Debug Logging Implementation Summary

## Overview
Added comprehensive debug logging to track down API call failures in the binG application.

## Issues Being Debugged
1. **Chat Tab**: "Failed to parse stream string. Invalid code event." error
2. **Code Tab**: 400 error immediately when sending prompt

## Debug Logging Added to Files

### 1. `/app/api/chat/route.ts` - Chat API Endpoint
**Debug Points Added:**
- Request received
- Request body parsing (shows provider, model, message count)
- Validation failures (messages, provider, model)
- Available providers list
- Provider/model selection
- Streaming initialization

**Key Logs to Watch:**
```
[DEBUG] Chat API: Incoming request
[DEBUG] Chat API: Request body parsed: { provider, model, messageCount, ... }
[DEBUG] Chat API: Available providers: [...]
[DEBUG] Chat API: Validation passed, starting response generation
[DEBUG] Chat API: Sending init event
```

### 2. `/app/api/code/route.ts` - Code API Endpoint
**Debug Points Added:**
- Request received
- Content-Type validation
- Request body parsing (shows action, prompt, files)
- Action field validation
- Action routing (start_session, get_session_status, etc.)

**Key Logs to Watch:**
```
[DEBUG] Code API: Incoming request
[DEBUG] Code API: Content-Type: application/json
[DEBUG] Code API: Request body parsed: { action, hasPrompt, ... }
[DEBUG] Code API: Processing action: start_session
[DEBUG] Code API: Handling start_session
```

### 3. `/hooks/use-enhanced-chat.ts` - Chat Hook
**Debug Points Added:**
- handleSubmit called
- Request construction
- Fetch request sent
- Response status
- Streaming start
- Line-by-line parsing
- Event type detection
- JSON parsing (success and failures)
- Event processing

**Key Logs to Watch:**
```
[DEBUG] useEnhancedChat: handleSubmit called
[DEBUG] useEnhancedChat: Sending request to /api/chat
[DEBUG] useEnhancedChat: Response received, status: 200
[DEBUG] useEnhancedChat: Starting to handle streaming response
[DEBUG] useEnhancedChat: Event type: init
[DEBUG] useEnhancedChat: Data line received, length: 123
[DEBUG] useEnhancedChat: Parsed event data: { type: 'token', hasContent: true }
[DEBUG] useEnhancedChat: Processing event type: token
```

### 4. `/lib/code-service.ts` - Code Service
**Debug Points Added:**
- startSession called
- Current mode check
- Mode validation
- Options validation

**Key Logs to Watch:**
```
[DEBUG] CodeService: startSession called
[DEBUG] CodeService: Current mode: code
[DEBUG] CodeService: Validating options
```

## How to Use the Debug Logs

### Step 1: Open Browser DevTools
- Press F12 or right-click > Inspect
- Go to Console tab
- Filter by typing "[DEBUG]" in the filter box

### Step 2: Reproduce the Issue
1. For Chat Tab:
   - Switch to Chat tab
   - Enter a prompt
   - Click Send
   - Watch the console logs

2. For Code Tab:
   - Switch to Code tab
   - Enter a prompt
   - Click Send
   - Watch the console logs

### Step 3: Analyze the Log Sequence
The logs follow a specific order. Look for where the sequence breaks:

**Expected Chat Flow:**
```
useEnhancedChat: handleSubmit called
  → useEnhancedChat: Sending request to /api/chat
    → Chat API: Incoming request
    → Chat API: Request body parsed
    → Chat API: Available providers
    → Chat API: Validation passed
    → Chat API: Sending init event
  → useEnhancedChat: Response received
  → useEnhancedChat: Starting to handle streaming response
  → useEnhancedChat: Event type: [type]
  → useEnhancedChat: Data line received
  → useEnhancedChat: Parsed event data
  → useEnhancedChat: Processing event type: [type]
```

**Expected Code Flow:**
```
CodeService: startSession called
  → CodeService: Current mode: code
  → CodeService: Validating options
  → Code API: Incoming request
  → Code API: Request body parsed
  → Code API: Processing action: start_session
  → Code API: Handling start_session
```

### Step 4: Identify the Break Point
- **Missing logs**: Indicates request never reached that point
- **Error logs**: Shows validation or processing failures
- **Unexpected values**: Shows incorrect data being passed

## Common Issues and Their Debug Signatures

### Issue 1: Provider/Model Not Configured
**Debug Output:**
```
[DEBUG] Chat API: Validation failed - missing provider or model { provider: undefined, model: undefined }
```
**Cause:** LLM selector not properly setting values
**Location:** conversation-interface.tsx where it sets options.body

### Issue 2: Not in Code Mode
**Debug Output:**
```
[DEBUG] CodeService: Current mode: chat
[DEBUG] CodeService: Not in code mode
```
**Cause:** Mode manager not switching properly
**Location:** conversation-interface.tsx useEffect for activeTab

### Issue 3: Missing Action Field
**Debug Output:**
```
[DEBUG] Code API: Invalid action field: undefined undefined
```
**Cause:** Request not including 'action' parameter
**Location:** code-service.ts startSession method

### Issue 4: Malformed Streaming Data
**Debug Output:**
```
[DEBUG] useEnhancedChat: Data line received, length: 234, preview: {...
[DEBUG] useEnhancedChat: JSON parse failed, trying fallback: SyntaxError...
```
**Cause:** Server sending incorrectly formatted SSE
**Location:** app/api/chat/route.ts streaming response construction

### Issue 5: Event Type Not Recognized
**Debug Output:**
```
[DEBUG] useEnhancedChat: Processing event type: unknown_type
```
**Cause:** Server sending non-standard event types
**Location:** Need to update event type switch case in use-enhanced-chat.ts

## Next Steps

1. **Run the application** with the debug logging
2. **Reproduce both errors** (Chat tab and Code tab)
3. **Copy the complete debug output** from the console
4. **Share the logs** to identify the exact failure point
5. **Apply targeted fix** based on where the logs show the break

## Potential Quick Fixes

Based on common patterns, here are likely fixes:

### If Chat fails at validation:
Check `conversation-interface.tsx` around line 160-190 where it creates the chat body. Ensure provider and model are included.

### If Code fails at mode check:
Check `conversation-interface.tsx` around line 113-121 where activeTab changes. Ensure `setCurrentMode(activeTab)` is called before any code operations.

### If Code fails at action:
Check `code-service.ts` around line 62-67 where requestBody is created. Ensure it includes `action: 'start_session'`.

### If streaming fails to parse:
Check `app/api/chat/route.ts` around lines 196-203 where token events are emitted. Ensure proper JSON.stringify() and SSE format.

## Files Reference

All debug-enabled files:
- `/app/api/chat/route.ts`
- `/app/api/code/route.ts`
- `/hooks/use-enhanced-chat.ts`
- `/lib/code-service.ts`

Additional documentation:
- `DEBUG_PLAN.md` - Original debug planning
- `DEBUG_INSTRUCTIONS.md` - Detailed usage instructions
- `DEBUG_SUMMARY.md` - This file
