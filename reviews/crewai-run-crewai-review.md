# Code Review: web/lib/crewai/runtime/run-crewai

**Review Date:** April 29, 2026  
**Reviewer:** Automated Code Review  

---

## run-crewai.ts (136 lines)

This module is the high-level orchestrator that wires together agents, tasks, and the crew process for execution. It handles configuration loading and supports both synchronous and streaming results.

### Good Practices

1. **Flexible Return Types** (line 37)
   Supports returning both a final `CrewAIRunResult` and an `AsyncGenerator<StreamChunk>`, enabling full integration with streaming-capable UIs.

2. **Environment Variable Fallbacks** (line 38-41)
   Properly uses environment variables for default processes and configuration paths.

3. **YAML-driven Agent Loading** (line 43)
   Decouples agent personas from the runtime code by loading them from a YAML manifest.

### Issues

| Severity | Count |
|----------|-------|
| High | 1 |
| Medium | 2 |
| Low | 2 |

### HIGH PRIORITY

1. **Static Role-to-Agent Mapping** (line 47-50)
   The workflow hardcodes lookups for `planner`, `coder`, `critic`, and `manager`. If these roles are renamed in the YAML or are missing, the workflow will fail or encounter undefined agent references.
   
   **Recommendation:** Dynamically discover agent roles from the YAML or implement a robust validation step that ensures all required roles exist before starting the workflow.

### MEDIUM PRIORITY

1. **Config Path Security** (line 27)
   ```typescript
   path.join(process.cwd(), filePath)
   }
   ```
   If `agentsConfigPath` is user-provided, this could lead to path traversal or loading of unintended configuration files.
   
   **Recommendation:** Use `lib/security/safeJoin` and validate that the config path is within the allowed workspace boundary.

2. **Error Accumulation** (line 23)
   The result structure accumulating errors into an array is good, but ensure that fatal errors (like missing agents) stop the process immediately rather than just being added to the list.

### LOW PRIORITY

1. **Process Selection** (line 30)
   The `parseProcess` function is a bit fragile. It should use an enum or a Zod schema for safer validation.
2. **Missing Cost/Token Reporting**
   While observability exists, the final `CrewAIRunResult` should ideally include a summary of total tokens used and duration for easy UI display.

---

## Wiring

- **Used by:**
  - `web/app/api/agent/stateful-agent/route.ts` as the primary entry point for CrewAI workflows.

**Status:** ✅ Mission critical "glue" code.

---

## Summary

`run-crewai.ts` is the essential bridge between configuration and execution. Its reliance on hardcoded agent roles is the primary stability concern; moving to dynamic role resolution would make it much more flexible.

---

*End of Review*