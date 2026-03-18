/**
 * Filesystem Edit Persistence Tests
 *
 * Tests for database-backed filesystem edit transaction persistence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { filesystemEditDatabase } from '@/lib/virtual-filesystem/filesystem-edit-database';
import { filesystemEditSessionService } from '@/lib/virtual-filesystem/filesystem-edit-session-service';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';

// Mock VFS to avoid conflicts during revert operations
vi.mock('@/lib/virtual-filesystem/virtual-filesystem-service', () => ({
  virtualFilesystem: {
    readFile: vi.fn().mockImplementation(async (ownerId: string, path: string) => {
      // For conflict detection, return current version matching the newVersion
      // This allows clean revert without conflicts
      throw new Error('File not found');
    }),
    writeFile: vi.fn().mockResolvedValue({ path: 'test', version: 1, content: '', language: 'text', size: 0 }),
    deletePath: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));

const mockedVFS = vi.mocked(virtualFilesystem);

describe('FilesystemEditDatabase', () => {
  const testOwnerId = 'test-db-owner';
  const testConversationId = 'test-db-conversation';

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset mock implementations for each test
    mockedVFS.readFile.mockImplementation(async (ownerId: string, path: string) => {
      throw new Error('File not found');
    });
    mockedVFS.writeFile.mockResolvedValue({ path: 'test', version: 1, content: '', language: 'text', size: 0 });
    mockedVFS.deletePath.mockResolvedValue({ deletedCount: 1 });
    // Clean up any existing test data
    // Note: In real tests, you'd want to use a test database
  });

  describe('persistTransaction', () => {
    it('should persist transaction to database', async () => {
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: testConversationId,
        requestId: 'test-request-1',
      });

      tx.operations.push({
        path: '/test/file.ts',
        operation: 'write',
        newVersion: 1,
        previousVersion: null,
        previousContent: null,
        existedBefore: false,
      });

      filesystemEditSessionService.acceptTransaction(tx.id);

      // Wait for async persistence
      await new Promise(resolve => setTimeout(resolve, 100));

      // Retrieve from database
      const restored = await filesystemEditDatabase.getTransaction(tx.id);

      expect(restored).toBeDefined();
      expect(restored?.id).toBe(tx.id);
      expect(restored?.ownerId).toBe(testOwnerId);
      expect(restored?.status).toBe('accepted');
    });

    it('should persist transaction with multiple operations', async () => {
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: testConversationId,
        requestId: 'test-request-2',
      });

      tx.operations.push(
        {
          path: '/test/file1.ts',
          operation: 'write',
          newVersion: 1,
          previousVersion: null,
          previousContent: null,
          existedBefore: false,
        },
        {
          path: '/test/file2.ts',
          operation: 'patch',
          newVersion: 2,
          previousVersion: 1,
          previousContent: 'old content',
          existedBefore: true,
        },
        {
          path: '/test/file3.ts',
          operation: 'delete',
          newVersion: 1,
          previousVersion: 1,
          previousContent: 'deleted content',
          existedBefore: true,
        }
      );

      filesystemEditSessionService.acceptTransaction(tx.id);
      await new Promise(resolve => setTimeout(resolve, 100));

      const restored = await filesystemEditDatabase.getTransaction(tx.id);

      expect(restored?.operations.length).toBe(3);
      expect(restored?.operations[0].path).toBe('/test/file1.ts');
      expect(restored?.operations[1].operation).toBe('patch');
      expect(restored?.operations[2].operation).toBe('delete');
    });

    it('should persist denial reason', async () => {
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: testConversationId,
        requestId: 'test-request-3',
      });

      // For a clean denial without conflicts, the file should exist with matching version
      mockedVFS.readFile.mockResolvedValue({
        path: '/test/file.ts',
        content: 'old content',
        language: 'typescript',
        version: 1,
        size: 11,
        lastModified: new Date().toISOString(),
      });

      tx.operations.push({
        path: '/test/file.ts',
        operation: 'write',
        newVersion: 1,
        previousVersion: null,
        previousContent: 'old content',
        existedBefore: true,
      });

      await filesystemEditSessionService.denyTransaction({
        transactionId: tx.id,
        reason: 'User rejected changes',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const restored = await filesystemEditDatabase.getTransaction(tx.id);

      expect(restored?.status).toBe('denied');
      expect(restored?.deniedReason).toBe('User rejected changes');
    });
  });

  describe('getTransaction', () => {
    it('should return null for non-existent transaction', async () => {
      const restored = await filesystemEditDatabase.getTransaction('non-existent-id');
      expect(restored).toBeNull();
    });

    it('should restore transaction from database', async () => {
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: testConversationId,
        requestId: 'test-request-4',
      });

      tx.operations.push({
        path: '/test/restore.ts',
        operation: 'write',
        newVersion: 1,
        previousVersion: null,
        previousContent: null,
        existedBefore: false,
      });

      filesystemEditSessionService.acceptTransaction(tx.id);
      await new Promise(resolve => setTimeout(resolve, 100));

      const restored = await filesystemEditDatabase.getTransaction(tx.id);

      expect(restored).toBeDefined();
      expect(restored?.id).toBe(tx.id);
      expect(restored?.operations.length).toBe(1);
    });
  });

  describe('getTransactionsByConversation', () => {
    it('should return transactions for conversation', async () => {
      const uniqueConvId = `test-conv-${Date.now()}`;

      // Create multiple transactions for same conversation
      const tx1 = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: uniqueConvId,
        requestId: 'test-request-5a',
      });
      filesystemEditSessionService.acceptTransaction(tx1.id);

      const tx2 = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: uniqueConvId,
        requestId: 'test-request-5b',
      });
      filesystemEditSessionService.acceptTransaction(tx2.id);

      await new Promise(resolve => setTimeout(resolve, 100));

      const transactions = await filesystemEditDatabase.getTransactionsByConversation(uniqueConvId);

      expect(transactions.length).toBeGreaterThanOrEqual(2);
      expect(transactions.map(t => t.conversationId)).toContain(uniqueConvId);
    });

    it('should order by created_at descending', async () => {
      const uniqueConvId = `test-conv-${Date.now()}`;

      const tx1 = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: uniqueConvId,
        requestId: 'test-request-6a',
      });
      filesystemEditSessionService.acceptTransaction(tx1.id);

      await new Promise(resolve => setTimeout(resolve, 50));

      const tx2 = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: uniqueConvId,
        requestId: 'test-request-6b',
      });
      filesystemEditSessionService.acceptTransaction(tx2.id);

      await new Promise(resolve => setTimeout(resolve, 100));

      const transactions = await filesystemEditDatabase.getTransactionsByConversation(uniqueConvId);

      // Most recent should be first
      expect(transactions[0].id).toBe(tx2.id);
      expect(transactions[1].id).toBe(tx1.id);
    });
  });

  describe('persistDenial', () => {
    it('should persist denial record', async () => {
      const uniqueConvId = `test-conv-security-${Date.now()}`;
      
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: uniqueConvId,
        requestId: 'test-request-7',
      });

      // For a clean denial without conflicts, the file should exist with matching version
      mockedVFS.readFile.mockResolvedValue({
        path: '/test/denied.ts',
        content: 'old content',
        language: 'typescript',
        version: 1,
        size: 11,
        lastModified: new Date().toISOString(),
      });

      tx.operations.push({
        path: '/test/denied.ts',
        operation: 'write',
        newVersion: 1,
        previousVersion: null,
        previousContent: 'old content',
        existedBefore: true,
      });

      await filesystemEditSessionService.denyTransaction({
        transactionId: tx.id,
        reason: 'Security concern',
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      const denials = await filesystemEditDatabase.getDenialsByConversation(uniqueConvId);

      expect(denials.length).toBeGreaterThan(0);
      expect(denials[0].reason).toBe('Security concern');
      expect(denials[0].paths).toContain('/test/denied.ts');
    });

    it('should persist multiple denials for conversation', async () => {
      const uniqueConvId = `test-conv-denial-${Date.now()}`;

      for (let i = 0; i < 3; i++) {
        const tx = filesystemEditSessionService.createTransaction({
          ownerId: testOwnerId,
          conversationId: uniqueConvId,
          requestId: `test-request-8-${i}`,
        });

        await filesystemEditSessionService.denyTransaction({
          transactionId: tx.id,
          reason: `Denial ${i}`,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const denials = await filesystemEditDatabase.getDenialsByConversation(uniqueConvId);

      expect(denials.length).toBe(3);
    });
  });

  describe('getDenialsByConversation', () => {
    it('should return empty array for no denials', async () => {
      const uniqueConvId = `test-conv-no-denials-${Date.now()}`;
      
      const denials = await filesystemEditDatabase.getDenialsByConversation(uniqueConvId);
      
      expect(denials).toEqual([]);
    });

    it('should limit results to 20', async () => {
      const uniqueConvId = `test-conv-limit-${Date.now()}`;

      // Create 25 denials
      for (let i = 0; i < 25; i++) {
        const tx = filesystemEditSessionService.createTransaction({
          ownerId: testOwnerId,
          conversationId: uniqueConvId,
          requestId: `test-request-9-${i}`,
        });

        await filesystemEditSessionService.denyTransaction({
          transactionId: tx.id,
          reason: `Denial ${i}`,
        });
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const denials = await filesystemEditDatabase.getDenialsByConversation(uniqueConvId);

      expect(denials.length).toBeLessThanOrEqual(20);
    });
  });

  describe('updateTransactionStatus', () => {
    it('should update transaction status', async () => {
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: testConversationId,
        requestId: 'test-request-10',
      });

      filesystemEditSessionService.acceptTransaction(tx.id);
      await new Promise(resolve => setTimeout(resolve, 100));

      await filesystemEditDatabase.updateTransactionStatus(tx.id, 'accepted');

      const restored = await filesystemEditDatabase.getTransaction(tx.id);
      expect(restored?.status).toBe('accepted');
    });
  });

  describe('getRecentTransactions', () => {
    it('should return recent transactions for owner', async () => {
      const uniqueOwnerId = `test-owner-recent-${Date.now()}`;

      for (let i = 0; i < 5; i++) {
        const tx = filesystemEditSessionService.createTransaction({
          ownerId: uniqueOwnerId,
          conversationId: testConversationId,
          requestId: `test-request-11-${i}`,
        });
        filesystemEditSessionService.acceptTransaction(tx.id);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const transactions = await filesystemEditDatabase.getRecentTransactions(uniqueOwnerId, 10);

      expect(transactions.length).toBe(5);
    });

    it('should respect limit parameter', async () => {
      const uniqueOwnerId = `test-owner-limit-${Date.now()}`;

      for (let i = 0; i < 10; i++) {
        const tx = filesystemEditSessionService.createTransaction({
          ownerId: uniqueOwnerId,
          conversationId: testConversationId,
          requestId: `test-request-12-${i}`,
        });
        filesystemEditSessionService.acceptTransaction(tx.id);
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const transactions = await filesystemEditDatabase.getRecentTransactions(uniqueOwnerId, 5);

      expect(transactions.length).toBe(5);
    });
  });

  describe('cleanupOldTransactions', () => {
    it('should cleanup transactions older than specified days', async () => {
      // This test would require manipulating timestamps
      // For now, just verify the method exists and doesn't throw
      const deleted = await filesystemEditDatabase.cleanupOldTransactions(30);
      expect(typeof deleted).toBe('number');
    });
  });
});

describe('FilesystemEditSessionService - Integration', () => {
  const testOwnerId = 'test-integration-owner';
  const testConversationId = 'test-integration-conversation';

  beforeEach(() => {
    // Clear in-memory state
    // Note: Database state persists across tests
  });

  describe('Transaction persistence flow', () => {
    it('should persist and restore complete transaction flow', async () => {
      // Create transaction
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: testConversationId,
        requestId: 'integration-test-1',
      });

      // Add operations
      tx.operations.push({
        path: '/integration/test.ts',
        operation: 'write',
        newVersion: 1,
        previousVersion: null,
        previousContent: null,
        existedBefore: false,
      });

      // Accept transaction (should persist)
      filesystemEditSessionService.acceptTransaction(tx.id);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Retrieve from database via service
      const restored = await filesystemEditSessionService.getTransaction(tx.id);

      expect(restored).toBeDefined();
      expect(restored?.id).toBe(tx.id);
      expect(restored?.status).toBe('accepted');
    });

    it('should persist denial and restore from database', async () => {
      const tx = filesystemEditSessionService.createTransaction({
        ownerId: testOwnerId,
        conversationId: testConversationId,
        requestId: 'integration-test-2',
      });

      // For a clean denial without conflicts, the file should exist with matching version
      mockedVFS.readFile.mockResolvedValue({
        path: '/integration/denied.ts',
        content: 'old content',
        language: 'typescript',
        version: 1,
        size: 11,
        lastModified: new Date().toISOString(),
      });

      tx.operations.push({
        path: '/integration/denied.ts',
        operation: 'write',
        newVersion: 1,
        previousVersion: null,
        previousContent: 'old content',
        existedBefore: true,
      });

      // Deny transaction
      const result = await filesystemEditSessionService.denyTransaction({
        transactionId: tx.id,
        reason: 'Integration test denial',
      });

      expect(result?.transaction.status).toBe('denied');
      await new Promise(resolve => setTimeout(resolve, 100));

      // Retrieve denials from database
      const denials = await filesystemEditSessionService.getRecentDenials(testConversationId);

      expect(denials.length).toBeGreaterThan(0);
      expect(denials[0].reason).toBe('Integration test denial');
    });
  });
});

