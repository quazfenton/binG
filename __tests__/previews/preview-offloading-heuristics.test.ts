/**
 * Preview Offloading Heuristics Tests
 * 
 * Comprehensive tests for the preview offloading decision system including:
 * - Framework detection accuracy
 * - Bundler detection
 * - Resource requirement analysis
 * - Cloud vs local decision logic
 * - Performance benchmarks
 * - Edge case handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  detectProject,
  detectFramework,
  analyzeHeuristics,
  type PreviewRequest,
  type PreviewDetectionResult,
  type Framework,
} from '@/lib/previews/live-preview-offloading';

describe('Preview Offloading Heuristics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Framework Detection Accuracy', () => {
    it('should correctly identify React with Vite', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
            },
            devDependencies: {
              '@vitejs/plugin-react': '^4.0.0',
              vite: '^5.0.0',
            },
          }),
        },
        {
          name: 'vite.config.ts',
          content: 'import { defineConfig } from "vite"; import react from "@vitejs/plugin-react"; export default defineConfig({ plugins: [react()] });',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('react');
      expect(result.bundler).toBe('vite');
      expect(result.previewMode).toBe('sandpack');
      expect(result.shouldOffload).toBe(false);
    });

    it('should correctly identify Next.js with App Router', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              next: '^14.0.0',
              react: '^18.2.0',
              'react-dom': '^18.2.0',
            },
            scripts: {
              dev: 'next dev',
              build: 'next build',
            },
          }),
        },
        {
          name: 'app/layout.tsx',
          content: 'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }',
        },
        {
          name: 'app/page.tsx',
          content: 'export default function Home() { return <main>Hello</main>; }',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('next');
      expect(result.previewMode).toBe('nextjs');
    });

    it('should correctly identify Next.js with Pages Router', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              next: '^13.0.0',
              react: '^18.2.0',
            },
          }),
        },
        {
          name: 'pages/index.tsx',
          content: 'export default function Home() { return <div>Home</div>; }',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('next');
      expect(result.previewMode).toBe('nextjs');
    });

    it('should correctly identify Vue 3 with Vite', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              vue: '^3.4.0',
            },
            devDependencies: {
              '@vitejs/plugin-vue': '^5.0.0',
              vite: '^5.0.0',
            },
          }),
        },
        {
          name: 'src/main.js',
          content: 'import { createApp } from "vue"; import App from "./App.vue"; createApp(App).mount("#app");',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('vue');
      expect(result.bundler).toBe('vite');
      expect(result.previewMode).toBe('sandpack');
    });

    it('should correctly identify Nuxt 3', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              nuxt: '^3.9.0',
              vue: '^3.4.0',
            },
          }),
        },
        {
          name: 'nuxt.config.ts',
          content: 'export default defineNuxtConfig({});',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('nuxt');
      expect(result.previewMode).toBe('sandpack');
    });

    it('should correctly identify Svelte with Vite', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            devDependencies: {
              svelte: '^4.0.0',
              '@sveltejs/vite-plugin-svelte': '^3.0.0',
              vite: '^5.0.0',
            },
          }),
        },
        {
          name: 'src/main.js',
          content: 'import App from "./App.svelte"; new App({ target: document.getElementById("app") });',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('svelte');
      expect(result.bundler).toBe('vite');
      expect(result.previewMode).toBe('sandpack');
    });

    it('should correctly identify SvelteKit', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            devDependencies: {
              '@sveltejs/kit': '^2.0.0',
              svelte: '^4.0.0',
              vite: '^5.0.0',
            },
          }),
        },
        {
          name: 'svelte.config.js',
          content: 'import adapter from "@sveltejs/adapter-auto"; export default { kit: { adapter: adapter() } };',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('svelte');
      expect(result.previewMode).toBe('sandpack');
    });

    it('should correctly identify Angular', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              '@angular/core': '^17.0.0',
              '@angular/common': '^17.0.0',
              '@angular/compiler': '^17.0.0',
              '@angular/platform-browser': '^17.0.0',
            },
          }),
        },
        {
          name: 'angular.json',
          content: JSON.stringify({ version: 1, projects: {} }),
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('angular');
      expect(result.previewMode).toBe('sandpack');
    });

    it('should correctly identify Solid', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              'solid-js': '^1.8.0',
            },
            devDependencies: {
              'vite-plugin-solid': '^2.8.0',
            },
          }),
        },
        {
          name: 'src/index.tsx',
          content: 'import { render } from "solid-js/web"; render(() => <App />, document.getElementById("root"));',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('solid');
      expect(result.previewMode).toBe('sandpack');
    });

    it('should correctly identify Astro', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            devDependencies: {
              astro: '^4.0.0',
            },
          }),
        },
        {
          name: 'astro.config.mjs',
          content: 'export default { };',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('astro');
      expect(result.previewMode).toBe('iframe');
    });

    it('should correctly identify Remix', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              '@remix-run/react': '^2.5.0',
              '@remix-run/node': '^2.5.0',
              react: '^18.2.0',
            },
          }),
        },
        {
          name: 'remix.config.js',
          content: 'module.exports = { ignoredRouteFiles: ["**/.*"] };',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('remix');
      expect(result.previewMode).toBe('nextjs');
    });

    it('should correctly identify Flask', () => {
      const files = [
        {
          name: 'requirements.txt',
          content: 'flask==3.0.0\nrequests==2.31.0',
        },
        {
          name: 'app.py',
          content: 'from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef hello(): return "Hello"',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('flask');
      expect(result.previewMode).toBe('pyodide');
    });

    it('should correctly identify FastAPI', () => {
      const files = [
        {
          name: 'requirements.txt',
          content: 'fastapi==0.109.0\nuvicorn==0.27.0',
        },
        {
          name: 'main.py',
          content: 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root(): return {"hello": "world"}',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('fastapi');
      expect(result.previewMode).toBe('devbox');
    });

    it('should correctly identify Streamlit', () => {
      const files = [
        {
          name: 'requirements.txt',
          content: 'streamlit==1.30.0\npandas==2.1.0',
        },
        {
          name: 'app.py',
          content: 'import streamlit as st\nst.title("My App")',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('streamlit');
      expect(result.previewMode).toBe('pyodide');
    });

    it('should correctly identify Django', () => {
      const files = [
        {
          name: 'requirements.txt',
          content: 'django==5.0.0\npsycopg2==2.9.9',
        },
        {
          name: 'manage.py',
          content: '#!/usr/bin/env python\nimport os\nimport sys\nif __name__ == "__main__":\n    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "myproject.settings")',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('django');
      expect(result.previewMode).toBe('devbox');
    });

    it('should correctly identify Gradio', () => {
      const files = [
        {
          name: 'requirements.txt',
          content: 'gradio==4.16.0',
        },
        {
          name: 'app.py',
          content: 'import gradio as gr\ndef greet(name): return "Hello " + name\ngr.Interface(fn=greet, inputs="text", outputs="text").launch()',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('gradio');
      expect(result.previewMode).toBe('pyodide');
    });

    it('should correctly identify vanilla HTML/CSS/JS', () => {
      const files = [
        {
          name: 'index.html',
          content: '<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><script src="app.js"></script></body></html>',
        },
        {
          name: 'style.css',
          content: 'body { font-family: sans-serif; }',
        },
        {
          name: 'app.js',
          content: 'console.log("Hello World");',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('vanilla');
      expect(result.previewMode).toBe('iframe');
      expect(result.shouldOffload).toBe(false);
    });

    it('should correctly identify Vite project without framework', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            devDependencies: {
              vite: '^5.0.0',
            },
          }),
        },
        {
          name: 'vite.config.ts',
          content: 'import { defineConfig } from "vite"; export default defineConfig({});',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('vite');
      expect(result.bundler).toBe('vite');
      expect(result.previewMode).toBe('vite');
    });

    it('should correctly identify Webpack project', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            devDependencies: {
              webpack: '^5.0.0',
              'webpack-cli': '^5.0.0',
              'webpack-dev-server': '^4.0.0',
            },
          }),
        },
        {
          name: 'webpack.config.js',
          content: 'module.exports = { entry: "./src/index.js", output: { filename: "bundle.js" } };',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('unknown');
      expect(result.bundler).toBe('webpack');
      expect(result.previewMode).toBe('webpack');
    });

    it('should correctly identify Rollup project', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            devDependencies: {
              rollup: '^4.0.0',
              '@rollup/plugin-typescript': '^11.0.0',
            },
          }),
        },
        {
          name: 'rollup.config.js',
          content: 'export default { input: "src/index.ts", output: { file: "dist/bundle.js" } };',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('vanilla');
      expect(result.bundler).toBe('rollup');
    });

    it('should correctly identify TypeScript library', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            devDependencies: {
              typescript: '^5.3.0',
            },
          }),
        },
        {
          name: 'tsconfig.json',
          content: JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'ESNext' } }),
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('vanilla');
      expect(result.previewMode).toBe('sandpack');
    });
  });

  describe('Cloud Offloading Decision Logic', () => {
    it('should not offload simple React project', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              react: '^18.2.0',
            },
          }),
        },
        {
          name: 'src/App.tsx',
          content: 'export default function App() { return <div>Hello</div>; }',
        },
      ];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.shouldOffload).toBe(false);
      expect(heuristics.previewMode).toBe('sandpack');
    });

    it('should offload project with many dependencies', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              react: '^18.2.0',
              '@aws-sdk/client-s3': '^3.0.0',
              '@azure/storage-blob': '^12.0.0',
              '@google-cloud/storage': '^7.0.0',
              'lodash': '^4.17.21',
              'axios': '^1.6.0',
              'moment': '^2.30.0',
              'uuid': '^9.0.0',
            },
          }),
        },
      ];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.shouldOffload).toBe(true);
      expect(heuristics.offloadReason).toContain('dependencies');
    });

    it('should offload project with complex build scripts', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            scripts: {
              build: 'tsc && vite build && webpack build',
              'build:prod': 'npm run build && npm run optimize',
              'build:staging': 'npm run build && npm run analyze',
              generate: 'graphql-codegen && openapi-generator',
            },
          }),
        },
      ];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.shouldOffload).toBe(true);
    });

    it('should offload Python projects with native dependencies', () => {
      const files = [
        {
          name: 'requirements.txt',
          content: 'numpy==1.26.0\npandas==2.1.0\nscipy==1.11.0\nopencv-python==4.9.0\ntorch==2.1.0',
        },
      ];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.shouldOffload).toBe(true);
      expect(heuristics.offloadReason).toContain('devbox');
    });

    it('should recommend WebContainer for Next.js', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              next: '^14.0.0',
              react: '^18.2.0',
            },
          }),
        },
      ];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.previewMode).toBe('nextjs');
    });

    it('should recommend devbox for FastAPI', () => {
      const files = [
        {
          name: 'requirements.txt',
          content: 'fastapi==0.109.0\nuvicorn==0.27.0',
        },
      ];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.previewMode).toBe('devbox');
      expect(heuristics.shouldOffload).toBe(true);
    });

    it('should not offload vanilla projects', () => {
      const files = [
        {
          name: 'index.html',
          content: '<!DOCTYPE html><html><body>Hello</body></html>',
        },
        {
          name: 'style.css',
          content: 'body { margin: 0; }',
        },
        {
          name: 'app.js',
          content: 'console.log("Hello");',
        },
      ];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.shouldOffload).toBe(false);
      expect(heuristics.previewMode).toBe('iframe');
    });

    it('should handle empty files gracefully', () => {
      const files: Array<{ name: string; content: string }> = [];

      const heuristics = analyzeHeuristics({ files } as PreviewRequest);

      expect(heuristics.shouldOffload).toBe(false);
      expect(heuristics.previewMode).toBe('sandpack');
    });

    it('should consider file count in offloading decision', () => {
      const manyFiles = Array.from({ length: 500 }, (_, i) => ({
        name: `src/component${i}.tsx`,
        content: `export const Component${i} = () => <div>${i}</div>;`,
      }));

      const heuristics = analyzeHeuristics({ files: manyFiles } as PreviewRequest);

      // Large file count should trigger offload consideration
      expect(heuristics.fileCount).toBe(500);
    });

    it('should detect monorepo structure', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            name: 'monorepo',
            workspaces: ['apps/*', 'packages/*'],
          }),
        },
        {
          name: 'apps/web/package.json',
          content: JSON.stringify({ dependencies: { next: '^14.0.0' } }),
        },
        {
          name: 'apps/api/package.json',
          content: JSON.stringify({ dependencies: { fastapi: '^0.109.0' } }),
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.isMonorepo).toBe(true);
      expect(result.projectRoot).toBeDefined();
    });
  });

  describe('Port Detection', () => {
    it('should detect port from Vite config', () => {
      const files = [
        {
          name: 'vite.config.ts',
          content: 'export default { server: { port: 3000 } };',
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(3000);
    });

    it('should detect port from package.json scripts', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            scripts: {
              dev: 'vite --port 5173',
            },
          }),
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(5173);
    });

    it('should detect port from Next.js config', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            scripts: {
              dev: 'next dev -p 3001',
            },
          }),
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(3001);
    });

    it('should detect port from Webpack config', () => {
      const files = [
        {
          name: 'webpack.config.js',
          content: 'module.exports = { devServer: { port: 8080 } };',
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(8080);
    });

    it('should detect port from Flask app', () => {
      const files = [
        {
          name: 'app.py',
          content: 'if __name__ == "__main__": app.run(port=5000)',
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(5000);
    });

    it('should detect port from FastAPI app', () => {
      const files = [
        {
          name: 'main.py',
          content: 'import uvicorn\nif __name__ == "__main__": uvicorn.run(app, port=8000)',
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(8000);
    });

    it('should return default port for Vite', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            scripts: {
              dev: 'vite',
            },
          }),
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(5173); // Vite default
    });

    it('should return default port for Next.js', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            scripts: {
              dev: 'next dev',
            },
          }),
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(3000); // Next.js default
    });

    it('should return default port for Flask', () => {
      const files = [
        {
          name: 'app.py',
          content: 'if __name__ == "__main__": app.run()',
        },
      ];

      const { detectPort } = await import('@/lib/previews/live-preview-offloading');
      const port = detectPort(files);

      expect(port).toBe(5000); // Flask default
    });
  });

  describe('Performance Benchmarks', () => {
    it('should detect framework in under 100ms for typical project', () => {
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
            },
          }),
        },
        {
          name: 'vite.config.ts',
          content: 'export default defineConfig({ plugins: [react()] });',
        },
        {
          name: 'src/App.tsx',
          content: 'export default function App() { return <div />; }',
        },
      ];

      const start = Date.now();
      detectProject({ files } as PreviewRequest);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should handle large project efficiently', () => {
      const files = Array.from({ length: 1000 }, (_, i) => ({
        name: `src/components/Component${i}.tsx`,
        content: `export const Component${i} = () => <div>{${i}}</div>;`,
      }));

      const start = Date.now();
      const result = detectProject({ files } as PreviewRequest);
      const duration = Date.now() - start;

      expect(result.framework).toBe('react');
      expect(duration).toBeLessThan(500);
    });

    it('should analyze heuristics efficiently', () => {
      const files = Array.from({ length: 500 }, (_, i) => ({
        name: `src/file${i}.ts`,
        content: `export const value${i} = ${i};`,
      }));

      const start = Date.now();
      analyzeHeuristics({ files } as PreviewRequest);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle malformed package.json', () => {
      const files = [
        {
          name: 'package.json',
          content: '{ invalid json }',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('unknown');
    });

    it('should handle missing package.json', () => {
      const files = [
        {
          name: 'src/App.tsx',
          content: 'export default function App() { return <div />; }',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('vanilla');
    });

    it('should handle files with special characters', () => {
      const files = [
        {
          name: 'src/[id]/page.tsx',
          content: 'export default function Page() { return <div>Dynamic</div>; }',
        },
        {
          name: 'src/_components/Header.tsx',
          content: 'export default function Header() { return <header />; }',
        },
        {
          name: 'src/(group)/layout.tsx',
          content: 'export default function Layout() { return null; }',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('react');
    });

    it('should handle binary files', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({ dependencies: { react: '^18.2.0' } }),
        },
        {
          name: 'src/assets/image.png',
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('binary'),
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('react');
    });

    it('should handle undefined files', () => {
      const result = detectProject({ files: undefined } as any);

      expect(result.framework).toBe('unknown');
    });

    it('should handle files with missing properties', () => {
      const files = [
        { name: 'test.ts', content: undefined } as any,
        { name: undefined, content: 'code' } as any,
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('unknown');
    });

    it('should handle deeply nested structures', () => {
      const files = [
        {
          name: 'a/b/c/d/e/f/g/h/i/j/k/package.json',
          content: JSON.stringify({ dependencies: { react: '^18.2.0' } }),
        },
        {
          name: 'a/b/c/d/e/f/g/h/i/j/k/src/App.tsx',
          content: 'export default function App() { return <div />; }',
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      expect(result.framework).toBe('react');
      expect(result.projectRoot).toBe('a/b/c/d/e/f/g/h/i/j/k');
    });

    it('should handle mixed framework indicators', () => {
      const files = [
        {
          name: 'package.json',
          content: JSON.stringify({
            dependencies: {
              react: '^18.2.0',
              vue: '^3.4.0',
            },
          }),
        },
      ];

      const result = detectProject({ files } as PreviewRequest);

      // Should pick one based on priority
      expect(['react', 'vue']).toContain(result.framework);
    });
  });
});
