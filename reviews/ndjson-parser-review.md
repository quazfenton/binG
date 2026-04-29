# Code Review: web/lib/utils/ndjson-parser

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## ndjson-parser.ts (418 lines)

This utility provides a robust implementation for parsing newline-delimited JSON (NDJSON) streams, which is commonly used for agent event logs and streaming LLM responses.

### Good Practices

1. **Partial Chunk Handling** (line 5)
   Correctly buffers incomplete lines between chunks, which is essential for network-streamed data where a JSON string might be split across packets.

2. **Async Iterator Support** (line 25)
   Provides a modern `parseNDJSONStream` helper that works as an async generator, fitting naturally into modern TypeScript stream patterns.

3. **Memory Safeguards** (line 9)
   Includes buffer size limits to prevent an attacker (or a malfunctioning agent) from exhausting server memory by sending a never-ending line without a newline.

4. **Brace Matching** (line 10)
   Uses brace matching to detect potentially complete JSON objects even if the newline is missing, adding an extra layer of robustness.

### Issues

| Severity | Count |
|----------|-------|
| Low | 3 |

### LOW PRIORITY

1. **Large Buffer Handling**
   The parser uses string concatenation for buffering (`this.buffer += chunk`). For extremely large streams, this can be inefficient compared to a `Buffer` or `Uint8Array` based approach.
2. **Tolerance of Invalid JSON**
   The parser likely throws an error if a single line is invalid JSON. For robustness in logging, it should optionally skip invalid lines and continue with the rest of the stream.
3. **Encoding Assumption** (line 18)
   Assumes `chunk.toString()` is always UTF-8. If the stream uses a different encoding, it might break multibyte characters if they are split between chunks.

---

## Wiring

- **Used by:**
  - `web/lib/utils/logger.ts` for parsing structured logs.
  - API routes that consume external NDJSON streams.
  - Multi-agent event collectors.

**Status:** ✅ High-quality utility with proper edge-case handling.

---

## Summary

The `ndjson-parser` is a solid foundation for handling structured streams. Its attention to memory limits and partial chunking makes it suitable for production use.

---

*End of Review*