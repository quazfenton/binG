# Debug Instructions for binG API Issues

## Debug Logging Added

I've added comprehensive debug logging to track down the API failures. The logs will appear in the browser console with `[DEBUG]` prefix.

### Files Modified with Debug Logging:

1. **`/app/api/chat/route.ts`**
   - Logs incoming requests
   - Logs request body validation
   - Logs provider/model validation
   - Logs streaming event sending

2. **`/app/api/code/route.ts`**
   - Logs incoming requests
   - Logs content-type validation
   - Logs action processing
   - Logs each action handler

3. **`/hooks/use-enhanced-chat.ts`**
   - Logs handleSubmit calls
   - Logs request construction
   - Logs response status
   - Logs streaming line-by-line parsing
   - Logs event type detection
   - Logs JSON parsing failures

4. **`/lib/code-service.ts`**
   - Logs session start
   - Logs mode validation
   - Logs option validation

## How to Debug:

### Step 1: Open Browser Console
1. Open your browser's Developer Tools (F12)
2. Go to the Console tab
3. Filter by `[DEBUG]` to see only debug logs

### Step 2: Test Chat Tab
1. Switch to the Chat tab
2. Enter any prompt
3. Submit
4. Look for the debug sequence in console:
   ```
   [DEBUG] useEnhancedChat: handleSubmit called
   [DEBUG] useEnhancedChat: Sending request to /api/chat
   [DEBUG] Chat API: Incoming request
   [DEBUG] Chat API: Request body parsed
   [DEBUG] Chat API: Available providers
   [DEBUG] Chat API: Validation passed
   [DEBUG] useEnhancedChat: Response received
   [DEBUG] useEnhancedChat: Event type: [event name]
   [DEBUG] useEnhancedChat: Data line received
   ```

### Step 3: Test Code Tab
1. Switch to the Code tab
2. Enter any prompt
3. Submit
4. Look for the debug sequence:
   ```
   [DEBUG] CodeService: startSession called
   [DEBUG] CodeService: Current mode: code
   [DEBUG] Code API: Incoming request
   [DEBUG] Code API: Content-Type: application/json
   [DEBUG] Code API: Request body parsed
   [DEBUG] Code API: Processing action: start_session
   ```

### Step 4: Identify the Failure Point

#### For Chat Tab "Failed to parse stream string" Error:
- Look for where the event parsing fails
- Check what event type is being received
- Check the data line content that fails to parse
- The error likely occurs in the `useEnhancedChat: JSON parse failed` section

#### For Code Tab 400 Error:
- Check if mode is set correctly (should be 'code')
- Check if request body has the correct structure
- Check if action field is present and valid
- Look for validation failures in the debug logs

## Expected Issues to Find:

### Issue 1: Provider/Model Not Set (Chat Tab)
If you see:
```
[DEBUG] Chat API: Validation failed - missing provider or model
```
**Fix**: Ensure LLM selector is properly setting provider and model in the request body.

### Issue 2: Mode Not Set (Code Tab)
If you see:
```
[DEBUG] CodeService: Current mode: chat
[DEBUG] CodeService: Not in code mode
```
**Fix**: The mode manager isn't switching properly. Check `setCurrentMode` calls.

### Issue 3: Missing Action Field (Code Tab)
If you see:
```
[DEBUG] Code API: Invalid action field: undefined undefined
```
**Fix**: The code service isn't including 'action' in the request body.

### Issue 4: Invalid Event Format (Chat Tab)
If you see:
```
[DEBUG] useEnhancedChat: JSON parse failed
```
**Fix**: Check what the actual data line contains. The server might be sending malformed events.

## Next Steps After Identifying Issue:

1. **Copy the relevant debug logs** showing the failure
2. **Note which exact step fails** (e.g., "validation", "JSON parsing", etc.)
3. **Check the data being sent/received** at the failure point
4. I can then provide a targeted fix based on the specific failure

## Testing Checklist:

- [ ] Chat tab with simple prompt (e.g., "Hello")
- [ ] Check if provider/model are set correctly
- [ ] Check if streaming response starts
- [ ] Check what event types are received
- [ ] Code tab with simple prompt (e.g., "Create a hello.js file")
- [ ] Check if mode is 'code'
- [ ] Check if action is 'start_session'
- [ ] Check if request reaches the API

## Common Fixes Preview:

### If provider/model missing in chat:
The issue is in the conversation-interface where it creates the request body. Need to ensure `options.body` contains provider and model.

### If mode not switching to code:
The issue is in the tab change handler. Need to ensure `setCurrentMode('code')` is called.

### If action field missing in code request:
The issue is in code-service.ts where it constructs the request. Need to ensure 'action' field is included.

### If events malformed from server:
The issue is in the chat API route streaming response. Need to ensure proper SSE format.
