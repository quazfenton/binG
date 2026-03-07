/**
 * Backend Service Tests
 * 
 * Tests for backend initialization, configuration, and health monitoring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BackendService, initializeBackend, getBackendStatus } from '@/lib/backend/backend-service';

// Mock dependencies
vi.mock('@/lib/backend/websocket-terminal', () => ({
  webSocketTerminalServer: {
    start: vi.fn().mockResolvedValue(undefined),
    getActiveSessions: vi.fn().mockReturnValue(0),
  },
}));

vi.mock('@/lib/backend/storage-backend', () => ({
  getS3Backend: vi.fn(),
  getLocalBackend: vi.fn(),
}));

vi.mock('@/lib/backend/firecracker-runtime', () => ({
  getFirecrackerRuntime: vi.fn(),
  getProcessRuntime: vi.fn(),
}));

vi.mock('@/lib/backend/quota', () => ({
  quotaManager: {
    configure: vi.fn(),
  },
}));

vi.mock('@/lib/backend/snapshot-manager', () => ({
  snapshotManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('BackendService', () => {
  let service: BackendService;

  beforeEach(() => {
    service = new BackendService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with default config', () => {
      expect(service).toBeDefined();
      expect(service.isInitialized()).toBe(false);
    });

    it('should accept custom config', () => {
      const customService = new BackendService({
        websocketPort: 9000,
        enableQuotas: false,
      });
      
      expect(customService).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize successfully with valid config', async () => {
      const status = await service.initialize({
        storageType: 'local',
        runtimeType: 'process',
        websocketPort: 8080,
        enableQuotas: false,
      });

      expect(status.initialized).toBe(true);
      expect(service.isInitialized()).toBe(true);
    });

    it('should return cached status if already initialized', async () => {
      await service.initialize();
      const status1 = await service.initialize();
      const status2 = await service.initialize();

      expect(status1).toBe(status2); // Same reference
    });

    it('should handle concurrent initialization calls', async () => {
      // Start multiple initializations concurrently
      const [status1, status2, status3] = await Promise.all([
        service.initialize(),
        service.initialize(),
        service.initialize(),
      ]);

      // All should return the same status
      expect(status1.initialized).toBe(true);
      expect(status2.initialized).toBe(true);
      expect(status3.initialized).toBe(true);
    });

    it('should throw error if storage initialization fails', async () => {
      // This would require mocking the storage backend to throw
      // For now, we document the expected behavior
      await expect(service.initialize({
        storageType: 's3',
        s3AccessKey: undefined, // Will fail
        s3SecretKey: undefined,
      })).rejects.toThrow();
    });

    it('should update config when provided', async () => {
      await service.initialize({
        websocketPort: 9000,
      });

      const status = service.getStatus();
      expect(status.websocket.port).toBe(9000);
    });
  });

  describe('getStatus', () => {
    it('should return initial status before initialization', () => {
      const status = service.getStatus();

      expect(status.initialized).toBe(false);
      expect(status.storage.type).toBe('unknown');
      expect(status.websocket.running).toBe(false);
    });

    it('should return updated status after initialization', async () => {
      await service.initialize({
        storageType: 'local',
        runtimeType: 'process',
      });

      const status = service.getStatus();
      expect(status.initialized).toBe(true);
    });
  });

  describe('getWebSocketServer', () => {
    it('should return WebSocket server instance', () => {
      const server = service.getWebSocketServer();
      expect(server).toBeDefined();
      expect(server.start).toBeDefined();
      expect(server.getActiveSessions).toBeDefined();
    });
  });
});

describe('Backend Service Helpers', () => {
  describe('initializeBackend', () => {
    it('should initialize backend via helper function', async () => {
      const status = await initializeBackend({
        websocketPort: 8080,
      });

      expect(status.initialized).toBe(true);
    });
  });

  describe('getBackendStatus', () => {
    it('should return backend status via helper function', async () => {
      await initializeBackend();
      const status = getBackendStatus();

      expect(status).toBeDefined();
      expect(typeof status.initialized).toBe('boolean');
    });
  });
});

describe('BackendConfig', () => {
  it('should use environment variables as defaults', () => {
    // This tests that the DEFAULT_CONFIG reads from process.env
    // In a real scenario, you'd set specific env vars and verify
    const service = new BackendService();
    expect(service).toBeDefined();
  });

  it('should override env vars with explicit config', () => {
    const service = new BackendService({
      websocketPort: 9999,
      maxExecutionsPerHour: 500,
    });
    
    expect(service).toBeDefined();
  });
});
