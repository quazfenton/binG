# Code Review: web/lib/crewai/tasks

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## task.ts (333 lines)

This module defines the `Task` entity in the CrewAI ecosystem, including its configuration, execution lifecycle, and guardrail system.

### Good Practices

1. **Structured Outputs** (line 28)
   Native support for `output_json` via Zod schemas, enabling type-safe extraction from LLM responses.

2. **Task Guardrails** (line 35)
   Supports both custom function-based guardrails and string-based patterns to validate agent outputs before they are passed to the next task.
   ```typescript
   export type TaskGuardrail = (raw: string) => { ok: boolean; transformed?: string; error?: string } | string;
   ```

3. **Human-in-the-loop** (line 31)
   Includes `human_input` flag, allowing tasks to pause and wait for external input.

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 1 |
| Low | 2 |

### HIGH PRIORITY

1. **No Sandbox for Custom Guardrails** (line 18)
   Functional guardrails are executed in the main process. If a guardrail is derived from an external source or contains expensive logic, it could block the event loop or introduce security vulnerabilities.
   
   **Recommendation:** If guardrails are user-defined, they MUST run in a sandbox. If internal, ensure they are strictly timed out.

### MEDIUM PRIORITY

1. **Ambiguous Output Format** (line 29)
   `output_pydantic` in a TypeScript project is likely a leftover from Python CrewAI documentation or a future-planned RPC call. Using it without a clear bridge is confusing.
   
   **Recommendation:** Consolidate to `output_json` or rename `output_pydantic` if it refers to a specific schema format.

### LOW PRIORITY

1. **Max Iteration Default** (line 32)
   `max_iter` should have a sensible default in the class constructor to prevent runaway agent loops if not specified.
2. **Callback Safety** (line 38)
   Asynchronous callbacks should be wrapped in a try/catch to prevent a single task's callback failure from crashing the entire crew.

---

## Wiring

- **Used by:**
  - `web/lib/crewai/crew/crew.ts` to manage the execution order of tasks.
  - `web/lib/crewai/runtime/run-crewai.ts`.

**Status:** ✅ Feature-rich and well-modeled.

---

## Summary

The task system is highly capable, particularly with its support for structured outputs and guardrails. The main security concern is the execution context of functional guardrails.

---

*End of Review*