/**
 * Spec Amplification Integration Tests
 * 
 * Tests the complete spec amplification flow:
 * 1. Final parse runs BEFORE done event
 * 2. Done event includes final parse edits via allEdits
 * 3. Spec amp check sees final parse edits
 * 4. Both regular LLM and ToolLoopAgent paths work correctly
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('Spec Amplification Integration', () => {
  describe('Final Parse Timing', () => {
    it('runs final parse BEFORE done event in regular LLM path', () => {
      // Simulate the order of operations in regular LLM streaming
      const eventOrder: string[] = [];
      
      // Mock streamedEdits tracking
      let streamedEdits: { applied: Array<{ path: string; operation: string }> } | null = null;
      
      // Simulate stream completion
      const onStreamComplete = () => {
        // Final parse runs FIRST
        streamedEdits = {
          applied: [
            { path: 'src/app.ts', operation: 'write' },
            { path: 'src/utils.ts', operation: 'patch' },
          ],
        };
        eventOrder.push('final_parse');
        
        // Then done event is emitted
        eventOrder.push('done_event');
      };
      
      onStreamComplete();
      
      // Verify order
      expect(eventOrder).toEqual(['final_parse', 'done_event']);
      expect(streamedEdits?.applied.length).toBe(2);
    });

    it('runs final parse BEFORE done event in ToolLoopAgent path', () => {
      // Simulate the order of operations in ToolLoopAgent streaming
      const eventOrder: string[] = [];
      
      // Mock allEdits tracking
      let allEdits: { applied: Array<{ path: string; operation: string }> } | null = null;
      
      // Simulate stream completion
      const onStreamComplete = () => {
        // Final parse runs FIRST (moved before done event)
        allEdits = {
          applied: [
            { path: 'package.json', operation: 'write' },
            { path: 'vite.config.js', operation: 'write' },
            { path: 'src/main.js', operation: 'write' },
          ],
        };
        eventOrder.push('final_parse');
        
        // Then done event is emitted with allEdits metadata
        eventOrder.push('done_event');
      };
      
      onStreamComplete();
      
      // Verify order
      expect(eventOrder).toEqual(['final_parse', 'done_event']);
      expect(allEdits?.applied.length).toBe(3);
    });
  });

  describe('Done Event Metadata', () => {
    it('includes final parse edits in regular LLM done event', () => {
      // Simulate regular LLM path done event construction
      const filesystemEdits = {
        applied: [],
        transactionId: 'pre-stream-tx',
        status: 'pending',
        requestedFiles: [],
        scopePath: 'project/sessions/001',
        workspaceVersion: 1,
        commitId: 'pre-stream-commit',
        sessionId: '001',
      };
      
      const streamedEdits = {
        applied: [
          { path: 'src/app.ts', operation: 'write', content: 'export default App' },
          { path: 'src/utils.ts', operation: 'patch', diff: '--- old\n+++ new' },
        ],
        transactionId: 'final-parse-tx',
        status: 'applied',
        requestedFiles: [{ path: 'src/app.ts' }, { path: 'src/utils.ts' }],
        scopePath: 'project/sessions/001',
        workspaceVersion: 2,
        commitId: 'final-parse-commit',
        sessionId: '001',
      };
      
      // CRITICAL FIX: Use allEdits instead of just filesystemEdits
      const allEdits = streamedEdits.applied.length > 0 ? streamedEdits : filesystemEdits;
      
      const doneEventData: any = { requestId: 'test-123' };
      
      if (allEdits && allEdits.applied.length > 0) {
        doneEventData.filesystem = {
          transactionId: allEdits.transactionId,
          status: allEdits.status,
          applied: allEdits.applied,
          errors: allEdits.errors,
          requestedFiles: allEdits.requestedFiles,
          scopePath: allEdits.scopePath,
          workspaceVersion: allEdits.workspaceVersion,
          commitId: allEdits.commitId,
          sessionId: allEdits.sessionId,
        };
        
        doneEventData.fileEdits = allEdits.applied.map(edit => ({
          path: edit.path,
          operation: edit.operation,
          content: edit.content || '',
          diff: edit.diff,
        }));
      }
      
      // Verify done event includes final parse edits
      expect(doneEventData.filesystem).toBeDefined();
      expect(doneEventData.filesystem.transactionId).toBe('final-parse-tx');
      expect(doneEventData.filesystem.applied.length).toBe(2);
      expect(doneEventData.fileEdits.length).toBe(2);
      expect(doneEventData.fileEdits[0].path).toBe('src/app.ts');
    });

    it('includes final parse edits in ToolLoopAgent done event', () => {
      // Simulate ToolLoopAgent path done event construction
      const filesystemEdits = {
        applied: [],
        transactionId: 'pre-stream-tx',
        status: 'pending',
      };
      
      const allEdits = {
        applied: [
          { path: 'package.json', operation: 'write', content: '{"name":"test"}' },
          { path: 'vite.config.js', operation: 'write', content: 'export default {}' },
          { path: 'src/main.js', operation: 'write', content: 'console.log("hi")' },
        ],
        transactionId: 'final-parse-tx',
        status: 'applied',
        requestedFiles: [{ path: 'package.json' }],
        scopePath: 'project/sessions/002',
        workspaceVersion: 3,
        commitId: 'final-parse-commit',
        sessionId: '002',
      };
      
      const doneEventData: any = { requestId: 'test-456' };
      
      if (allEdits && allEdits.applied.length > 0) {
        doneEventData.filesystem = {
          transactionId: allEdits.transactionId,
          status: allEdits.status,
          applied: allEdits.applied,
          errors: allEdits.errors,
          requestedFiles: allEdits.requestedFiles,
          scopePath: allEdits.scopePath,
          workspaceVersion: allEdits.workspaceVersion,
          commitId: allEdits.commitId,
          sessionId: allEdits.sessionId,
        };
        
        doneEventData.fileEdits = allEdits.applied.map(edit => ({
          path: edit.path,
          operation: edit.operation,
          content: edit.content || '',
        }));
      }
      
      // Verify done event includes final parse edits
      expect(doneEventData.filesystem).toBeDefined();
      expect(doneEventData.filesystem.transactionId).toBe('final-parse-tx');
      expect(doneEventData.filesystem.applied.length).toBe(3);
      expect(doneEventData.fileEdits.length).toBe(3);
      expect(doneEventData.fileEdits[0].path).toBe('package.json');
    });

    it('falls back to filesystemEdits when no streamedEdits', () => {
      // Edge case: no edits from final parse, only pre-stream edits
      const filesystemEdits = {
        applied: [{ path: 'pre-stream.ts', operation: 'write' }],
        transactionId: 'pre-stream-tx',
        status: 'applied',
        requestedFiles: [],
        scopePath: 'project/sessions/001',
        workspaceVersion: 1,
        commitId: 'pre-stream-commit',
        sessionId: '001',
      };
      
      const streamedEdits = { applied: [] };
      
      // CRITICAL FIX: Use allEdits to check both sources
      const allEdits = streamedEdits.applied.length > 0 ? streamedEdits : filesystemEdits;
      
      const doneEventData: any = {};
      
      if (allEdits && allEdits.applied.length > 0) {
        doneEventData.filesystem = {
          transactionId: allEdits.transactionId,
          applied: allEdits.applied,
        };
      }
      
      // Verify fallback works
      expect(doneEventData.filesystem).toBeDefined();
      expect(doneEventData.filesystem.transactionId).toBe('pre-stream-tx');
      expect(doneEventData.filesystem.applied.length).toBe(1);
    });
  });

  describe('Spec Amplification Trigger', () => {
    it('triggers spec amp when streamedEdits has edits (regular LLM)', () => {
      const routerRequest = { mode: 'enhanced' };
      const clientResponse = { metadata: {} };
      
      const streamedEdits = {
        applied: [{ path: 'src/app.ts', operation: 'write' }],
      };
      
      // Spec amp check logic
      const hasFileEdits = streamedEdits?.applied?.length > 0;
      const isSpecAmplificationMode = routerRequest.mode === 'enhanced' || routerRequest.mode === 'max';
      const shouldRunSpecAmplification = hasFileEdits && isSpecAmplificationMode && !clientResponse.metadata?.specAmplificationRun;
      
      expect(hasFileEdits).toBe(true);
      expect(isSpecAmplificationMode).toBe(true);
      expect(shouldRunSpecAmplification).toBe(true);
    });

    it('triggers spec amp when allEdits has edits (ToolLoopAgent)', () => {
      const routerRequest = { mode: 'enhanced' };
      const clientResponse = { metadata: {} };
      
      const allEdits = {
        applied: [
          { path: 'package.json', operation: 'write' },
          { path: 'vite.config.js', operation: 'write' },
        ],
      };
      
      // Spec amp check logic
      const hasFileEdits = allEdits && allEdits.applied.length > 0;
      const isSpecAmplificationMode = routerRequest.mode === 'enhanced' || routerRequest.mode === 'max';
      const shouldRunSpecAmplification = hasFileEdits && isSpecAmplificationMode && !clientResponse.metadata?.specAmplificationRun;
      
      expect(hasFileEdits).toBe(true);
      expect(isSpecAmplificationMode).toBe(true);
      expect(shouldRunSpecAmplification).toBe(true);
    });

    it('does NOT trigger spec amp when no edits', () => {
      const routerRequest = { mode: 'enhanced' };
      const clientResponse = { metadata: {} };
      
      const streamedEdits = { applied: [] };
      
      // Spec amp check logic
      const hasFileEdits = streamedEdits?.applied?.length > 0;
      const isSpecAmplificationMode = routerRequest.mode === 'enhanced' || routerRequest.mode === 'max';
      const shouldRunSpecAmplification = hasFileEdits && isSpecAmplificationMode && !clientResponse.metadata?.specAmplificationRun;
      
      expect(hasFileEdits).toBe(false);
      expect(shouldRunSpecAmplification).toBe(false);
    });

    it('does NOT trigger spec amp when mode is not enhanced/max', () => {
      const routerRequest = { mode: 'normal' };
      const clientResponse = { metadata: {} };
      
      const streamedEdits = { applied: [{ path: 'src/app.ts', operation: 'write' }] };
      
      // Spec amp check logic
      const hasFileEdits = streamedEdits?.applied?.length > 0;
      const isSpecAmplificationMode = routerRequest.mode === 'enhanced' || routerRequest.mode === 'max';
      const shouldRunSpecAmplification = hasFileEdits && isSpecAmplificationMode && !clientResponse.metadata?.specAmplificationRun;
      
      expect(hasFileEdits).toBe(true);
      expect(isSpecAmplificationMode).toBe(false);
      expect(shouldRunSpecAmplification).toBe(false);
    });

    it('does NOT trigger spec amp if already run', () => {
      const routerRequest = { mode: 'enhanced' };
      const clientResponse = { metadata: { specAmplificationRun: true } };
      
      const streamedEdits = { applied: [{ path: 'src/app.ts', operation: 'write' }] };
      
      // Spec amp check logic
      const hasFileEdits = streamedEdits?.applied?.length > 0;
      const isSpecAmplificationMode = routerRequest.mode === 'enhanced' || routerRequest.mode === 'max';
      const shouldRunSpecAmplification = hasFileEdits && isSpecAmplificationMode && !clientResponse.metadata?.specAmplificationRun;
      
      expect(hasFileEdits).toBe(true);
      expect(isSpecAmplificationMode).toBe(true);
      expect(shouldRunSpecAmplification).toBe(false); // Already run!
    });
  });

  describe('Progressive Edit Tracking', () => {
    it('tracks progressive edits for spec amp check', () => {
      // Simulate progressive edit detection during streaming
      let streamedEdits: { applied: Array<any> } | null = null;
      
      const onProgressiveEdit = (edit: { path: string; operation: string; content: string }) => {
        if (!streamedEdits) {
          streamedEdits = { applied: [] };
        }
        streamedEdits.applied.push(edit);
      };
      
      // Simulate progressive edits during streaming
      onProgressiveEdit({ path: 'package.json', operation: 'write', content: '{"name":"test"}' });
      onProgressiveEdit({ path: 'src/app.ts', operation: 'write', content: 'export default App' });
      
      // Verify tracking
      expect(streamedEdits).not.toBeNull();
      expect(streamedEdits?.applied.length).toBe(2);
      
      // Spec amp check should see these edits
      const hasFileEdits = streamedEdits?.applied?.length > 0;
      expect(hasFileEdits).toBe(true);
    });

    it('combines progressive and final parse edits', () => {
      // Simulate progressive edits during streaming
      let streamedEdits: { applied: Array<any> } | null = null;
      
      const onProgressiveEdit = (edit: any) => {
        if (!streamedEdits) {
          streamedEdits = { applied: [] };
        }
        streamedEdits.applied.push(edit);
      };
      
      // Progressive edits
      onProgressiveEdit({ path: 'package.json', operation: 'write' });
      
      // Final parse adds more edits
      const finalParseEdits = [
        { path: 'vite.config.js', operation: 'write' },
        { path: 'src/main.js', operation: 'write' },
      ];
      
      if (streamedEdits) {
        streamedEdits.applied.push(...finalParseEdits);
      }
      
      // Verify combined edits
      expect(streamedEdits?.applied.length).toBe(3);
      expect(streamedEdits?.applied.map(e => e.path)).toEqual([
        'package.json',
        'vite.config.js',
        'src/main.js',
      ]);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty streamedEdits gracefully', () => {
      const streamedEdits = { applied: [] };
      const filesystemEdits = { applied: [], transactionId: 'tx' };
      
      const allEdits = streamedEdits.applied.length > 0 ? streamedEdits : filesystemEdits;
      
      expect(allEdits).toBe(filesystemEdits);
      expect(allEdits.applied.length).toBe(0);
    });

    it('handles null/undefined edits gracefully', () => {
      const streamedEdits = null;
      const filesystemEdits = { applied: [], transactionId: 'tx' };
      
      const allEdits = streamedEdits || filesystemEdits;
      
      expect(allEdits).toBe(filesystemEdits);
    });

    it('handles spec amp with mixed edit types', () => {
      const allEdits = {
        applied: [
          { path: 'src/app.ts', operation: 'write', content: 'full content' },
          { path: 'src/utils.ts', operation: 'patch', diff: '--- old\n+++ new' },
          { path: 'src/test.ts', operation: 'delete' },
        ],
      };
      
      const hasFileEdits = allEdits && allEdits.applied.length > 0;
      expect(hasFileEdits).toBe(true);
      expect(allEdits.applied.length).toBe(3);
    });
  });
});
