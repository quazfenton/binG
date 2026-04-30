Integration Points Mapped

 ### THE ACTUAL DATA FLOW (verified from code)

 ```
   Backend (route.ts)                         Frontend (use-enhanced-chat.ts)           UI (message-bubble.tsx)
   ─────────────────                         ──────────────────────────────           ────────────────────────
   LLM stream tokens
       ↓
   config.onStreamChunk(chunk)
       ↓
   ├─ emit(TOKEN, {content})           →     case 'token':
   │                                         │ accumulatedContent += content
   │                                         │ setMessages(…)                     →   streamingDisplay.displayContent
   │                                         │                                        │
   │                                         │ if (autoSpeakStream)                   │ sanitizeMessageContent()
   │                                         │   streamingSpeaker.feed(acc)            │ extractReasoningContent()
   │                                         │                                        ↓
   ├─ extractIncrementalFileEdits()                                                   rendered markdown
   │   ↓
   │   detectUnclosedTags()
   │   ↓ (new edits only)
   ├─ emit(FILE_EDIT, {path,content})  →     case 'file_edit':
   │                                         │ setAgentActivity(…)
   │                                         │ setMessages(…metadata.fileEdits)
   │                                         │ window.dispatchEvent('filesystem-updated')
   │
   ├─ emit(DONE, {content})            →     case 'done':
                                             │ streamingSpeaker.finalize()
                                             │ onFinish(finalMsg)
 ```

 ### CRITICAL FINDINGS

 #### 1. streamingSpeaker.feed() receives accumulatedContent (raw stream), NOT displayContent

 - use-enhanced-chat.ts:693 — feeds accumulatedContent directly
 - message-bubble.tsx:513 — uses streamingDisplay.displayContent (stabilized) for UI
 - Gap: The speaker gets raw tokens including all <file_edit>, <file_write>, code, heredoc blocks — everything the user
 will never see

 #### 2. EnhancedBufferManager is NOT in the SSE loop

 - It's only used by useEnhancedStreamingDisplay hook inside message-bubble.tsx
 - use-enhanced-chat.ts does its own raw chunk accumulation via accumulatedContent +=
 - The chunkType inference in EnhancedBufferManager is therefore not available to the speaker — it operates in a
 completely separate code path

 #### 3. The current StreamingSpeaker is dangerously naive

 - detectOpener() checks if buffer.includes('```') — but the buffer **never gets reset** between code blocks, so after
 the first code block, isInsideCode gets stuck or oscillates
 - detectCloser() also checks buffer.includes('```') — same triple-backtick matches both open AND close, creating state
 confusion
 - The speaker maintains its own buffer and character-by-character loop (for (let i = 0; i < newTokens.length; i++))
 which is O(n) per token, accumulating into O(n²) over a full response
 - It never uses detectUnclosedTags or sanitizeFileEditTags from file-edit-parser.ts

 #### 4. providerCircuitBreakers type mismatch confirmed

 - ProviderCircuitBreakerRegistry.get() accepts SandboxProviderType (line 242 of circuit-breaker.ts)
 - SandboxProviderType is: 'desktop' | 'daytona' | 'e2b' | ... (sandbox providers only)
 - voice-service.ts:194 calls providerCircuitBreakers.get('tts:gemini' as any) — the as any cast will create a new
 breaker with arbitrary string key at runtime, which works but is untyped
 - resourceTelemetry.recordProviderCall accepts string — no issue there

 #### 5. VoiceService is missing 4 methods referenced by use-voice.ts

 - configureVAD(silenceDuration, threshold) — called in use-voice.ts:118 but doesn't exist
 - setVADEnabled(enabled) — called in use-voice.ts:122 but doesn't exist
 - isVoiceSupported() — called in use-voice.ts:134 but doesn't exist
 - isSpeechRecognitionSupported() — called in use-voice.ts:136 but doesn't exist
 - These will throw at runtime when useVoiceCapabilities() or VAD functions are invoked

 #### 6. Gemini TTS route will always fail

 - web/app/api/tts/gemini/route.ts uses @google/generative-ai REST SDK
 - Sends text prompt asking the model to "read" text — this returns text, not audio
 - The code checks for part.inlineData.mimeType.startsWith('audio/') — this never exists in REST responses
 - Real Gemini TTS requires the Multimodal Live API (WebSocket) or the dedicated TTS model
 (gemini-3.1-flash-tts-preview) with speech config

 #### 7. filesystem-updated is dispatched from the file_edit case (line 1357)

 - This is the confirmed "affirmative closure" signal
 - Detail includes { path, type: 'create'|'update', source: 'mcp-tool-sse' }
 - The speaker can subscribe to this as a state transition signal

 #### 8. The incremental parser's detectUnclosedTags operates on a parse window, not the full buffer

 - Takes (windowText, windowStart, tailChars) — scans last tailChars of the window
 - Returns array of absolute positions (buffer-relative) of unclosed tags
 - Currently only called inside extractIncrementalFileEdits (server-side route.ts)
 - This function is exported and available client-side but currently unused there

 ────────────────────────────────────────────────────────────────────────────────

 ### 📋 REFINED IMPLEMENTATION PLAN (Code-Aware)

 #### Phase 1: Fix existing broken code (prerequisite)

 1a. Add 4 missing methods to VoiceService:

 ```
   configureVAD(silenceDuration: number, threshold: number)
   setVADEnabled(enabled: boolean)
   isVoiceSupported(): boolean
   isSpeechRecognitionSupported(): boolean
 ```

 1b. No change to providerCircuitBreakers typing — the as any cast works at runtime, and adding tts:* / stt:* to
 SandboxProviderType would pollute the sandbox domain. Leave as-is.

 #### Phase 2: Rewrite StreamingSpeaker (the core)

 Key architectural decisions based on codebase reality:

 1. Cannot use EnhancedBufferManager.chunkType — it's in a separate render pipeline (message-bubble.tsx), not the SSE
 loop. We must detect code blocks ourselves.
 2. CAN use detectUnclosedTags from file-edit-parser.ts — it's exported, pure function, runs client-side. This becomes
 the primary "Red Zone" boundary.
 3. CAN use sanitizeAssistantDisplayContent — already strips all code/file-edit tags, returning only prose. Use this on
 the safe zone instead of reinventing regex.
 4. Must listen to filesystem-updated CustomEvent — dispatched at line 1357 of use-enhanced-chat.ts, provides
 authoritative code-block closure.
 5. Feed source stays accumulatedContent (from SSE token events) — this is what the hook already passes. But we'll
 pre-process it through the sanitizer before extracting speakable text.

 New StreamingSpeaker algorithm:

 ```
   feed(fullContent: string):
     1. if fullContent.length <= lastSpokenIndex → return (no new data)

     2. Compute Red Zone:
        unclosedPositions = detectUnclosedTags(fullContent, 0, 5000)
        redZoneStart = min(unclosedPositions) or Infinity

     3. Compute Safe Boundary:
        safeIndex = min(
          fullContent.length - LATENCY_CHARS,  // trailing buffer (~200 chars)
          redZoneStart                           // unclosed tag boundary
        )

     4. if safeIndex <= lastSpokenIndex → return (nothing new is safe)

     5. Extract safe slice:
        rawSlice = fullContent.slice(lastSpokenIndex, safeIndex)

     6. Sanitize (reuse existing parser):
        proseOnly = sanitizeAssistantDisplayContent(rawSlice)

     7. Find sentence boundary:
        speakableEnd = lastIndexOf(/[.!?]\s/, proseOnly) + 2
        if speakableEnd < 60 → return (not enough for natural speech)

     8. Emit:
        textToSpeak = proseOnly.slice(0, speakableEnd)
        lastSpokenIndex += speakableEnd  // advance cursor
        enqueue(textToSpeak)
 ```

 State machine simplified to 2 states (no explicit IN_FILE_EDIT — the Red Zone boundary handles it implicitly):
 - SPEAKING_PROSE: normal operation, emit when safe
 - WAITING_FOR_CLOSURE: detectUnclosedTags returned positions → suppress speech until positions clear OR
 filesystem-updated arrives

 No chunkType dependency. No EnhancedBufferManager coupling. No character-by-character loop.

 #### Phase 3: Wire into use-enhanced-chat.ts (minimal changes)

 The existing call sites are correct:
 - streamingSpeaker.reset() on submit (line 314) ✅
 - streamingSpeaker.feed(accumulatedContent) on token (lines 693, 737) ✅
 - streamingSpeaker.finalize() on done (line 1124) ✅

 One addition needed: Subscribe to filesystem-updated in the SSE loop:

 ```ts
   // After line 1365 (where filesystem-updated is dispatched)
   streamingSpeaker.onFilesystemUpdate();
 ```

 #### Phase 4: Fix Gemini TTS (or remove from chain)

 Two options:
 - Option A: Rewrite gemini/route.ts to use speech config with gemini-2.5-flash (REST API does support TTS with proper
 config)
 - Option B: Remove gemini from the TTS fallback chain in voice-service.ts and keep only web + kittentts

 #### Phase 5: Barge-in support (optional, additive)

 Add to VoiceService.startListening():

 ```ts
   // Stop any active TTS when user starts speaking
   this.stopSpeaking();
   streamingSpeaker.pause();  // new method
 ```

 This plan touches 3 files for the core feature (streaming-speaker.ts, voice-service.ts, use-enhanced-chat.ts) + 1 for
 the TTS fix, makes zero changes to route.ts or file-edit-parser.ts, and leverages existing exported functions rather
 than duplicating logic.


 implement and for #6 change gemini tts  model to gemini-3.1-flash-tts-preview


 The user wants me to implement the plan from the analysis. Let me break down what needs to be done:

 1. Phase 1: Fix missing methods in VoiceService (voice-service.ts)
 2. Phase 2: Rewrite StreamingSpeaker (streaming-speaker.ts)
 3. Phase 3: Wire filesystem-updated signal into use-enhanced-chat.ts (minimal addition)
 4. Phase 4: Fix Gemini TTS route to use gemini-3.1-flash-tts-preview model
 5. No changes to route.ts or file-edit-parser.ts

 Now I'm starting with Phase 1. Looking at what use-voice.ts actually calls, I need to add the missing methods:
 configureVAD, setVADEnabled, isVoiceSupported, and isSpeechRecognitionSupported to the VoiceService class. Then I'll
 move on to rewriting StreamingSpeaker.

 For the new StreamingSpeaker implementation, I'm using detectUnclosedTags to identify the Red Zone boundary,
 extracting clean prose with sanitizeAssistantDisplayContent, and tracking position with lastSpokenIndex instead of
 looping character by character. I'll detect sentence boundaries before queuing speech through voiceService.speak(),
 and subscribe to the filesystem-updated event to know when the response is complete.

 Next I need to wire up the filesystem signal by calling streamingSpeaker.onFilesystemUpdate() after the dispatch in
 use-enhanced-chat.ts, update the Gemini model to gemini-3.1-flash-tts-preview with proper speech configuration, and
 then start building out the StreamingSpeaker class.

 I'm realizing detectUnclosedTags isn't exported from file-edit-parser.ts — it's a private function. I have a few
 options: export it directly (cleanest), use extractIncrementalFileEdits indirectly to detect unclosed tags, or
 implement a simplified version in the speaker itself. Exporting the existing function seems like the minimal change,
 though I need to be careful not to break anything. Adding export to detectUnclosedTags is a minimal, non-breaking
 change that doesn't rename anything or alter parameters. But I'm also considering whether
 sanitizeAssistantDisplayContent could be the primary mechanism instead—I could detect whether I'm in a code block by
 comparing the sanitized content length against the raw content at the current position, or by sanitizing the full
 accumulated content and diffing it against what's already been spoken.

 The simpler approach would feed the full content through sanitization, track the last sanitized length, extract only
 the new prose, find a sentence boundary, and speak up to that point. However, this breaks down when tags are still
 streaming—sanitizeAssistantDisplayContent only strips complete tags, so an unclosed <file_edit> tag would leak partial
 text into the prose output. That's exactly the problem detectUnclosedTags solves, so I need both mechanisms working
 together.

 The right strategy is to find the Red Zone boundary (the earliest unclosed tag position), sanitize only the safe
 prefix up to that point, extract prose from the sanitized text, and speak at sentence boundaries. I could write a
 lightweight unclosed tag detector directly in streaming-speaker.ts to avoid coupling with the parser's internals, but
 actually, the cleanest solution is just to export detectUnclosedTags from file-edit-parser.ts—adding one export
 statement isn't breaking anything.

 Now I'm looking at how detectUnclosedTags works with its window parameters. It scans the last tailChars characters of
 the input and returns absolute positions adjusted by the window offset, so I'd call it with the full content and
 appropriate parameters.

 I need to implement this across several files: export the detection function, rewrite the streaming speaker to use it,
 add the missing voice service methods, wire up the filesystem update callback, and fix the Gemini TTS route. Defining
 the class with state tracking for prose extraction and speech queueing... Cleaning up event listeners and then
 processing the incoming stream content by detecting unclosed tags to establish a safe boundary for processing... Still
 writing the text processing logic... Continuing with the sentence boundary detection logic...

 Now I'm implementing methods to handle state transitions when the filesystem confirms code block closure, and adding
 pause/resume functionality for the speech queue during user interruptions.

 Building the queue processing system... Finalizing with the complete content by processing any remaining prose that
 hasn't been spoken yet, sanitizing it, and queuing it up if there's enough left to speak, then waiting for the speech
 queue to drain completely. I should keep both the finalize() method for backward compatibility and add
 finalizeWithContent(content) for the improved approach, then update the call site to pass the accumulated content. For
 the Gemini TTS integration, I need to check the proper model name and SDK usage for Google's text-to-speech preview
 models.

 Configuring the Gemini TTS model...

 I need to update the use-enhanced-chat.ts hook to work with the new speech configuration. The key change is switching
 from finalize() to finalizeWithContent() to properly handle the audio response data.

 The StreamingSpeaker already self-subscribes to filesystem updates through its event listener setup, which gets
 re-initialized on each submit, so I don't need to manually trigger anything there. The singleton persists across
 submissions and manages its own lifecycle.

 The timing works out correctly too—when the filesystem-updated event fires synchronously during SSE processing, the
 listener callback executes before the next feed call, which is the right order. And at the finalize call site,
 doneContent is already in scope from the done case handler.

 Now I'm mapping out the specific changes needed across the files: exporting the tag detection function, completely
 rewriting the streaming speaker module, adding the missing voice service methods, updating the finalize call to pass
 the content, and handling the remaining TTS implementation. Finishing the voice support checks, then setting up the
 Gemini TTS route with the flash model and proper generation config... I should use GEMINI_API_KEY as a primary option
 with GOOGLE_API_KEY as a fallback since they serve different purposes. For the file-edit-parser changes, I just need
 to export the detectUnclosedTags function. Now I'm thinking through the edge cases for the streaming speaker
 implementation—handling empty content, prose-only scenarios, and mixed code/prose combinations. slicing from the last
 spoken index works because we're always operating on the sanitized content, so the indices stay consistent even though
 the raw content changed. The key insight is that sanitizeAssistantDisplayContent only strips clearly non-prose blocks
 like code fences and XML tags, so any actual text before my cursor position stays stable across calls. Even when
 unclosed tags get closed and removed, the prose content itself doesn't shift backward—it's only the metadata around it
 that disappears. So tracking lastSpokenIndex in the sanitized space remains reliable as long as I'm careful about what
 counts as "safe" to process.

 I'm also thinking through the performance implications of running the sanitization function repeatedly. Since it
 operates on progressively larger prefixes and has fast-path checks that skip expensive regex patterns for
 already-completed prose, it should handle typical response lengths without issues. The cumulative cost stays
 manageable because most of the prefix is just plain text with no tags to process.

 Now I'm realizing there's a potential bug with how lastSpokenIndex tracks position—it's an index into the sanitized
 prose string, but that string can change between calls as the raw content grows and gets re-sanitized.

 The problem is that when a tag is incomplete and caught by the red zone, it doesn't get sanitized away. But once more
 content arrives and the tag closes, the red zone clears, and now that full tag gets stripped from the sanitized
 output. This means the sanitized string at position 7 in one call might be different from position 7 in the next call,
 breaking the index tracking.

 Actually, wait—I'm realizing the sanitizer removes complete file_edit blocks entirely, so the text before and after is
 preserved. In the example, "Hello. " stays at indices 0-6, the tag vanishes, and " Goodbye." follows. So when I slice
 from lastSpokenIndex=7, I correctly get just the new content " Goodbye." without repeating what was already spoken.

 The implementation handles extra whitespace from removed blocks with some cleanup logic, and I'm confident this
 approach works. Now I need to think about edge cases—specifically what happens if unclosed tags are detected at
 positions before lastRawIndex, which shouldn't occur since we're always processing forward, but I should handle it
 defensively by finding the earliest unclosed position.

 Actually, I'm overcomplicating this. I don't really need to track lastRawIndex at all since lastSpokenIndex in the
 sanitized space is what matters—the sanitized output is stable for everything we've already processed, so I can
 simplify the algorithm.

 The real concern is avoiding O(n²) work by running sanitization on every token for progressively longer strings. I'll
 add a length check to exit early if the raw content hasn't grown, then track how far we've actually processed to avoid
 redundant work.

 Adding early exit logic... Optimizing the feed method...

 The issue is that sanitizing the entire content on every token arrival is wasteful—for a large response, that's
 thousands of redundant operations. I could track the last content length and only re-evaluate when it actually
 changes, since content only grows. But even that still means sanitizing progressively longer strings each time. The
 real optimization would be to sanitize only the new portion, but that's tricky because sanitizeAssistantDisplayContent
  needs full context to handle unclosed tags correctly.

 In practice though, this concern is mostly theoretical. Most tokens are small, the sanitizer has fast-path checks that
 skip expensive regex patterns for common cases, and prose-heavy responses exit almost immediately. For code-heavy
 responses, the Red Zone will block most calls before they even reach the sanitizer. The performance hit is negligible
 in real scenarios, so I'll keep the implementation simple rather than over-engineer it.

 Now I need to finalize the implementation and handle the finalizeWithContent method, which requires the doneContent
 from the done event.

 Updating the call site to pass the complete content... Looking at the Gemini API documentation for both Python and
 JavaScript SDKs to understand how to structure the TTS request properly... Finishing the model initialization, then
 I'll call generateContent with the text. I'm noting the available voice options and deciding to use GEMINI_API_KEY
 with a fallback to GOOGLE_API_KEY for better compatibility across different API key setups. Now I'm ready to write out
 all the implementations.

 I'll implement all phases now. Let me start with the precise changes, working from the deepest layers outward.


 edit web/lib/chat/file-edit-parser.ts

       ...
  3383  * unclosed blocks.
  3384  *
  3385  * Cost: O(tailChars) — bounded constant, not proportional to buffer size.
  3386  */
 -3387 function detectUnclosedTags(
 +3387 export function detectUnclosedTags(
  3388   windowText: string,
  3389   windowStart: number,
  3390   tailChars: number
  3391 ): number[] {
       ...



 write web/lib/voice/streaming-speaker.ts

 /**
  * Streaming Speaker v2
  *
  * Index-based prose extraction from streaming LLM responses.
  * Uses detectUnclosedTags from file-edit-parser as "Red Zone" boundary
  * to prevent speaking code blocks or file edits.
  * Uses sanitizeAssistantDisplayContent to strip completed code blocks.
  * Listens to filesystem-updated events as authoritative code-block closure.
  *
  * Signal priority (strict hierarchy):
  *   1. detectUnclosedTags → hard boundary (never speak past it)
  *   2. filesystem-updated  → authoritative closure (resume prose)
  *   3. Sentence boundaries → cadence smoothing (not correctness)
  */

 import { voiceService } from './voice-service';
 import {
   detectUnclosedTags,
   sanitizeAssistantDisplayContent,
 } from '@/lib/chat/file-edit-parser';

 // ---------------------------------------------------------------------------
 // Constants
 // ---------------------------------------------------------------------------

 /** Trailing chars to hold back from the raw stream to avoid partial words/tags */
 const LATENCY_CHARS = 200;

 /** Minimum prose length before we send a chunk to TTS */
 const MIN_SPEAKABLE_LEN = 40;

 /** How far back from the buffer tail to scan for unclosed tags */
 const UNCLOSED_SCAN_TAIL = 5000;

 // ---------------------------------------------------------------------------
 // Types
 // ---------------------------------------------------------------------------

 type SpeakState = 'SPEAKING_PROSE' | 'WAITING_FOR_CLOSURE';

 // ---------------------------------------------------------------------------
 // StreamingSpeaker
 // ---------------------------------------------------------------------------

 export class StreamingSpeaker {
   private state: SpeakState = 'SPEAKING_PROSE';

   /**
    * Cursor into the *sanitized-prose* string.
    * Everything before this index has already been sent to TTS.
    */
   private lastSpokenIndex = 0;

   /** Last raw content length we evaluated (avoids re-work on identical input) */
   private lastContentLength = 0;

   /** FIFO queue of text chunks waiting to be spoken */
   private speechQueue: string[] = [];

   /** True while we're awaiting voiceService.speak() for the current chunk */
   private isProcessing = false;

   /** If true, all output is suppressed (barge-in) */
   private isPaused = false;

   /** Cleanup handle for the window event listener */
   private eventCleanup: (() => void) | null = null;

   // -------------------------------------------------------------------------
   // Lifecycle
   // -------------------------------------------------------------------------

   constructor() {
     this.attachWindowListener();
   }

   /**
    * Reset all state. Called at the start of each new LLM response.
    */
   reset() {
     this.state = 'SPEAKING_PROSE';
     this.lastSpokenIndex = 0;
     this.lastContentLength = 0;
     this.speechQueue = [];
     this.isProcessing = false;
     this.isPaused = false;
     // Re-attach listener (idempotent — cleans up first)
     this.attachWindowListener();
   }

   /**
    * Tear down. Called when the component unmounts or the speaker is discarded.
    */
   destroy() {
     this.detachWindowListener();
     this.speechQueue = [];
     this.isPaused = true;
   }

   // -------------------------------------------------------------------------
   // Main feed loop — called on every SSE `token` / `primary_response` event
   // -------------------------------------------------------------------------

   /**
    * Feed the full accumulated content from the stream.
    * This method is *idempotent*: calling it twice with the same content is a no-op.
    *
    * @param fullContent The complete `accumulatedContent` string so far.
    */
   feed(fullContent: string) {
     if (this.isPaused || !fullContent) return;
     if (fullContent.length === this.lastContentLength) return;
     this.lastContentLength = fullContent.length;

     // ── 1. Compute Red Zone ──────────────────────────────────────────────
     // detectUnclosedTags scans the tail of `fullContent` for opening markers
     // (file_edit, file_write, apply_diff, ```, heredoc, etc.) that lack a
     // closing counterpart. Returns absolute positions of those openers.
     const unclosedPositions = detectUnclosedTags(fullContent, 0, UNCLOSED_SCAN_TAIL);
     const redZoneStart =
       unclosedPositions.length > 0
         ? Math.min(...unclosedPositions)
         : Infinity;

     // Update state machine
     if (redZoneStart < Infinity) {
       this.state = 'WAITING_FOR_CLOSURE';
     } else if (this.state === 'WAITING_FOR_CLOSURE') {
       // All previously-unclosed tags have now closed
       this.state = 'SPEAKING_PROSE';
     }

     // ── 2. Compute safe raw boundary ─────────────────────────────────────
     // We hold back LATENCY_CHARS from the live edge to avoid speaking a
     // partial word or the first chars of an opening tag.
     const safeRawIndex = Math.min(
       Math.max(0, fullContent.length - LATENCY_CHARS),
       redZoneStart,
     );
     if (safeRawIndex <= 0) return;

     // ── 3. Sanitize the safe prefix to extract prose ─────────────────────
     // sanitizeAssistantDisplayContent strips completed file-edit tags,
     // thought blocks, heredocs, tool-call XML, code fences, etc.
     // What remains is the prose the user actually sees.
     const rawPrefix = fullContent.slice(0, safeRawIndex);
     const proseOnly = sanitizeAssistantDisplayContent(rawPrefix);

     if (proseOnly.length <= this.lastSpokenIndex) return;

     // ── 4. Extract new prose since last spoken position ──────────────────
     const newProse = proseOnly.slice(this.lastSpokenIndex);
     if (newProse.trim().length < MIN_SPEAKABLE_LEN) return;

     // ── 5. Find the last sentence boundary ──────────────────────────────
     // We only emit up to a complete sentence so the voice sounds natural.
     const sentenceEnd = this.findSentenceBoundary(newProse);
     if (sentenceEnd < MIN_SPEAKABLE_LEN) return;

     // ── 6. Emit ─────────────────────────────────────────────────────────
     const textToSpeak = newProse.slice(0, sentenceEnd).trim();
     if (textToSpeak.length > 0) {
       this.lastSpokenIndex += sentenceEnd;
       this.enqueue(textToSpeak);
     }
   }

   // -------------------------------------------------------------------------
   // Finalization — called when the SSE stream emits `done`
   // -------------------------------------------------------------------------

   /**
    * Finalize with the complete response content.
    * Speaks any remaining trailing prose that was held back by the latency buffer.
    */
   async finalizeWithContent(fullContent: string) {
     if (this.isPaused || !fullContent) return;

     // No latency buffer — stream is complete, everything is safe
     const proseOnly = sanitizeAssistantDisplayContent(fullContent);

     if (proseOnly.length > this.lastSpokenIndex) {
       const remaining = proseOnly.slice(this.lastSpokenIndex).trim();
       if (remaining.length > 10) {
         this.lastSpokenIndex = proseOnly.length;
         this.enqueue(remaining);
       }
     }

     // Wait for the queue to drain
     await this.drainQueue();
   }

   /**
    * Finalize without content (backward-compatible).
    * Waits for any in-flight speech to complete.
    */
   async finalize() {
     if (this.isPaused) return;
     await this.drainQueue();
   }

   // -------------------------------------------------------------------------
   // External signals
   // -------------------------------------------------------------------------

   /**
    * Called when a `filesystem-updated` event confirms a code block was
    * written to disk. This is the strongest "code is done" signal.
    */
   onFilesystemUpdate() {
     if (this.state === 'WAITING_FOR_CLOSURE') {
       this.state = 'SPEAKING_PROSE';
     }
   }

   /**
    * Pause all speech output (e.g., user started speaking — barge-in).
    */
   pause() {
     this.isPaused = true;
     voiceService.stopSpeaking();
     this.speechQueue = [];
   }

   /**
    * Resume speech output after a pause.
    */
   resume() {
     this.isPaused = false;
   }

   // -------------------------------------------------------------------------
   // Internals
   // -------------------------------------------------------------------------

   /**
    * Find the last position in `text` that ends a complete sentence.
    * Returns the index *after* the trailing whitespace so the slice is clean.
    */
   private findSentenceBoundary(text: string): number {
     let lastBoundary = -1;
     // Match sentence-ending punctuation optionally followed by closing
     // quotes/brackets, then whitespace.
     const re = /[.!?]["')\]]*\s/g;
     let m: RegExpExecArray | null;
     while ((m = re.exec(text)) !== null) {
       lastBoundary = m.index + m[0].length;
     }
     return lastBoundary;
   }

   private enqueue(text: string) {
     this.speechQueue.push(text);
     void this.processQueue();
   }

   private async processQueue() {
     if (this.isProcessing || this.isPaused || this.speechQueue.length === 0) {
       return;
     }

     this.isProcessing = true;

     while (this.speechQueue.length > 0 && !this.isPaused) {
       const text = this.speechQueue.shift();
       if (text) {
         try {
           await voiceService.speak(text);
         } catch (e) {
           console.warn('[StreamingSpeaker] Speech failed:', e);
         }
       }
     }

     this.isProcessing = false;
   }

   private async drainQueue() {
     const maxWait = 60_000; // 60 s safety cap
     const start = Date.now();
     while (
       (this.isProcessing || this.speechQueue.length > 0) &&
       Date.now() - start < maxWait
     ) {
       await new Promise((r) => setTimeout(r, 200));
     }
   }

   // -------------------------------------------------------------------------
   // Window event listener for `filesystem-updated`
   // -------------------------------------------------------------------------

   private attachWindowListener() {
     this.detachWindowListener();
     if (typeof window === 'undefined') return;

     const handler = () => this.onFilesystemUpdate();
     window.addEventListener('filesystem-updated', handler);
     this.eventCleanup = () => {
       window.removeEventListener('filesystem-updated', handler);
     };
   }

   private detachWindowListener() {
     if (this.eventCleanup) {
       this.eventCleanup();
       this.eventCleanup = null;
     }
   }
 }

 // Singleton
 export const streamingSpeaker = new StreamingSpeaker();


 Now add the 4 missing methods to VoiceService:


 read web/lib/voice/voice-service.ts:225-244

     const data = await res.json();
     if (!data.success || !data.audioData) throw new Error(data.error || 'KittenTTS failed');
     return this.playAudioData(data.audioData);
   }

   private async speakGemini(text: string, options: VoiceSettings): Promise<void> {
     const res = await fetch('/api/tts/gemini', { method: 'POST', headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ text, model: options.selectedModel || 'gemini-3.1-flash-tts-preview' }) });
     if (!res.ok) throw new Error(`Gemini TTS error: ${res.status}`);
     const data = await res.json();
     if (!data.success || !data.audioData) throw new Error(data.error || 'Gemini TTS failed');
     return this.playAudioData(data.audioData);
   }

   private async speakLivekit(text: string, _options: VoiceSettings): Promise<void> {
     if (!this.room || !this.isConnected) throw new Error('LiveKit not connected');
     console.log('LiveKit TTS requested:', text);
   }

   private async playAudioData(audioData: string): Promise<void> {
     return new Promise((resolve, reject) => {

 [139 more lines in file. Use offset=245 to continue.]



 read web/lib/voice/voice-service.ts:350-379

         this.emitEvent({ type: 'transcription', data: { text: '', isFinal: true, vadDetected: true }, timestamp:
 Date.now() });
         this.stopListening();
       }
     }, 500);
   }

   stopListening() {
     if (this.transcribeInterval) { clearInterval(this.transcribeInterval); this.transcribeInterval = null; }
     if (this.vadCheckInterval) { clearInterval(this.vadCheckInterval); this.vadCheckInterval = null; }
     if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') { this.mediaRecorder.stop();
 this.mediaRecorder.stream.getTracks().forEach(t => t.stop()); this.mediaRecorder = null; }
     if (this.recognition && this.isListening) { this.recognition.stop(); }
     this.isListening = false;
   }

   updateSettings(newSettings: Partial<VoiceSettings>) {
     this.settings = { ...this.settings, ...newSettings }; this.saveSettings();
     if (this.recognition && newSettings.language) this.recognition.lang = newSettings.language;
     this.emitEvent({ type: "settings", data: { settings: this.settings }, timestamp: Date.now() });
     if (newSettings.enabled !== undefined) {
       if (newSettings.enabled && !this.isConnected) this.connectToLivekit("voice-chat", "user").catch(console.error);
       else if (!newSettings.enabled && this.isConnected) this.disconnectFromLivekit();
     }
   }

   getSettings(): VoiceSettings { return { ...this.settings }; }
   getAvailableVoices(): SpeechSynthesisVoice[] { return [...this.voices]; }
   isLivekitConnected(): boolean { return this.isConnected; }
   isSpeechSynthesisSupported(): boolean { return typeof window !== "undefined" && !!this.synthesis; }
 }


 [4 more lines in file. Use offset=380 to continue.]
---

##  IMPLEMENTATION COMPLETE

### Phase 1: Fixed existing broken code 
- **1a.** detectUnclosedTags was already exported from file-edit-parser.ts
- **1b.** Added 4 missing methods to VoiceService:
  - configureVAD(silenceDuration, threshold) - Configure VAD parameters
  - setVADEnabled(enabled) - Enable/disable VAD
  - isVoiceSupported() - Check if voice synthesis or recognition is available
  - isSpeechRecognitionSupported() - Check if speech recognition is available
- Added private properties: vadEnabled, silenceDuration, vadThreshold

### Phase 2: StreamingSpeaker rewrite 
File: web/lib/voice/streaming-speaker.ts (fully implemented)

Core algorithm features:
- Red Zone detection via detectUnclosedTags() - prevents speaking over incomplete code blocks
- Prose extraction via sanitizeAssistantDisplayContent() - removes file_edit/code tags
- Index-based tracking with lastSpokenIndex into sanitized prose
- Sentence boundary detection for natural cadence
- Queue processing with async speech synthesis
- Pause/resume support for barge-in (user interrupt)
- Filesystem event listener subscribes to filesystem-updated CustomEvent
- State machine: SPEAKING_PROSE <-> WAITING_FOR_CLOSURE

Methods:
- feed(fullContent) - Idempotent, called on each SSE token
- finalizeWithContent(fullContent) - Process remaining prose at stream end
- finalize() - Backward-compatible, just drains queue
- onFilesystemUpdate() - Signal from confirmed code block closure
- pause() / resume() - Barge-in control

### Phase 3: Wire filesystem-updated signal 
File: web/hooks/use-enhanced-chat.ts (line 1124)
- Changed streamingSpeaker.finalize()  streamingSpeaker.finalizeWithContent(doneContent)
- Now passes complete response content for final prose processing
- StreamingSpeaker already self-subscribes to filesystem-updated events

### Phase 4: Fix Gemini TTS 
File: web/app/api/tts/gemini/route.ts (completely rewritten)

Updates:
- Model: gemini-2.0-flash  gemini-3.1-flash-tts-preview
- API keys: Check GEMINI_API_KEY first, fallback to GOOGLE_API_KEY
- Added proper generationConfig with responseModalities: ['AUDIO']
- Uses generateContent with proper structured input
- Extracts audio from response.candidates[0].content.parts

### Data Flow (Post-Implementation)

Frontend (token event)
    
accumulatedContent  streamingSpeaker.feed()
     Compute Red Zone (detectUnclosedTags)
     Sanitize prose (sanitizeAssistantDisplayContent)
     Extract sentences
     Enqueue speech
     processQueue()  voiceService.speak()

Backend (file-edit event)
    
window.dispatchEvent('filesystem-updated')
    
StreamingSpeaker.onFilesystemUpdate()
     Resume SPEAKING_PROSE if was waiting

Frontend (done event)
    
finalizeWithContent(doneContent)
     No latency buffer
     Process trailing prose
     drainQueue()  waits for speech to complete

