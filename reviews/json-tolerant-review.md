✅ ALL FINDINGS RESOLVED — No further action needed.
# Code Review: web/lib/utils/json-tolerant

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## json-tolerant.ts (144 lines)

This utility provides a robust JSON parser designed to handle the common malformations emitted by LLMs (e.g., trailing commas, unescaped control characters, raw newlines).

### Good Practices

1. **In-String Control Character Escaping** (line 13)
   Manually iterates through the string to escape control characters (`\n`, `\t`, etc.) *only* when they occur inside a JSON string value. This prevents breaking the JSON structure while fixing LLM "laziness."

2. **Multi-Strategy Fallback**
   Attempts standard `JSON.parse` first, then applies sanitization, and finally falls back to more aggressive fixes (like stripping markdown code blocks).

3. **High Reusability** (line 5)
   Used across multiple mission-critical layers (VFS MCP tools and file-edit parsers).

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 1 |
| Low | 1 |

### HIGH PRIORITY

1. **State Machine Edge Case: Nested Quotes** (line 29)
   The `inString` toggle is based on a simple double-quote check. If the LLM emits unescaped double quotes *inside* a string (e.g., `"content": "He said "Hello" world"`), the state machine will desynchronize, and the rest of the parsing will fail or produce garbage.
   
   **Recommendation:** Use a more robust regex-based or stateful tokenizer that understands escaped quotes (`\"`) and potentially handles single-quoted strings if the target LLM tends to emit them.

### MEDIUM PRIORITY

1. **Performance of Iteration** (line 17)
   For very large JSON files (e.g., a file-edit operation with 10k lines of code), a character-by-character loop in JavaScript can be slow.
   
   **Recommendation:** Use a faster bulk regex replacement for common control characters where possible.

### LOW PRIORITY

1. **Unicode Support**
   Ensure that the character-by-character loop handles multibyte Unicode characters correctly (though standard string indexing in JS usually handles this fine unless surrogate pairs are split).

---

## Wiring

- **Used by:**
  - `web/lib/virtual-filesystem/` for MCP tool inputs.
  - `web/lib/agent/` for parsing thought/action outputs.

**Status:** ✅ Mission critical "glue" for LLM integration.

---

## Summary

The `json-tolerant` parser is an essential bridge for reliable LLM interaction. Addressing the "nested quote" state machine failure is the primary path to making it more resilient against complex LLM outputs.

---

*End of Review*