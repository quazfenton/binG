/**
 * invokeSkill — the central orchestration point between the Vercel AI SDK
 * tool handler and the WasmRunner.
 *
 * Responsibilities:
 *   1. Look up the skill manifest + handler (wasm path) in the registry.
 *   2. Apply basic policy checks (scopes, host allowlist).
 *   3. Construct the execution context and call globalRunner.call().
 *   4. Persist any returned artifacts into the VFS under a deterministic path.
 *   5. Return a structured result that the AI tool handler passes back upstream.
 */

import { powersRegistry } from './index';
import { WasmRunner } from './wasm/runner';
import { globalVFS } from './wasm/simpleVfs';
import crypto from 'crypto';

export interface InvokeContext {
  conversationId?: string;
  userId?: string;
  /** Overrides the skill manifest's allowedHosts for this invocation */
  allowedHosts?: string[];
}

export interface InvokeResult {
  ok: boolean;
  output?: string;
  artifacts?: ArtifactRef[];
  error?: string;
  logs?: Array<{ level: string; message: string; ts: number }>;
  durationMs?: number;
}

export interface ArtifactRef {
  vfsPath: string;
  /** The artifact's filename within the skill's output */
  name: string;
  /** MIME type hint */
  type?: string;
  sizeBytes: number;
}

export async function invokeSkill(
  skillId: string,
  actionName: string,
  params: Record<string, unknown>,
  ctx: InvokeContext = {}
): Promise<InvokeResult> {
  // ── Registry lookup ────────────────────────────────────────────────────
  const skill = powersRegistry.getById(skillId);
  if (!skill) return { ok: false, error: `skill_not_found:${skillId}`, durationMs: 0 };

  const handlerMeta = powersRegistry.getWasmHandler(skillId);
  if (!handlerMeta) {
    // Soft fallback: return the skill's raw markdown so the LLM can self-execute
    return {
      ok: false,
      error: `no_wasm_handler:${skillId}`,
      output: skill.rawMarkdown || '',
      durationMs: 0,
    };
  }

  // ── Policy: verify action is declared ─────────────────────────────────
  const actionDef = skill.actions?.find((a: any) => a.name === actionName);
  if (!actionDef) {
    return { ok: false, error: `unknown_action:${actionName} in skill:${skillId}`, durationMs: 0 };
  }

  // ── Build per-invocation VFS path prefix ───────────────────────────────
  const convId = ctx.conversationId ?? 'anon';
  const traceId = crypto.randomUUID().slice(0, 8);
  const artifactRoot = `conversations/${convId}/artifacts/${skillId}/`;

  // ── Run ────────────────────────────────────────────────────────────────
  const runner = new WasmRunner();
  const runResult = await runner.call(
    handlerMeta,
    { action: actionName, params, ctx: { conversationId: convId, userId: ctx.userId ?? 'anon', traceId } },
    {
      timeoutMs: actionDef.timeoutMs ?? 30_000,
      allowedHosts: ctx.allowedHosts ?? skill.permissions?.allowedHosts ?? [],
      vfsPathPrefix: '',
      maxMemoryPages: 128, // 8 MB
    }
  );

  // ── Persist artifacts ──────────────────────────────────────────────────
  const persistedRefs: ArtifactRef[] = [];

  if (runResult.artifacts?.length) {
    for (const a of runResult.artifacts) {
      const bytes = Buffer.from(a.content as string, 'base64');
      const vfsPath = `${artifactRoot}${a.path}`;
      await globalVFS.write(vfsPath, bytes);
      persistedRefs.push({
        vfsPath,
        name: a.path as string,
        type: (a as any).type,
        sizeBytes: bytes.byteLength,
      });
    }
  }

  return {
    ok: runResult.ok,
    output: runResult.output,
    artifacts: persistedRefs.length ? persistedRefs : undefined,
    error: runResult.error,
    logs: runResult.logs,
    durationMs: runResult.durationMs,
  };
}

