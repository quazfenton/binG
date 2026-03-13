/**
 * OPFS Test Utilities
 * 
 * Helper functions for testing OPFS functionality
 */

import { opfsCore } from './opfs-core';
import { opfsAdapter } from './opfs-adapter';

export interface TestFile {
  path: string;
  content: string;
}

export interface OPFSTestResult {
  success: boolean;
  duration: number;
  error?: string;
}

/**
 * Create test files in OPFS
 */
export async function createTestFiles(
  workspaceId: string,
  files: TestFile[]
): Promise<OPFSTestResult> {
  const startTime = Date.now();
  
  try {
    await opfsCore.initialize(workspaceId);
    
    for (const file of files) {
      await opfsCore.writeFile(file.path, file.content);
    }
    
    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Read test files from OPFS
 */
export async function readTestFiles(
  workspaceId: string,
  paths: string[]
): Promise<OPFSTestResult & { files: Record<string, string> }> {
  const startTime = Date.now();
  const files: Record<string, string> = {};
  
  try {
    await opfsCore.initialize(workspaceId);
    
    for (const path of paths) {
      const file = await opfsCore.readFile(path);
      files[path] = file.content;
    }
    
    return {
      success: true,
      duration: Date.now() - startTime,
      files,
    };
  } catch (error: any) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error.message,
      files: {},
    };
  }
}

/**
 * Delete test files from OPFS
 */
export async function deleteTestFiles(
  workspaceId: string,
  paths: string[]
): Promise<OPFSTestResult> {
  const startTime = Date.now();
  
  try {
    await opfsCore.initialize(workspaceId);
    
    for (const path of paths) {
      await opfsCore.deleteFile(path);
    }
    
    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Clear workspace
 */
export async function clearWorkspace(workspaceId: string): Promise<OPFSTestResult> {
  const startTime = Date.now();
  
  try {
    await opfsCore.initialize(workspaceId);
    await opfsCore.clear();
    
    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Test OPFS performance
 */
export async function testOPFSPerformance(
  workspaceId: string,
  iterations: number = 10
): Promise<{
  writeAvg: number;
  readAvg: number;
  writeMin: number;
  writeMax: number;
  readMin: number;
  readMax: number;
}> {
  await opfsCore.initialize(workspaceId);
  
  const writeTimes: number[] = [];
  const readTimes: number[] = [];
  
  for (let i = 0; i < iterations; i++) {
    const testContent = `Test content ${i} - ${'x'.repeat(1000)}`;
    const testPath = `test/file-${i}.txt`;
    
    // Write test
    const writeStart = Date.now();
    await opfsCore.writeFile(testPath, testContent);
    writeTimes.push(Date.now() - writeStart);
    
    // Read test
    const readStart = Date.now();
    await opfsCore.readFile(testPath);
    readTimes.push(Date.now() - readStart);
  }
  
  // Cleanup
  for (let i = 0; i < iterations; i++) {
    await opfsCore.deleteFile(`test/file-${i}.txt`);
  }
  
  return {
    writeAvg: writeTimes.reduce((a, b) => a + b, 0) / writeTimes.length,
    readAvg: readTimes.reduce((a, b) => a + b, 0) / readTimes.length,
    writeMin: Math.min(...writeTimes),
    writeMax: Math.max(...writeTimes),
    readMin: Math.min(...readTimes),
    readMax: Math.max(...readTimes),
  };
}

/**
 * Test sync performance
 */
export async function testSyncPerformance(
  ownerId: string,
  iterations: number = 5
): Promise<{
  syncAvg: number;
  successRate: number;
}> {
  const syncTimes: number[] = [];
  let successes = 0;
  
  for (let i = 0; i < iterations; i++) {
    const testContent = `Sync test ${i}`;
    const testPath = `sync-test-${i}.txt`;
    
    const start = Date.now();
    try {
      await opfsAdapter.writeFile(ownerId, testPath, testContent);
      successes++;
      syncTimes.push(Date.now() - start);
    } catch {
      // Failed
    }
  }
  
  return {
    syncAvg: syncTimes.length > 0 ? syncTimes.reduce((a, b) => a + b, 0) / syncTimes.length : 0,
    successRate: successes / iterations,
  };
}

/**
 * Generate random test content
 */
export function generateTestContent(size: number = 1000): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < size; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Create test directory structure
 */
export async function createTestDirectoryStructure(
  workspaceId: string,
  depth: number = 3,
  breadth: number = 3
): Promise<OPFSTestResult> {
  const startTime = Date.now();
  
  try {
    await opfsCore.initialize(workspaceId);
    
    async function createStructure(path: string, currentDepth: number): Promise<void> {
      if (currentDepth > depth) return;
      
      await opfsCore.createDirectory(path, { recursive: true });
      
      for (let i = 0; i < breadth; i++) {
        const dirPath = `${path}/dir-${currentDepth}-${i}`;
        const filePath = `${path}/file-${currentDepth}-${i}.txt`;
        
        await opfsCore.createDirectory(dirPath, { recursive: true });
        await opfsCore.writeFile(filePath, generateTestContent(100));
        
        if (currentDepth < depth) {
          await createStructure(dirPath, currentDepth + 1);
        }
      }
    }
    
    await createStructure('test-root', 1);
    
    return {
      success: true,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    return {
      success: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}
