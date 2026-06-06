/**
 * Virtual PID Registry
 *
 * Maps virtual PIDs (vPIDs) to provider-specific real PIDs so that `ps` and
 * `kill` work transparently across sandbox providers. A user can run `npm run dev`
 * on an E2B sandbox (real PID 45), then run `ps` and see it as vPID 100, and
 * `kill 100` will resolve to the correct provider and real PID.
 *
 * Architecture:
 *   vPID allocation: monotonically increasing per workspace, starting at 100
 *   Registry: workspaceId → Map<vPid, PidMapping>
 *   Reverse index: `${provider}:${realPid}` → vPid (for ps output translation)
 *
 * Key operations:
 *   - registerProcess(): called when a process starts on any provider
 *   - unregisterProcess(): called when a process dies
 *   - translatePsOutput(): replaces real PIDs with vPIDs in ps output
 *   - resolveVpid(): vPID → real PID + provider for kill/pgrep routing
 *   - getProcessList(): returns all processes for a workspace with vPIDs
 *
 * Integration points:
 *   - gateway.ts: intercepts ps/kill, translates via registry
 *   - execution-router.ts: classifies ps/kill as pid-translation commands
 *   - workspace-service-manager.ts: auto-registers daemon service PIDs
 *   - advanced-terminal-commands.ts: handlers use registry instead of fake data
 *
 * Phase 2 (persistence):
 *   - Workspace tables are created by initializeWorkspaceRuntime() in init.ts
 *   - registerProcess → INSERT, unregisterProcess → DELETE,
 *     getProcessList → SELECT so state survives restarts
 */

import { createLogger } from '@/lib/utils/logger';
import { getDatabase } from '@/lib/database/connection';

const logger = createLogger('VirtualPidRegistry');

// ============================================================================
// Types
// ============================================================================

export interface PidMapping {
  /** Virtual PID — stable across providers and sessions */
  vPid: number;
  /** Real PID on the sandbox provider */
  realPid: number;
  /** Which sandbox provider owns this process */
  provider: string;
  /** The sandbox handle ID */
  sandboxId: string;
  /** The workspace this process belongs to */
  workspaceId: string;
  /** The command that started the process */
  command: string;
  /** User/owner of the process */
  user?: string;
  /** When the process was registered */
  registeredAt: number;
  /** Last time this mapping was confirmed alive */
  lastConfirmedAt: number;
  /** Whether this process is a workspace daemon service */
  isService: boolean;
  /** Associated service ID (if isService) */
  serviceId?: string;
}

export interface PidRegistryStats {
  workspaceId: string;
  totalMappings: number;
  serviceMappings: number;
  providers: Record<string, number>;
  oldestMapping: number;
  staleCount: number;
}

export interface PsTranslationResult {
  /** Translated output with vPIDs instead of real PIDs */
  output: string;
  /** Number of processes translated */
  translated: number;
  /** Number of processes that couldn't be translated (no mapping found) */
  untranslated: number;
}

export interface KillResolution {
  /** Whether the vPID was resolved successfully */
  resolved: boolean;
  /** The real PID on the provider */
  realPid?: number;
  /** Which provider to execute the kill on */
  provider?: string;
  /** The sandbox ID to target */
  sandboxId?: string;
  /** The command being killed (for confirmation message) */
  command?: string;
}

// ============================================================================
// Virtual PID Registry
// ============================================================================

export class VirtualPidRegistry {
  /** Per-workspace mappings: workspaceId → Map<vPid, PidMapping> */
  private mappings = new Map<string, Map<number, PidMapping>>();

  /**
   * Reverse index: `${provider}:${realPid}` → vPid.
   * Enables O(1) lookup when translating ps output.
   */
  private reverseIndex = new Map<string, number>();

  /** vPID counters per workspace (monotonically increasing) */
  private counters = new Map<string, number>();

  /** Tracks which workspaces have been hydrated from the database into the in-memory cache. */
  private loadedWorkspaces = new Set<string>();

  /** Base vPID to start counting from (reserve lower numbers for future system processes) */
  private readonly VPID_BASE = 100;

  /**
   * Register a process and get its virtual PID.
   * If a mapping already exists for this provider+realPid (e.g., from a previous
   * ps scan), it reuses the same vPID.
   *
   * Phase 2 (persistence): Also INSERTs/UPDATEs the workspace_processes DB table.
   * The in-memory Map is the hot cache; DB write is best-effort (errors caught).
   */
  registerProcess(params: {
    workspaceId: string;
    realPid: number;
    provider: string;
    sandboxId: string;
    command: string;
    user?: string;
    isService?: boolean;
    serviceId?: string;
  }): PidMapping {
    const {
      workspaceId, realPid, provider, sandboxId,
      command, user, isService, serviceId,
    } = params;

    const wMap = this.getOrCreateWorkspace(workspaceId);

    // Check if this real PID is already mapped (via reverse index)
    const reverseKey = `${provider}:${realPid}`;
    const existingVPid = this.reverseIndex.get(reverseKey);

    let vPid: number;

    if (existingVPid !== undefined) {
      // Reuse existing vPID — update the mapping
      vPid = existingVPid;
      const existing = wMap.get(vPid);
      if (existing) {
        existing.realPid = realPid;
        existing.sandboxId = sandboxId;
        existing.command = command;
        existing.user = user;
        existing.lastConfirmedAt = Date.now();
        existing.isService = isService || existing.isService;
        existing.serviceId = serviceId || existing.serviceId;
        logger.debug('Updated existing PID mapping', { vPid, realPid, provider, command: command.slice(0, 50) });
        // Sync update to DB
        this.syncRegisterToDb(existing);
        return existing;
      }
    }

    // Allocate new vPID
    const counter = (this.counters.get(workspaceId) || this.VPID_BASE - 1) + 1;
    this.counters.set(workspaceId, counter);
    vPid = counter;

    const mapping: PidMapping = {
      vPid,
      realPid,
      provider,
      sandboxId,
      workspaceId,
      command,
      user,
      registeredAt: Date.now(),
      lastConfirmedAt: Date.now(),
      isService: isService ?? false,
      serviceId,
    };

    wMap.set(vPid, mapping);
    this.reverseIndex.set(reverseKey, vPid);

    logger.info('Process registered in virtual PID table', {
      vPid,
      realPid,
      provider,
      command: command.slice(0, 50),
      workspaceId: workspaceId.slice(0, 16),
    });

    // Persist to DB
    this.syncRegisterToDb(mapping);

    return mapping;
  }

  /**
   * Unregister a process by vPID.
   * Phase 2 (persistence): Also DELETEs from the workspace_processes DB table.
   */
  unregisterProcess(workspaceId: string, vPid: number): boolean {
    const wMap = this.mappings.get(workspaceId);
    if (!wMap) return false;

    const mapping = wMap.get(vPid);
    if (!mapping) return false;

    // Remove from reverse index
    const reverseKey = `${mapping.provider}:${mapping.realPid}`;
    this.reverseIndex.delete(reverseKey);

    // Remove from workspace map
    wMap.delete(vPid);

    // Delete from DB (best-effort)
    this.syncDeleteFromDb(workspaceId, vPid);

    // Clean up empty workspace
    if (wMap.size === 0) {
      this.mappings.delete(workspaceId);
      this.counters.delete(workspaceId);
      this.loadedWorkspaces.delete(workspaceId);
    }

    logger.info('Process unregistered from virtual PID table', {
      vPid,
      realPid: mapping.realPid,
      provider: mapping.provider,
      command: mapping.command.slice(0, 50),
    });

    return true;
  }

  /**
   * Unregister all processes for a specific provider+realPid.
   * Called when a process is confirmed dead during ps translation.
   */
  unregisterByRealPid(provider: string, realPid: number, workspaceId?: string): boolean {
    const reverseKey = `${provider}:${realPid}`;
    const vPid = this.reverseIndex.get(reverseKey);
    if (vPid === undefined) return false;

    // If workspaceId is provided, verify the mapping belongs to it
    if (workspaceId) {
      const wMap = this.mappings.get(workspaceId);
      const mapping = wMap?.get(vPid);
      if (!mapping || mapping.provider !== provider) return false;
    }

    return this.unregisterProcess(workspaceId || '', vPid);
  }

  /**
   * Resolve a vPID to its real PID, provider, and sandbox.
   * Returns null if the vPID doesn't exist.
   */
  resolveVpid(workspaceId: string, vPid: number): KillResolution {
    const wMap = this.mappings.get(workspaceId);
    if (!wMap) return { resolved: false };

    const mapping = wMap.get(vPid);
    if (!mapping) return { resolved: false };

    return {
      resolved: true,
      realPid: mapping.realPid,
      provider: mapping.provider,
      sandboxId: mapping.sandboxId,
      command: mapping.command,
    };
  }

  /**
   * Find a vPID by command name substring (for pgrep functionality).
   */
  findVpidsByCommand(workspaceId: string, pattern: string): PidMapping[] {
    const wMap = this.mappings.get(workspaceId);
    if (!wMap) return [];

    const results: PidMapping[] = [];
    const lowerPattern = pattern.toLowerCase();

    for (const mapping of wMap.values()) {
      if (mapping.command.toLowerCase().includes(lowerPattern)) {
        results.push(mapping);
      }
    }

    return results;
  }

  /**
   * Translate raw `ps aux` output by replacing real PIDs with virtual PIDs.
   * This is the core translation layer — it takes the raw output from a
   * sandbox provider and rewrites it with vPIDs.
   */
  translatePsOutput(
    workspaceId: string,
    provider: string,
    rawOutput: string,
  ): PsTranslationResult {
    const wMap = this.mappings.get(workspaceId);
    if (!wMap || wMap.size === 0) {
      // No mappings — return raw output and register all PIDs
      return {
        output: this.registerPsOutput(workspaceId, provider, rawOutput),
        translated: 0,
        untranslated: 0,
      };
    }

    const lines = rawOutput.split('\n');
    const translatedLines: string[] = [];
    let translated = 0;
    let untranslated = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Preserve header line
      if (i === 0 || line.match(/^\s*(PID|USER)\s/)) {
        // Replace header: keep format but note the vPID column
        translatedLines.push(line);
        continue;
      }

      if (!line.trim()) {
        translatedLines.push(line);
        continue;
      }

      // Parse ps line: USER PID %CPU %MEM ... COMMAND
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) {
        translatedLines.push(line);
        continue;
      }

      // PID is typically the first numeric column after USER
      let pidIndex = -1;
      for (let j = 0; j < parts.length; j++) {
        if (/^\d+$/.test(parts[j]) && j > 0) {
          pidIndex = j;
          break;
        }
      }

      if (pidIndex === -1) {
        translatedLines.push(line);
        continue;
      }

      const realPid = parseInt(parts[pidIndex], 10);
      const reverseKey = `${provider}:${realPid}`;
      const vPid = this.reverseIndex.get(reverseKey);

      if (vPid !== undefined) {
        // Replace real PID with vPID
        const vPidStr = vPid.toString();
        // Pad to maintain alignment (ps output columns)
        const paddedVPid = parts[pidIndex].length >= vPidStr.length
          ? vPidStr.padStart(parts[pidIndex].length)
          : vPidStr;
        parts[pidIndex] = paddedVPid;
        translated++;
      } else {
        // New process — auto-register it
        const command = parts.slice(pidIndex + 1).join(' ');
        // Extract command columns: after VSZ/RSS columns; robust fallback
        const commandStart = pidIndex + 9; // Skip %CPU %MEM VSZ RSS START TIME
        const commandText = commandStart < parts.length
          ? parts.slice(commandStart).join(' ')
          : command;

        // Determine user from first column
        const user = parts[0];

        this.registerProcess({
          workspaceId,
          realPid,
          provider,
          sandboxId: '', // Will be filled in by caller if available
          command: commandText || 'unknown',
          user,
        });
        untranslated++;
      }

      translatedLines.push(parts.join(' '));
    }

    // If all lines are untranslated (first ps run), register them and re-translate
    if (translated === 0 && untranslated > 0) {
      return this.translatePsOutput(workspaceId, provider, rawOutput);
    }

    return {
      output: translatedLines.join('\n'),
      translated,
      untranslated,
    };
  }

  /**
   * First-time ps: register all PIDs from raw output without translating.
   * Returns the raw output but with processes registered for future lookups.
   */
  private registerPsOutput(
    workspaceId: string,
    provider: string,
    rawOutput: string,
  ): string {
    const lines = rawOutput.split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;

      // Find PID column (first numeric after USER)
      let pidIndex = -1;
      for (let j = 0; j < parts.length; j++) {
        if (/^\d+$/.test(parts[j]) && j > 0) {
          pidIndex = j;
          break;
        }
      }
      if (pidIndex === -1) continue;

      const realPid = parseInt(parts[pidIndex], 10);
      const commandStart = pidIndex + 9;
      const command = commandStart < parts.length
        ? parts.slice(commandStart).join(' ')
        : parts.slice(pidIndex + 1).join(' ');

      // Don't register these noise processes
      if (command === 'ps aux' || command.startsWith('grep') || command.startsWith('[')) {
        continue;
      }

      this.registerProcess({
        workspaceId,
        realPid,
        provider,
        sandboxId: '',
        command,
        user: parts[0],
      });
    }

    return rawOutput;
  }

  /**
   * Get all virtual process mappings for a workspace.
   * Returns processes sorted by vPID.
   *
   * Phase 2 (persistence): On first call for a workspace, hydrates the in-memory
   * cache from the workspace_processes DB table. Subsequent calls serve from cache.
   */
  getProcessList(workspaceId: string): PidMapping[] {
    // Hydrate from DB on first access if not already in cache
    if (!this.loadedWorkspaces.has(workspaceId)) {
      this.hydrateFromDb(workspaceId);
    }

    const wMap = this.mappings.get(workspaceId);
    if (!wMap) return [];

    return Array.from(wMap.values()).sort((a, b) => a.vPid - b.vPid);
  }

  /**
   * Get a mapping by vPID.
   */
  getMapping(workspaceId: string, vPid: number): PidMapping | undefined {
    const wMap = this.mappings.get(workspaceId);
    return wMap?.get(vPid);
  }

  /**
   * Update a mapping's lastConfirmedAt timestamp.
   * Called when ps output confirms the process is still alive.
   */
  confirmAlive(workspaceId: string, vPid: number): void {
    const wMap = this.mappings.get(workspaceId);
    const mapping = wMap?.get(vPid);
    if (mapping) {
      mapping.lastConfirmedAt = Date.now();
    }
  }

  /**
   * Clean up stale mappings that haven't been confirmed alive within the TTL.
   * A process is considered dead if it hasn't appeared in ps output for STALE_TTL_MS.
   */
  cleanupStale(workspaceId: string, staleTtlMs: number = 120_000): number {
    const wMap = this.mappings.get(workspaceId);
    if (!wMap) return 0;

    const now = Date.now();
    const stale: number[] = [];

    for (const [vPid, mapping] of wMap) {
      if (now - mapping.lastConfirmedAt > staleTtlMs) {
        stale.push(vPid);
      }
    }

    for (const vPid of stale) {
      this.unregisterProcess(workspaceId, vPid);
    }

    if (stale.length > 0) {
      logger.info('Cleaned up stale PID mappings', {
        workspaceId: workspaceId.slice(0, 16),
        count: stale.length,
      });
    }

    return stale.length;
  }

  /**
   * Clear all mappings for a workspace.
   * Phase 2 (persistence): Also DELETEs all rows from the workspace_processes DB table.
   */
  clearWorkspace(workspaceId: string): void {
    const wMap = this.mappings.get(workspaceId);
    if (!wMap) return;

    // Remove from reverse index
    for (const mapping of wMap.values()) {
      const reverseKey = `${mapping.provider}:${mapping.realPid}`;
      this.reverseIndex.delete(reverseKey);
    }

    this.mappings.delete(workspaceId);
    this.counters.delete(workspaceId);
    this.loadedWorkspaces.delete(workspaceId);

    // Delete all rows from DB (best-effort)
    try {
      const db = getDatabase();
      if (db) {
        db.prepare('DELETE FROM workspace_processes WHERE workspace_id = ?').run(workspaceId);
      }
    } catch (error: any) {
      logger.warn('Failed to delete workspace processes from DB', { workspaceId: workspaceId.slice(0, 16), error: error?.message });
    }

    logger.info('PID registry cleared for workspace', {
      workspaceId: workspaceId.slice(0, 16),
    });
  }

  /**
   * Get statistics about a workspace's PID registry.
   */
  getStats(workspaceId: string): PidRegistryStats | null {
    const wMap = this.mappings.get(workspaceId);
    if (!wMap) return null;

    const now = Date.now();
    const mappings = Array.from(wMap.values());

    const providerCounts: Record<string, number> = {};
    let serviceCount = 0;
    let oldestMapping = now;
    let staleCount = 0;

    for (const m of mappings) {
      providerCounts[m.provider] = (providerCounts[m.provider] || 0) + 1;
      if (m.isService) serviceCount++;
      if (m.registeredAt < oldestMapping) oldestMapping = m.registeredAt;
      if (now - m.lastConfirmedAt > 120_000) staleCount++;
    }

    return {
      workspaceId,
      totalMappings: mappings.length,
      serviceMappings: serviceCount,
      providers: providerCounts,
      oldestMapping: now - oldestMapping,
      staleCount,
    };
  }  // ============================================================================
  // Database persistence (Phase 2)
  // ============================================================================

  /**
   * Hydrate the in-memory cache from the database for a workspace.
   * Loads all rows from workspace_processes into the in-memory Map + reverse index.
   * Called automatically by getProcessList() on first access.
   */
  private hydrateFromDb(workspaceId: string): void {
    if (this.loadedWorkspaces.has(workspaceId)) return;

    try {
      const db = getDatabase();
      if (!db) {
        this.loadedWorkspaces.add(workspaceId);
        return;
      }

      const rows = db.prepare(
        'SELECT vpid, real_pid, provider, sandbox_id, command, user, registered_at, last_confirmed_at, is_service, service_id FROM workspace_processes WHERE workspace_id = ? ORDER BY vpid'
      ).all(workspaceId) as Array<{
        vpid: number;
        real_pid: number;
        provider: string;
        sandbox_id: string;
        command: string;
        user: string | null;
        registered_at: number;
        last_confirmed_at: number;
        is_service: number;
        service_id: string | null;
      }>;

      if (rows.length === 0) {
        this.loadedWorkspaces.add(workspaceId);
        return;
      }

      const wMap = this.getOrCreateWorkspace(workspaceId);
      let maxVPid = this.counters.get(workspaceId) || this.VPID_BASE - 1;

      for (const row of rows) {
        const mapping: PidMapping = {
          vPid: row.vpid,
          realPid: row.real_pid,
          provider: row.provider,
          sandboxId: row.sandbox_id,
          workspaceId,
          command: row.command,
          user: row.user || undefined,
          registeredAt: row.registered_at,
          lastConfirmedAt: row.last_confirmed_at,
          isService: row.is_service === 1,
          serviceId: row.service_id || undefined,
        };

        wMap.set(mapping.vPid, mapping);
        this.reverseIndex.set(`${mapping.provider}:${mapping.realPid}`, mapping.vPid);

        if (mapping.vPid > maxVPid) {
          maxVPid = mapping.vPid;
        }
      }

      // Set counter to avoid clashing with existing vPIDs
      this.counters.set(workspaceId, maxVPid);
      this.loadedWorkspaces.add(workspaceId);

      logger.debug('Hydrated PID cache from database', {
        workspaceId: workspaceId.slice(0, 16),
        count: rows.length,
        maxVPid,
      });
    } catch (error: any) {
      // If table doesn't exist yet, mark as loaded (empty cache is fine)
      if (error?.message?.includes('no such table')) {
        this.loadedWorkspaces.add(workspaceId);
        return;
      }
      logger.warn('Failed to hydrate PID cache from DB', { workspaceId: workspaceId.slice(0, 16), error: error?.message });
      this.loadedWorkspaces.add(workspaceId); // Don't retry on every call
    }
  }

  /**
   * INSERT or UPDATE a PID mapping in the workspace_processes table.
   * Best-effort — failures are caught and logged, not thrown.
   */
  private syncRegisterToDb(mapping: PidMapping): void {
    try {
      const db = getDatabase();
      if (!db) return;

      db.prepare(
        `INSERT OR REPLACE INTO workspace_processes
         (workspace_id, vpid, real_pid, provider, sandbox_id, command, user, registered_at, last_confirmed_at, is_service, service_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapping.workspaceId,
        mapping.vPid,
        mapping.realPid,
        mapping.provider,
        mapping.sandboxId,
        mapping.command,
        mapping.user || null,
        mapping.registeredAt,
        mapping.lastConfirmedAt,
        mapping.isService ? 1 : 0,
        mapping.serviceId || null,
      );
    } catch (error: any) {
      // During development or when running tests, the table may not exist yet
      if (error?.message?.includes('no such table')) return;
      logger.warn('Failed to sync PID registration to DB', { vPid: mapping.vPid, error: error?.message });
    }
  }

  /**
   * DELETE a PID mapping from the workspace_processes table.
   * Best-effort — failures are caught and logged, not thrown.
   */
  private syncDeleteFromDb(workspaceId: string, vPid: number): void {
    try {
      const db = getDatabase();
      if (!db) return;

      db.prepare(
        'DELETE FROM workspace_processes WHERE workspace_id = ? AND vpid = ?'
      ).run(workspaceId, vPid);
    } catch (error: any) {
      if (error?.message?.includes('no such table')) return;
      logger.warn('Failed to sync PID deletion to DB', { vPid, workspaceId: workspaceId.slice(0, 16), error: error?.message });
    }
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  private getOrCreateWorkspace(workspaceId: string): Map<number, PidMapping> {
    let wMap = this.mappings.get(workspaceId);
    if (!wMap) {
      wMap = new Map();
      this.mappings.set(workspaceId, wMap);
    }
    return wMap;
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const virtualPidRegistry = new VirtualPidRegistry();
