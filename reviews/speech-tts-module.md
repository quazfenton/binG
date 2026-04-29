# Code Review: web/app/api/speech-to-text & tts Routes

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  
**Modules:** speech-to-text, tts, voice

---

## speech-to-text/route.ts (115 lines)

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 2 |

### HIGH PRIORITY

#### 1. API Key in Environment (line 3-4)
```typescript
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL ?? "voxtral-mini-transcribe-2405";
```

**Issue:** API key read at module load. If missing, no clear error.

**Recommendation:** Add startup validation.

---

### MEDIUM PRIORITY

1. **No request timeout** - fetch() can hang indefinitely
2. **No file size limit** - Could accept huge audio files

---

## tts/route.ts

Similar issues:
- API key handling
- Missing timeout
- No size limit

---

## voice/ Module

Files:
- voice-service.ts
- mistraltranscribe.ts
- kitten-tts-server.ts

**Status:** Good overall

---

## Summary

Speech-to-text APIs need timeout and size limits added.

---

*End of Review*