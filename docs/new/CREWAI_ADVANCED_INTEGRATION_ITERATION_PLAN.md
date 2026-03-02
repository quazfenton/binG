# CrewAI Advanced Integration Iteration Plan

## Scope
- Harden `lib/crewai/*` to align with CrewAI concepts (agents, tasks, crews, callbacks, event listeners, files).
- Integrate CrewAI runtime path into existing stateful API without breaking default behavior.
- Keep rollback-safe toggles (`USE_CREWAI`) and configurable agent/process mappings.

## Implemented In This Iteration

1. Core semantic fixes
- Added template-variable interpolation in task prompts (`{var}` from kickoff inputs).
- Improved hierarchical process handling to require/resolve manager-agent behavior safely.
- Added event listener fan-out support in `Crew` (`event_listeners`) with guarded execution.

2. Tool adapter hardening
- Reworked adapter to use existing `ToolExecutor` for single execution path, logging, and metrics.
- Added typed adapter shape:
  - `CrewAIToolDefinition`
  - `CrewAIToolAdapter`
  - `runTool(...)` dispatcher with strict unknown-tool errors

3. Runtime integration
- Added `runCrewAIWorkflow(...)` at `lib/crewai/runtime/run-crewai.ts`.
- Loads YAML agents, assembles default Planner -> Coder -> Critic task chain, supports hierarchical manager.
- Wired API route opt-in path in `app/api/stateful-agent/route.ts` using `useCrewAI` / `USE_CREWAI`.

4. Environment/config integration
- Added CrewAI role mapping envs:
  - `CREWAI_PLANNER_AGENT`
  - `CREWAI_CODER_AGENT`
  - `CREWAI_CRITIC_AGENT`
  - `CREWAI_MANAGER_AGENT`
- Added `CREWAI_TRACING_ENABLED` and optional `CREWAI_LOG_FILE` placeholders.

## Gaps To Implement Next

1. Native tool-use loop per role agent
- Current `RoleAgent` wraps `StatefulAgent`; tools are not yet first-class invoked by each role step.
- Next: integrate parser/dispatcher layer to translate model tool intents into `ToolExecutor` calls per task step.

2. Streaming parity with agentic UI
- Add SSE events from Crew runtime to chat routes:
  - `reasoning`
  - `tool_invocation`
  - per-step timing metrics
  - stdout/stderr chunk events

3. HITL parity
- Add explicit approval states for Crew tasks (`awaiting_approval`) and resume flow.

4. Advanced docs-aligned features
- Conditional tasks, task replay, and MCP server adapters as Crew tools.
- Optional memory storage path controls (`CREWAI_STORAGE_DIR`) and telemetry toggles.

## Validation Checklist
- `npm run typecheck` / `npx tsc --noEmit`
- CrewAI route smoke tests:
  - `useCrewAI=true` and env-driven `USE_CREWAI=true`
  - `sequential`, `hierarchical`, `consensual` process modes
- Missing-agent config failure path test
- Event listener callback failure isolation test
