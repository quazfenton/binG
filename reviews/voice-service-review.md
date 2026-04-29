# Codebase Review: Voice Service (TTS & STT)

## Overview
The Voice Service provides the binG platform with auditory and vocal capabilities. It implements a hybrid architecture that balances the low latency of browser-native APIs with the high quality of cloud providers (LiveKit, Mistral, Cartesia).

## Key Components

### 1. Unified Voice Service (`web/lib/voice/voice-service.ts`)
A comprehensive manager for speech interaction.
- **Provider Switching**: Supports multiple TTS providers (`web`, `cartesia`, `elevenlabs`) and STT providers (`browser`, `mistral`).
- **LiveKit Integration**: Seamlessly connects to LiveKit rooms for low-latency, real-time audio streaming and multi-user voice chat.
- **Browser Fallback**: Includes a robust fallback to the browser's native `SpeechSynthesis` and `SpeechRecognition` APIs if cloud services are unavailable or unconfigured.
- **VAD Support**: Voice Activity Detection automatically stops listening when silence is detected (NEW).
- **Audio Buffer Overlap**: Mistral STT chunks now overlap to prevent word cutoff (NEW).

### 2. Mistral Transcription (`mistraltranscribe.ts`)
A specialized adapter for Mistral's Speech-to-Text API.
- **Chunked Recording**: Periodically collects audio chunks from the browser's `MediaRecorder` and sends them for transcription, providing a "Near Real-Time" experience without requiring a persistent WebSocket.
- **Overlap Buffering**: NEW - 50% overlap between chunks prevents word truncation at boundaries.

### 3. Voice Hooks (`web/lib/voice/use-voice.ts`) ✅ NEW
React hooks for centralized voice settings management.
- **useVoiceSettings**: Main hook for managing all voice state and controls
- **useVoiceEvents**: Low-level event monitoring for specific voice events
- **useVoiceCapabilities**: Detect browser voice feature support
- **useAvailableVoices**: Access and preview available voices

### 4. Voice Gallery Component (`web/components/voice-gallery.tsx`) ✅ NEW
UI components for voice management and preview.
- **VoiceGallery**: Browse, select, and preview available voices
- **VoiceSettingsPanel**: Centralized settings management with VAD controls

## Findings

### 1. Sophisticated Error Handling in STT ✅ VERIFIED
The `initializeBrowserVoice` method includes senior-level error handling for `not-allowed` (permission denied) errors. It prevents the system from spamming the logs and UI with repeated permission requests if the user has explicitly blocked microphone access.

### 2. Intelligent Auto-Speak ✅ VERIFIED
The `speakIfEnabled` method acts as a smart gateway. It only triggers TTS if the user has explicitly enabled both "Voice" and "Auto-Speak" settings, preventing unexpected audio playback during quiet browsing.

### 3. Resilience to Network Drops ✅ VERIFIED
The `connectToLivekit` logic includes a `maxReconnectAttempts` (3) and a clean fallback to "Local Mode." This ensures that the UI remains functional even if the LiveKit server becomes unreachable.

## Recommended Actions - Implementation Status

### ✅ COMPLETED: Centralize Settings
- **Issue**: Voice settings were directly stored in localStorage within the service
- **Solution Implemented**:
  - Created `use-voice.ts` hook file with centralized settings management
  - `useVoiceSettings()` hook manages all voice state and synchronization
  - Settings changes propagate through React state instead of direct localStorage
  - Enables better integration with global state management (Redux, Zustand, etc.)
  - All settings updates go through `updateSettings()` callback

### ✅ COMPLETED: VAD Implementation
- **Issue**: No Voice Activity Detection to automatically stop listening
- **Solution Implemented**:
  - Added VAD support in `VoiceService` with configurable sensitivity
  - `setVADEnabled(enabled)` - Toggle VAD on/off
  - `configureVAD(silenceDuration, threshold)` - Tune sensitivity
  - Automatically stops listening after 1.5 seconds of silence (configurable)
  - VAD checking runs every 500ms when Mistral STT is active
  - Emits special `vadDetected` flag in transcription event
  - UI can respond to auto-stop via `useVoiceSettings()` hook

### ✅ COMPLETED: Audio Buffer Management
- **Issue**: Mistral STT chunks could cut off words at boundaries (2-second chunks)
- **Solution Implemented**:
  - Added `audioBufferOverlap` property (default 50%)
  - Implemented `lastAudioBuffer` tracking for previous chunk retention
  - Each transcription request includes overlap from previous chunk
  - Prevents word truncation at 2-second chunk boundaries
  - Configurable overlap percentage for fine-tuning

### ✅ COMPLETED: Voice Gallery UI
- **Issue**: No way for users to preview different voices
- **Solution Implemented**:
  - Created `voice-gallery.tsx` component with:
    - **VoiceGallery Component**: 
      - Browse all available voices with metadata (name, language, local/cloud)
      - Preview button for each voice with custom preview text
      - Voice selection with visual feedback (blue highlight)
      - Shows voice count and local vs cloud indicators
    - **VoiceSettingsPanel Component**:
      - Enable/disable voice globally
      - Auto-speak toggle
      - Speech rate, pitch, and volume sliders
      - Microphone and transcription toggles
      - Advanced VAD settings section
      - Clean, organized layout

## Implementation Details

### VAD Configuration
```typescript
// In voice service
voiceService.configureVAD(
  1500,   // silence duration (ms)
  0.02    // threshold (0-1)
);

// Or via hook
const { configureVAD, setVADEnabled } = useVoiceSettings();
configureVAD(1500, 0.02);
setVADEnabled(true);
```

### Audio Buffer Overlap
- Default: 50% overlap between chunks
- Prevents words from being split at 2-second boundaries
- Kept in `lastAudioBuffer` for next iteration
- Transparent to API consumers

### Settings Management Flow
```
UI Component
    ↓
useVoiceSettings() hook
    ↓
voiceService.updateSettings()
    ↓
React state updated + localStorage saved
    ↓
VoiceEvent emitted to listeners
    ↓
UI re-renders
```

## Usage Examples

### Using Voice Settings Hook
```typescript
import { useVoiceSettings } from '@/lib/voice/use-voice';

function MyComponent() {
  const { 
    settings, 
    updateSettings,
    startListening,
    stopListening,
    speak
  } = useVoiceSettings();

  return (
    <button onClick={() => updateSettings({ enabled: !settings?.enabled })}>
      {settings?.enabled ? 'Disable' : 'Enable'} Voice
    </button>
  );
}
```

### Using Voice Gallery
```typescript
import { VoiceGallery, VoiceSettingsPanel } from '@/components/voice-gallery';

function VoiceSettings() {
  return (
    <div>
      <h2>Voice Settings</h2>
      <VoiceSettingsPanel />
      
      <h2>Select Voice</h2>
      <VoiceGallery />
    </div>
  );
}
```

### Configuring VAD
```typescript
const { setVADEnabled, configureVAD } = useVoiceSettings();

// High sensitivity (stop quickly on silence)
configureVAD(800, 0.015);
setVADEnabled(true);

// Low sensitivity (more tolerance for pauses)
configureVAD(2500, 0.03);
setVADEnabled(true);
```

## Testing

### VAD Testing
- Enable VAD and speak naturally
- Verify that listening stops ~1.5 seconds after you stop speaking
- Test with different sensitivity settings
- Verify no words are cut off at buffer boundaries

### Voice Preview Testing
- Open Voice Gallery component
- Select different voices
- Click "Preview" to hear each voice
- Verify custom preview text works
- Test with different languages if available

### Settings Persistence
- Change voice settings
- Refresh the page
- Verify settings are restored from localStorage
- Check that UI syncs across multiple components

## Files Modified/Created

### Modified
- `web/lib/voice/voice-service.ts` - Added VAD support and audio buffer overlap

### Created
- `web/lib/voice/use-voice.ts` - React hooks for voice settings management
- `web/components/voice-gallery.tsx` - Voice preview and settings UI components

## Status: ✅ COMPLETED

All recommended improvements have been implemented:
- Centralize Settings ✅
- VAD Implementation ✅
- Audio Buffer Management ✅
- Voice Gallery UI ✅

Voice service now provides:
- Automatic silence detection with VAD
- Better audio quality with buffer overlap
- Centralized settings management for React apps
- User-friendly voice preview and selection UI
- Configurable sensitivity for different use cases
