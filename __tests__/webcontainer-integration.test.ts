/**
 * WebContainer Provider Integration Test
 * 
 * Tests WebContainer sandbox creation, command execution, and file operations.
 * This test MUST run in a browser environment (not Node.js).
 * 
 * Requirements:
 * - NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID must be set in .env.local
 * - Test must run in browser (Vitest browser mode or Playwright)
 * 
 * Run with:
 *   npm run test:webcontainer
 * 
 * Or in browser console:
 *   await import('./__tests__/webcontainer-integration.test.ts')
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Skip if not in browser
const isBrowser = typeof window !== 'undefined';
const describeIfBrowser = isBrowser ? describe : describe.skip;

// Types from WebContainer API
interface WebContainerProcess {
  output?: ReadableStream<Uint8Array>;
  exit?: Promise<number>;
}

interface WebContainerInstance {
  fs: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readFile(path: string, encoding?: string): Promise<string | Uint8Array>;
    readdir(path: string, options?: { withFileTypes?: boolean }): Promise<any[]>;
  };
  spawn(command: string, args?: string[], options?: { cwd?: string }): Promise<WebContainerProcess>;
  on?(event: string, listener: (...args: any[]) => void): void;
}

// Test state
let wcInstance: WebContainerInstance | null = null;
const createdFiles: string[] = [];

describeIfBrowser('WebContainer Integration', () => {
  const TEST_TIMEOUT = 60000; // 60 seconds for WebContainer boot

  beforeAll(async () => {
    // Verify environment
    expect(typeof window).toBe('object', 'WebContainer tests require browser environment');
    
    // Verify API is available
    expect(process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID).toBeTruthy(),
      'NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID must be set';

    // Boot WebContainer
    try {
      const { WebContainer } = await import('@webcontainer/api');
      
      // Initialize auth if available
      const clientId = process.env.NEXT_PUBLIC_WEBCONTAINER_CLIENT_ID || 'wc_api_____';
      const scope = process.env.NEXT_PUBLIC_WEBCONTAINER_SCOPE || '';
      
      // @ts-ignore - auth may not be available in all versions
      if (WebContainer.auth?.init) {
        // @ts-ignore
        WebContainer.auth.init({ clientId, scope });
      }

      // Boot the WebContainer
      wcInstance = await WebContainer.boot();
      
      // Create workspace directory
      await wcInstance.fs.mkdir('/workspace', { recursive: true });
      
      console.log('[WebContainer] Booted successfully');
    } catch (error: any) {
      console.error('[WebContainer] Boot failed:', error);
      throw new Error(`WebContainer boot failed: ${error.message}`);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Cleanup created files
    if (wcInstance) {
      for (const filePath of createdFiles) {
        try {
          // @ts-ignore - deleteFile may exist in newer versions
          if (wcInstance.fs.rm) {
            // @ts-ignore
            await wcInstance.fs.rm(filePath, { recursive: true });
          }
        } catch (error) {
          console.warn(`[Cleanup] Failed to delete ${filePath}:`, error);
        }
      }
      
      // Teardown WebContainer
      try {
        // @ts-ignore - teardown may exist
        await wcInstance.teardown?.();
      } catch (error) {
        console.warn('[Cleanup] Teardown failed:', error);
      }
    }
  });

  describe('Filesystem Operations', () => {
    it('should create directory', async () => {
      expect(wcInstance).toBeTruthy();
      
      const testDir = '/workspace/test-dir';
      await wcInstance!.fs.mkdir(testDir, { recursive: true });
      
      const entries = await wcInstance!.fs.readdir('/workspace');
      const testDirExists = entries.some((entry: any) => 
        entry.name === 'test-dir' || entry === 'test-dir'
      );
      
      expect(testDirExists).toBe(true);
    });

    it('should write file', async () => {
      expect(wcInstance).toBeTruthy();
      
      const testFile = '/workspace/test.txt';
      const testContent = `Hello from WebContainer! ${Date.now()}`;
      
      await wcInstance!.fs.writeFile(testFile, testContent);
      createdFiles.push(testFile);
      
      const content = await wcInstance!.fs.readFile(testFile, 'utf-8');
      expect(content).toBe(testContent);
    });

    it('should read file', async () => {
      expect(wcInstance).toBeTruthy();
      
      const testFile = '/workspace/read-test.txt';
      const testContent = 'Read test content ' + Math.random().toString(36);
      
      await wcInstance!.fs.writeFile(testFile, testContent);
      createdFiles.push(testFile);
      
      const content = await wcInstance!.fs.readFile(testFile, 'utf-8');
      expect(content).toContain('Read test content');
    });

    it('should list directory', async () => {
      expect(wcInstance).toBeTruthy();
      
      // Create multiple files
      const files = [
        '/workspace/list-test-1.txt',
        '/workspace/list-test-2.txt',
        '/workspace/list-test-3.txt',
      ];
      
      for (const file of files) {
        await wcInstance!.fs.writeFile(file, `Content of ${file}`);
        createdFiles.push(file);
      }
      
      const entries = await wcInstance!.fs.readdir('/workspace');
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThanOrEqual(3);
    });

    it('should write and read JavaScript file', async () => {
      expect(wcInstance).toBeTruthy();
      
      const jsFile = '/workspace/test.js';
      const jsContent = `
        const greeting = 'Hello from JavaScript';
        const number = 42;
        const obj = { name: 'WebContainer', version: '1.0' };
        console.log(greeting, number, obj);
        module.exports = { greeting, number, obj };
      `;
      
      await wcInstance!.fs.writeFile(jsFile, jsContent);
      createdFiles.push(jsFile);
      
      const content = await wcInstance!.fs.readFile(jsFile, 'utf-8');
      expect(content).toContain('Hello from JavaScript');
      expect(content).toContain('module.exports');
    });
  });

  describe('Command Execution', () => {
    it('should execute node --version', async () => {
      expect(wcInstance).toBeTruthy();
      
      const process = await wcInstance!.spawn('node', ['--version']);
      const output = await readStreamToString(process.output);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(0);
      expect(output).toMatch(/v\d+\.\d+\.\d+/);
    });

    it('should execute npm --version', async () => {
      expect(wcInstance).toBeTruthy();
      
      const process = await wcInstance!.spawn('npm', ['--version']);
      const output = await readStreamToString(process.output);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(0);
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should execute echo command', async () => {
      expect(wcInstance).toBeTruthy();
      
      const testMessage = 'Hello WebContainer Test ' + Date.now();
      const process = await wcInstance!.spawn('echo', [testMessage]);
      const output = await readStreamToString(process.output);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(0);
      expect(output.trim()).toContain(testMessage);
    });

    it('should execute JavaScript file with Node.js', async () => {
      expect(wcInstance).toBeTruthy();
      
      // Create test file
      const jsFile = '/workspace/run-test.js';
      const jsContent = `
        console.log('Node.js execution test');
        console.log('PI value:', Math.PI);
        console.log('Timestamp:', Date.now());
        process.exit(0);
      `;
      
      await wcInstance!.fs.writeFile(jsFile, jsContent);
      createdFiles.push(jsFile);
      
      // Execute with Node.js
      const process = await wcInstance!.spawn('node', [jsFile]);
      const output = await readStreamToString(process.output);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(0);
      expect(output).toContain('Node.js execution test');
      expect(output).toContain('PI value:');
    });

    it('should execute command in custom working directory', async () => {
      expect(wcInstance).toBeTruthy();
      
      // Create directory and file
      const testDir = '/workspace/cwd-test';
      const testFile = 'pwd-test.txt';
      
      await wcInstance!.fs.mkdir(testDir, { recursive: true });
      await wcInstance!.fs.writeFile(`${testDir}/${testFile}`, 'PWD test content');
      createdFiles.push(`${testDir}/${testFile}`);
      
      // Execute command in that directory
      const process = await wcInstance!.spawn('ls', ['-la'], { cwd: testDir });
      const output = await readStreamToString(process.output);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(0);
      expect(output).toContain(testFile);
    });
  });

  describe('Package Installation', () => {
    it('should initialize npm project', async () => {
      expect(wcInstance).toBeTruthy();
      
      const projectDir = '/workspace/npm-test';
      await wcInstance!.fs.mkdir(projectDir, { recursive: true });
      
      // Create package.json
      const packageJson = {
        name: 'webcontainer-test',
        version: '1.0.0',
        description: 'WebContainer test project',
        main: 'index.js',
        scripts: {
          test: 'echo "Tests passed" && exit 0',
          start: 'node index.js',
        },
      };
      
      await wcInstance!.fs.writeFile(
        `${projectDir}/package.json`,
        JSON.stringify(packageJson, null, 2)
      );
      
      // Verify package.json
      const content = await wcInstance!.fs.readFile(`${projectDir}/package.json`, 'utf-8');
      const parsed = JSON.parse(content);
      
      expect(parsed.name).toBe('webcontainer-test');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.scripts.test).toContain('Tests passed');
    });

    it('should install npm package', async () => {
      expect(wcInstance).toBeTruthy();
      
      const projectDir = '/workspace/install-test';
      await wcInstance!.fs.mkdir(projectDir, { recursive: true });
      
      // Create minimal package.json
      await wcInstance!.fs.writeFile(
        `${projectDir}/package.json`,
        JSON.stringify({
          name: 'install-test',
          version: '1.0.0',
          dependencies: {
            'lodash': '^4.17.21',
          },
        }, null, 2)
      );
      
      // Install dependencies (this may take 10-30 seconds)
      const process = await wcInstance!.spawn('npm', ['install'], { cwd: projectDir });
      const output = await readStreamToString(process.output);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(0);
      expect(output).toContain('added');
      
      // Verify node_modules exists
      const entries = await wcInstance!.fs.readdir(projectDir);
      const hasNodeModules = entries.some((e: any) => 
        e.name === 'node_modules' || e === 'node_modules'
      );
      expect(hasNodeModules).toBe(true);
    }, 90000); // 90 seconds for npm install
  });

  describe('Server Execution', () => {
    it('should start HTTP server', async () => {
      expect(wcInstance).toBeTruthy();
      
      const serverDir = '/workspace/server-test';
      await wcInstance!.fs.mkdir(serverDir, { recursive: true });
      
      // Create simple HTTP server
      const serverCode = `
        const http = require('http');
        
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Hello from WebContainer HTTP Server!');
        });
        
        const PORT = 3000;
        server.listen(PORT, () => {
          console.log('Server running on port', PORT);
        });
        
        // Keep server running for 5 seconds then exit
        setTimeout(() => {
          console.log('Server shutting down');
          server.close();
          process.exit(0);
        }, 5000);
      `;
      
      await wcInstance!.fs.writeFile(`${serverDir}/server.js`, serverCode);
      createdFiles.push(`${serverDir}/server.js`);
      
      // Start server
      const process = await wcInstance!.spawn('node', ['server.js'], { cwd: serverDir });
      const output = await readStreamToString(process.output);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(0);
      expect(output).toContain('Server running');
      expect(output).toContain('3000');
    }, 15000); // 15 seconds for server to start and stop
  });

  describe('Error Handling', () => {
    it('should handle command that does not exist', async () => {
      expect(wcInstance).toBeTruthy();
      
      try {
        const process = await wcInstance!.spawn('nonexistent-command-xyz', []);
        await readStreamToString(process.output);
        await process.exit!;
        
        // Should not reach here
        expect.fail('Should have thrown error for nonexistent command');
      } catch (error: any) {
        expect(error).toBeDefined();
        expect(error.message).toContain('ENOENT');
      }
    });

    it('should handle command with non-zero exit code', async () => {
      expect(wcInstance).toBeTruthy();
      
      const process = await wcInstance!.spawn('node', ['-e', 'process.exit(42)']);
      const exitCode = await process.exit!;
      
      expect(exitCode).toBe(42);
    });
  });
});

// Helper function to read stream to string
async function readStreamToString(stream?: ReadableStream<Uint8Array>): Promise<string> {
  if (!stream) return '';
  
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) output += decoder.decode(value, { stream: true });
  }
  
  output += decoder.decode();
  return output;
}

// Export for browser console testing
if (typeof window !== 'undefined') {
  (window as any).testWebContainer = async () => {
    console.log('Running WebContainer tests...');
    // Tests will run via vitest
  };
}
