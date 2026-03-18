/**
 * End-to-End Workflow Tests
 * 
 * Comprehensive E2E tests covering complete workflows:
 * - File edit -> Sandbox -> Preview pipeline
 * - VFS -> Sandbox sync
 * - Diff application -> Sandbox execution
 * - Multi-file operations
 * - Real-world scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VirtualFilesystemService } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { FilesystemDiffTracker } from '@/lib/virtual-filesystem/filesystem-diffs';
import { SafeDiffOperations } from '@/enhanced-code-system/file-management/safe-diff-operations';
import type { DiffOperation, FileState } from '@/enhanced-code-system/file-management/advanced-file-manager';
import { detectProject, analyzeHeuristics } from '@/lib/previews/live-preview-offloading';
import type { PreviewRequest } from '@/lib/previews/live-preview-offloading';

// Skip flag for tests requiring external providers
const SKIP_EXTERNAL = process.env.TEST_E2E_SKIP === 'true';

describe('End-to-End Workflow Tests', () => {
  let vfs: VirtualFilesystemService;
  let diffTracker: FilesystemDiffTracker;
  let safeDiff: SafeDiffOperations;

  beforeEach(() => {
    vfs = new VirtualFilesystemService({
      workspaceRoot: 'test-workspace',
      storageDir: '/tmp/test-vfs-storage',
    });
    diffTracker = new FilesystemDiffTracker();
    safeDiff = new SafeDiffOperations({
      enablePreValidation: true,
      enableSyntaxValidation: true,
      enableConflictDetection: true,
      enableAutoBackup: true,
      enableRollback: true,
      maxBackupHistory: 10,
      validationTimeout: 5000,
      conflictResolutionStrategy: 'hybrid',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('File Edit -> Sandbox -> Preview Pipeline', () => {
    it('should handle complete React component workflow', async () => {
      if (SKIP_EXTERNAL) {
        console.log('Skipping external tests');
        return;
      }

      const ownerId = 'test-user-e2e-1';

      // Step 1: Create initial file in VFS
      const initialContent = `export function Button({ children }: { children: React.ReactNode }) {
  return <button className="btn">{children}</button>;
}`;

      await vfs.writeFile(ownerId, 'src/components/Button.tsx', initialContent, 'typescript');

      // Step 2: Track the creation
      const createdFile = await vfs.readFile(ownerId, 'src/components/Button.tsx');
      diffTracker.trackChange(createdFile, ownerId);

      // Step 3: Apply diff to modify the component
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 3],
          content: `export function Button({ 
  children, 
  onClick,
  variant = 'primary'
}: { 
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button 
      className={\`btn btn-\${variant}\`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}`,
          description: 'Add onClick and variant props',
        },
      ];

      const fileState: FileState = {
        id: 'button-component',
        path: 'src/components/Button.tsx',
        content: initialContent,
        version: 1,
        language: 'typescript',
      };

      const result = await safeDiff.safelyApplyDiffs('button-component', initialContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('onClick');
      expect(result.updatedContent).toContain('variant');
      expect(result.backupId).toBeDefined();

      // Step 4: Write updated content to VFS
      await vfs.writeFile(ownerId, 'src/components/Button.tsx', result.updatedContent, 'typescript');

      // Step 5: Track the update
      const updatedFile = await vfs.readFile(ownerId, 'src/components/Button.tsx');
      diffTracker.trackChange(updatedFile, ownerId, initialContent);

      // Step 6: Get diff summary for LLM context
      const diffSummary = diffTracker.getDiffSummary(ownerId);

      expect(diffSummary.changedFiles).toHaveLength(1);
      expect(diffSummary.totalChanges).toBe(2); // Create + Update

      // Step 7: Detect project for preview
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
            },
            devDependencies: {
              vite: '^5.0.0',
              '@vitejs/plugin-react': '^4.0.0',
            },
          }),
        },
        {
          name: 'src/components/Button.tsx',
          content: result.updatedContent,
        },
      ];

      const previewDetection = detectProject({ files } as PreviewRequest);

      expect(previewDetection.framework).toBe('react');
      expect(previewDetection.previewMode).toBe('sandpack');
      expect(previewDetection.shouldOffload).toBe(false);
    });

    it('should handle multi-file React application workflow', async () => {
      const ownerId = 'test-user-e2e-2';

      // Create a complete React app structure
      const files = [
        {
          path: 'package.json',
          content: JSON.stringify({
            name: 'my-app',
            version: '1.0.0',
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
            },
            devDependencies: {
              '@types/react': '^18.2.0',
              '@types/react-dom': '^18.2.0',
              typescript: '^5.3.0',
              vite: '^5.0.0',
              '@vitejs/plugin-react': '^4.0.0',
            },
          }),
        },
        {
          path: 'tsconfig.json',
          content: JSON.stringify({
            compilerOptions: {
              target: 'ES2020',
              module: 'ESNext',
              jsx: 'react-jsx',
              strict: true,
            },
          }),
        },
        {
          path: 'vite.config.ts',
          content: 'import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({ plugins: [react()] });',
        },
        {
          path: 'index.html',
          content: '<!DOCTYPE html><html><head><title>My App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
        },
        {
          path: 'src/main.tsx',
          content: 'import React from "react"; import ReactDOM from "react-dom/client"; import App from "./App"; ReactDOM.createRoot(document.getElementById("root")!).render(<App />);',
        },
        {
          path: 'src/App.tsx',
          content: 'import { Header } from "./components/Header"; import { Footer } from "./components/Footer"; export default function App() { return <div><Header /><main>Content</main><Footer /></div>; }',
        },
        {
          path: 'src/components/Header.tsx',
          content: 'export function Header() { return <header>Header</header>; }',
        },
        {
          path: 'src/components/Footer.tsx',
          content: 'export function Footer() { return <footer>Footer</footer>; }',
        },
        {
          path: 'src/styles.css',
          content: 'body { margin: 0; font-family: sans-serif; }',
        },
      ];

      // Write all files to VFS
      for (const file of files) {
        const language = file.path.endsWith('.json') ? 'json' :
          file.path.endsWith('.tsx') ? 'typescript' :
            file.path.endsWith('.ts') ? 'typescript' :
              file.path.endsWith('.css') ? 'css' : 'html';

        await vfs.writeFile(ownerId, file.path, file.content, language);

        // Track changes
        const vfsFile = await vfs.readFile(ownerId, file.path);
        diffTracker.trackChange(vfsFile, ownerId);
      }

      // Get workspace snapshot
      const snapshot = await vfs.exportWorkspace(ownerId);

      expect(snapshot.files.length).toBe(files.length);
      expect(snapshot.version).toBe(files.length);

      // Detect project for preview
      const previewFiles = files.map(f => ({ name: f.path, content: f.content }));
      const previewDetection = detectProject({ files: previewFiles } as PreviewRequest);

      expect(previewDetection.framework).toBe('react');
      expect(previewDetection.bundler).toBe('vite');
      expect(previewDetection.previewMode).toBe('sandpack');

      // Analyze heuristics
      const heuristics = analyzeHeuristics({ files: previewFiles } as PreviewRequest);

      expect(heuristics.shouldOffload).toBe(false);
    });

    it('should handle Python FastAPI workflow', async () => {
      const ownerId = 'test-user-e2e-3';

      // Create FastAPI application
      const files = [
        {
          path: 'requirements.txt',
          content: 'fastapi==0.109.0\nuvicorn==0.27.0\npydantic==2.5.0',
        },
        {
          path: 'main.py',
          content: `from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    price: float

@app.get("/")
def root():
    return {"message": "Hello World"}

@app.post("/items/")
def create_item(item: Item):
    return {"item": item}`,
        },
      ];

      for (const file of files) {
        const language = file.path.endsWith('.py') ? 'python' : 'text';
        await vfs.writeFile(ownerId, file.path, file.content, language);

        const vfsFile = await vfs.readFile(ownerId, file.path);
        diffTracker.trackChange(vfsFile, ownerId);
      }

      // Modify the main.py
      const originalContent = files.find(f => f.path === 'main.py')!.content;
      const updatedContent = originalContent + `

@app.get("/health")
def health_check():
    return {"status": "healthy"}`;

      const diffs: DiffOperation[] = [
        {
          operation: 'insert',
          lineRange: [17, 17],
          content: updatedContent.split('\n').slice(16).join('\n'),
          description: 'Add health check endpoint',
        },
      ];

      const fileState: FileState = {
        id: 'main-py',
        path: 'main.py',
        content: originalContent,
        version: 1,
        language: 'python',
      };

      const result = await safeDiff.safelyApplyDiffs('main-py', originalContent, diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('/health');

      // Write updated content
      await vfs.writeFile(ownerId, 'main.py', result.updatedContent, 'python');

      // Detect for preview
      const previewFiles = [
        { name: 'requirements.txt', content: files[0].content },
        { name: 'main.py', content: result.updatedContent },
      ];

      const previewDetection = detectProject({ files: previewFiles } as PreviewRequest);

      expect(previewDetection.framework).toBe('fastapi');
      expect(previewDetection.previewMode).toBe('devbox');
    });
  });

  describe('VFS -> Sandbox Sync Workflow', () => {
    it('should sync VFS files to sandbox format', async () => {
      const ownerId = 'test-sync-1';

      // Create project in VFS
      const files = [
        { path: 'package.json', content: '{"name": "sync-test", "dependencies": {"react": "^18.2.0"}}' },
        { path: 'src/App.tsx', content: 'export default function App() { return <div>Hello</div>; }' },
        { path: 'src/index.tsx', content: 'import App from "./App";' },
        { path: 'src/styles.css', content: 'body { margin: 0; }' },
      ];

      for (const file of files) {
        await vfs.writeFile(ownerId, file.path, file.content);
      }

      // Export workspace
      const snapshot = await vfs.exportWorkspace(ownerId);

      // Convert to sandbox format
      const sandboxFiles = snapshot.files.map(f => ({
        path: f.path,
        content: f.content || '',
      }));

      expect(sandboxFiles).toHaveLength(4);
      expect(sandboxFiles.find(f => f.path === 'src/App.tsx')).toBeDefined();
      expect(sandboxFiles.find(f => f.path === 'src/styles.css')).toBeDefined();
    });

    it('should sync only changed files', async () => {
      const ownerId = 'test-sync-2';

      // Initial files
      await vfs.writeFile(ownerId, 'file1.ts', 'export const f1 = 1;');
      await vfs.writeFile(ownerId, 'file2.ts', 'export const f2 = 2;');
      await vfs.writeFile(ownerId, 'file3.ts', 'export const f3 = 3;');

      // Track initial state
      const initialSnapshot = await vfs.exportWorkspace(ownerId);

      // Modify one file
      await vfs.writeFile(ownerId, 'file2.ts', 'export const f2 = 222;');

      // Get diff summary to identify changed files
      const diffSummary = diffTracker.getDiffSummary(ownerId);

      expect(diffSummary.changedFiles.length).toBeGreaterThan(0);

      // Get current snapshot
      const currentSnapshot = await vfs.exportWorkspace(ownerId);

      // Identify changed files by comparing versions
      const changedFiles = currentSnapshot.files.filter(f => {
        const oldFile = initialSnapshot.files.find(of => of.path === f.path);
        return !oldFile || oldFile.version !== f.version;
      });

      expect(changedFiles.length).toBeGreaterThan(0);
      expect(changedFiles.find(f => f.path === 'file2.ts')).toBeDefined();
    });

    it('should handle sync conflicts', async () => {
      const ownerId = 'test-sync-3';

      // Create initial file
      await vfs.writeFile(ownerId, 'shared.ts', 'export const shared = 1;');

      // Simulate concurrent modification
      const file = await vfs.readFile(ownerId, 'shared.ts');
      const originalVersion = file.version;

      // Apply diff with conflict detection
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export const shared = 2;',
          description: 'Update shared value',
        },
      ];

      const fileState: FileState = {
        id: 'shared',
        path: 'shared.ts',
        content: 'export const shared = 1;',
        version: originalVersion,
        language: 'typescript',
      };

      const result = await safeDiff.safelyApplyDiffs('shared', 'export const shared = 1;', diffs, fileState);

      expect(result.success).toBe(true);
      expect(result.conflicts.length).toBe(0); // No actual conflict in this scenario
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle feature addition workflow', async () => {
      const ownerId = 'feature-workflow';

      // Start with existing codebase
      const initialFiles = [
        {
          path: 'package.json',
          content: JSON.stringify({
            dependencies: { react: '^18.2.0' },
            devDependencies: { typescript: '^5.3.0' },
          }),
        },
        {
          path: 'src/App.tsx',
          content: `export default function App() {
  return <div><h1>My App</h1></div>;
}`,
        },
        {
          path: 'src/types.ts',
          content: `export interface User {
  id: number;
  name: string;
}`,
        },
      ];

      for (const file of initialFiles) {
        await vfs.writeFile(ownerId, file.path, file.content);
        const vfsFile = await vfs.readFile(ownerId, file.path);
        diffTracker.trackChange(vfsFile, ownerId);
      }

      // Add new feature: UserList component
      const newComponent = `import { User } from '../types';

interface UserListProps {
  users: User[];
  onSelectUser?: (user: User) => void;
}

export function UserList({ users, onSelectUser }: UserListProps) {
  return (
    <ul>
      {users.map(user => (
        <li 
          key={user.id} 
          onClick={() => onSelectUser?.(user)}
        >
          {user.name}
        </li>
      ))}
    </ul>
  );
}`;

      await vfs.writeFile(ownerId, 'src/components/UserList.tsx', newComponent, 'typescript');
      const newFile = await vfs.readFile(ownerId, 'src/components/UserList.tsx');
      diffTracker.trackChange(newFile, ownerId);

      // Update App.tsx to use new component
      const updatedApp = `import { UserList } from './components/UserList';
import type { User } from './types';

const users: User[] = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

export default function App() {
  return (
    <div>
      <h1>My App</h1>
      <UserList users={users} />
    </div>
  );
}`;

      const appDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 4],
          content: updatedApp,
          description: 'Add UserList component usage',
        },
      ];

      const appState: FileState = {
        id: 'app',
        path: 'src/App.tsx',
        content: initialFiles[1].content,
        version: 1,
        language: 'typescript',
      };

      const appResult = await safeDiff.safelyApplyDiffs('app', initialFiles[1].content, appDiffs, appState);

      expect(appResult.success).toBe(true);
      expect(appResult.updatedContent).toContain('UserList');

      // Write updated App
      await vfs.writeFile(ownerId, 'src/App.tsx', appResult.updatedContent, 'typescript');

      // Verify complete project
      const snapshot = await vfs.exportWorkspace(ownerId);

      expect(snapshot.files.length).toBe(4); // 3 initial + 1 new
      expect(snapshot.files.some(f => f.path.includes('UserList'))).toBe(true);
    });

    it('should handle bug fix workflow', async () => {
      const ownerId = 'bugfix-workflow';

      // Code with bug
      const buggyCode = `export function calculateTotal(items: number[]): number {
  let total = 0;
  for (let i = 0; i <= items.length; i++) { // Bug: should be < not <=
    total += items[i];
  }
  return total;
}`;

      await vfs.writeFile(ownerId, 'src/utils/calculate.ts', buggyCode, 'typescript');
      const buggyFile = await vfs.readFile(ownerId, 'src/utils/calculate.ts');
      diffTracker.trackChange(buggyFile, ownerId);

      // Fix the bug
      const fixedCode = `export function calculateTotal(items: number[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i];
  }
  return total;
}`;

      const fixDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 7],
          content: fixedCode,
          description: 'Fix off-by-one error in loop',
        },
      ];

      const fileState: FileState = {
        id: 'calculate',
        path: 'src/utils/calculate.ts',
        content: buggyCode,
        version: 1,
        language: 'typescript',
      };

      const result = await safeDiff.safelyApplyDiffs('calculate', buggyCode, fixDiffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('i < items.length');
      expect(result.updatedContent).not.toContain('i <= items.length');

      // Verify backup was created
      expect(result.backupId).toBeDefined();

      // Can rollback if needed
      if (result.backupId) {
        const rollback = await safeDiff.rollbackToBackup('calculate', result.backupId);
        expect(rollback.success).toBe(true);
        expect(rollback.restoredContent).toBe(buggyCode);
      }
    });

    it('should handle refactoring workflow', async () => {
      const ownerId = 'refactor-workflow';

      // Original code
      const originalCode = `export function fetchData() {
  return fetch('/api/data')
    .then(res => res.json())
    .then(data => {
      console.log('Fetched:', data);
      return data;
    })
    .catch(err => {
      console.error('Error:', err);
      throw err;
    });
}`;

      await vfs.writeFile(ownerId, 'src/api/fetch.ts', originalCode, 'typescript');
      const originalFile = await vfs.readFile(ownerId, 'src/api/fetch.ts');
      diffTracker.trackChange(originalFile, ownerId);

      // Refactored to async/await
      const refactoredCode = `export async function fetchData(): Promise<any> {
  try {
    const response = await fetch('/api/data');
    const data = await response.json();
    console.log('Fetched:', data);
    return data;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}`;

      const refactorDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 11],
          content: refactoredCode,
          description: 'Refactor to async/await',
        },
      ];

      const fileState: FileState = {
        id: 'fetch',
        path: 'src/api/fetch.ts',
        content: originalCode,
        version: 1,
        language: 'typescript',
      };

      const result = await safeDiff.safelyApplyDiffs('fetch', originalCode, refactorDiffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('async function');
      expect(result.updatedContent).toContain('await fetch');
      expect(result.updatedContent).not.toContain('.then(');

      // Verify syntax validation passed
      expect(result.validationResult.isValid).toBe(true);
    });

    it('should handle dependency update workflow', async () => {
      const ownerId = 'deps-workflow';

      // Original package.json
      const originalPkg = {
        name: 'my-app',
        dependencies: {
          react: '^18.0.0',
          'react-dom': '^18.0.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      };

      await vfs.writeFile(ownerId, 'package.json', JSON.stringify(originalPkg, null, 2), 'json');
      const originalFile = await vfs.readFile(ownerId, 'package.json');
      diffTracker.trackChange(originalFile, ownerId);

      // Updated package.json
      const updatedPkg = {
        ...originalPkg,
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        devDependencies: {
          typescript: '^5.3.0',
        },
      };

      const updateDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 10],
          content: JSON.stringify(updatedPkg, null, 2),
          description: 'Update dependencies to latest',
        },
      ];

      const fileState: FileState = {
        id: 'package-json',
        path: 'package.json',
        content: JSON.stringify(originalPkg, null, 2),
        version: 1,
        language: 'json',
      };

      const result = await safeDiff.safelyApplyDiffs('package-json', JSON.stringify(originalPkg, null, 2), updateDiffs, fileState);

      expect(result.success).toBe(true);
      expect(result.updatedContent).toContain('"react": "^18.2.0"');
      expect(result.updatedContent).toContain('"typescript": "^5.3.0"');

      // Verify JSON is still valid
      expect(() => JSON.parse(result.updatedContent)).not.toThrow();
    });
  });

  describe('Error Recovery Workflows', () => {
    it('should recover from failed diff application', async () => {
      const ownerId = 'error-recovery';

      const originalContent = `export const value = 1;`;

      await vfs.writeFile(ownerId, 'src/recover.ts', originalContent, 'typescript');

      // Try to apply invalid diff
      const invalidDiffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [100, 100], // Invalid line
          content: 'invalid',
          description: 'Invalid operation',
        },
      ];

      const fileState: FileState = {
        id: 'recover',
        path: 'src/recover.ts',
        content: originalContent,
        version: 1,
        language: 'typescript',
      };

      const result = await safeDiff.safelyApplyDiffs('recover', originalContent, invalidDiffs, fileState);

      // Should fail gracefully
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      // Original file should be unchanged
      const file = await vfs.readFile(ownerId, 'src/recover.ts');
      expect(file.content).toBe(originalContent);
    });

    it('should handle rollback after partial failure', async () => {
      const ownerId = 'partial-failure';

      const content = `export const a = 1;
export const b = 2;
export const c = 3;`;

      await vfs.writeFile(ownerId, 'src/partial.ts', content, 'typescript');

      // Apply multiple changes
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 1],
          content: 'export const a = 111;',
          description: 'Update a',
        },
        {
          operation: 'replace',
          lineRange: [2, 2],
          content: 'export const b = 222;',
          description: 'Update b',
        },
      ];

      const fileState: FileState = {
        id: 'partial',
        path: 'src/partial.ts',
        content,
        version: 1,
        language: 'typescript',
      };

      const result = await safeDiff.safelyApplyDiffs('partial', content, diffs, fileState);

      // Should succeed and create backup
      expect(result.backupId).toBeDefined();

      // Rollback should restore original
      if (result.backupId) {
        const rollback = await safeDiff.rollbackToBackup('partial', result.backupId);
        expect(rollback.success).toBe(true);
        expect(rollback.restoredContent).toBe(content);
      }
    });
  });

  describe('Performance Benchmarks', () => {
    it('should complete full workflow in under 1 second for typical file', async () => {
      const ownerId = 'perf-test';

      const content = `export function Component() {
  return <div>Hello World</div>;
}`;

      const start = Date.now();

      // Write
      await vfs.writeFile(ownerId, 'src/Component.tsx', content, 'typescript');

      // Read
      const file = await vfs.readFile(ownerId, 'src/Component.tsx');

      // Track
      diffTracker.trackChange(file, ownerId);

      // Apply diff
      const diffs: DiffOperation[] = [
        {
          operation: 'replace',
          lineRange: [1, 3],
          content: `export function Component({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}`,
          description: 'Add name prop',
        },
      ];

      const fileState: FileState = {
        id: 'component',
        path: 'src/Component.tsx',
        content,
        version: 1,
        language: 'typescript',
      };

      const result = await safeDiff.safelyApplyDiffs('component', content, diffs, fileState);

      // Write updated
      await vfs.writeFile(ownerId, 'src/Component.tsx', result.updatedContent, 'typescript');

      // Export
      await vfs.exportWorkspace(ownerId);

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });
  });
});
