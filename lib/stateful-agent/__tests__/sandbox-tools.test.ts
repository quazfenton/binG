/**
 * Tests for Stateful Agent Sandbox Tools
 */

import { describe, it, expect } from 'vitest';
import {
  readFileTool,
  listFilesTool,
  createFileTool,
  applyDiffTool,
  execShellTool,
  allTools
} from '../tools/sandbox-tools';

describe('Sandbox Tools', () => {
  describe('readFileTool', () => {
    it('should be defined', () => {
      expect(readFileTool).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof readFileTool.execute).toBe('function');
    });
  });

  describe('listFilesTool', () => {
    it('should be defined', () => {
      expect(listFilesTool).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof listFilesTool.execute).toBe('function');
    });
  });

  describe('createFileTool', () => {
    it('should be defined', () => {
      expect(createFileTool).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof createFileTool.execute).toBe('function');
    });
  });

  describe('applyDiffTool', () => {
    it('should be defined', () => {
      expect(applyDiffTool).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof applyDiffTool.execute).toBe('function');
    });
  });

  describe('execShellTool', () => {
    it('should be defined', () => {
      expect(execShellTool).toBeDefined();
    });

    it('should have execute function', () => {
      expect(typeof execShellTool.execute).toBe('function');
    });
  });

  describe('allTools', () => {
    it('should export all tools', () => {
      expect(allTools).toBeDefined();
      expect(allTools.readFile).toBeDefined();
      expect(allTools.listFiles).toBeDefined();
      expect(allTools.createFile).toBeDefined();
      expect(allTools.applyDiff).toBeDefined();
      expect(allTools.execShell).toBeDefined();
      expect(allTools.syntaxCheck).toBeDefined();
      expect(allTools.requestApproval).toBeDefined();
      expect(allTools.discovery).toBeDefined();
      expect(allTools.createPlan).toBeDefined();
      expect(allTools.commit).toBeDefined();
      expect(allTools.rollback).toBeDefined();
      expect(allTools.history).toBeDefined();
    });

    it('should have correct number of tools', () => {
      const toolCount = Object.keys(allTools).length;
      expect(toolCount).toBeGreaterThanOrEqual(12);
    });
  });
});
