/**
 * Live Preview Offloading - Direct Function Tests
 * Tests the core preview detection and offloading logic directly
 * This bypasses external service dependencies (OpenSandbox, Daytona, CodeSandbox)
 */

import { 
  detectProject, 
  detectFramework, 
  detectEntryPoint, 
  detectPort,
  getCodeSandboxTemplate,
  getSandpackConfig,
  analyzeHeuristics,
  isBackendOnlyProject,
  livePreviewOffloading,
  type PreviewMode,
  type AppFramework,
  type PreviewRequest
} from './lib/previews/live-preview-offloading';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function runTests() {
  console.log('=== Testing Live Preview Offloading Functions ===\n');
  let passed = 0;
  let failed = 0;

  // Test 1: Framework Detection - React
  {
    console.log('Test 1: React Framework Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
          devDependencies: { vite: '^5.0.0' }
        }),
        'src/main.tsx': 'import React from "react";',
        'src/App.tsx': 'export default function App() { return <div>Hello</div>; }'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'react', `Expected 'react', got '${result.framework}'`);
      assert(result.previewMode === 'sandpack', `Expected 'sandpack', got '${result.previewMode}'`);
      console.log('  ✓ React detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 2: Framework Detection - Next.js
  {
    console.log('Test 2: Next.js Framework Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { next: '^14.0.0', react: '^18.2.0' },
          scripts: { dev: 'next dev' }
        }),
        'next.config.js': 'module.exports = {}',
        'app/page.tsx': 'export default function Home() { return <main>Hello</main>; }'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'next', `Expected 'next', got '${result.framework}'`);
      assert(result.previewMode === 'nextjs', `Expected 'nextjs', got '${result.previewMode}'`);
      console.log('  ✓ Next.js detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 3: Framework Detection - Vue
  {
    console.log('Test 3: Vue Framework Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { vue: '^3.4.0' },
          devDependencies: { vite: '^5.0.0', '@vitejs/plugin-vue': '^5.0.0' }
        }),
        'src/main.js': 'import { createApp } from "vue";',
        'src/App.vue': '<template><div>Hello Vue</div></template>'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'vue', `Expected 'vue', got '${result.framework}'`);
      console.log('  ✓ Vue detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 4: Framework Detection - Flask
  {
    console.log('Test 4: Flask Framework Detection');
    try {
      const files = {
        'requirements.txt': 'flask==3.0.0',
        'app.py': 'from flask import Flask\napp = Flask(__name__)\n@app.route("/")\ndef hello():\n    return "Hello"'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'flask', `Expected 'flask', got '${result.framework}'`);
      assert(result.previewMode === 'pyodide', `Expected 'pyodide', got '${result.previewMode}'`);
      console.log('  ✓ Flask detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 5: Framework Detection - FastAPI (should use devbox for cloud)
  {
    console.log('Test 5: FastAPI Framework Detection');
    try {
      const files = {
        'requirements.txt': 'fastapi==0.109.0',
        'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/")\ndef root():\n    return {"hello": "world"}'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'fastapi', `Expected 'fastapi', got '${result.framework}'`);
      assert(result.previewMode === 'devbox', `Expected 'devbox', got '${result.previewMode}'`);
      console.log('  ✓ FastAPI detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 6: Port Detection - Vite
  {
    console.log('Test 6: Port Detection from Vite config');
    try {
      const files = {
        'vite.config.js': 'export default { server: { port: 5173 } };'
      };
      
      const port = detectPort(files);
      assert(port === 5173, `Expected 5173, got ${port}`);
      console.log('  ✓ Port detection from Vite works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 7: Port Detection - package.json scripts
  {
    console.log('Test 7: Port Detection from package.json');
    try {
      const files = {
        'package.json': JSON.stringify({
          scripts: { dev: 'vite --port 3000' }
        })
      };
      
      const port = detectPort(files);
      assert(port === 3000, `Expected 3000, got ${port}`);
      console.log('  ✓ Port detection from scripts works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 8: Port Detection - Flask
  {
    console.log('Test 8: Port Detection from Flask app');
    try {
      const files = {
        'app.py': 'if __name__ == "__main__":\n    app.run(port=5000)'
      };
      
      const port = detectPort(files);
      assert(port === 5000, `Expected 5000, got ${port}`);
      console.log('  ✓ Port detection from Flask works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 9: CodeSandbox Template Mapping
  {
    console.log('Test 9: CodeSandbox Template Mapping');
    try {
      assert(getCodeSandboxTemplate('react') === 'react', 'React template mismatch');
      assert(getCodeSandboxTemplate('next') === 'nextjs', 'Next.js template mismatch');
      assert(getCodeSandboxTemplate('vue') === 'vue', 'Vue template mismatch');
      assert(getCodeSandboxTemplate('flask') === 'python', 'Flask template mismatch');
      assert(getCodeSandboxTemplate('vanilla') === 'vanilla', 'Vanilla template mismatch');
      console.log('  ✓ Template mapping works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 10: Sandpack Config Generation
  {
    console.log('Test 10: Sandpack Config Generation');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' }
        }),
        'src/index.tsx': 'import React from "react";',
        'src/App.tsx': 'export default function App() { return <div>Hello</div>; }'
      };
      
      const config = getSandpackConfig(files, 'react');
      assert(config !== null, 'Config should not be null');
      assert(config.template === 'react', `Expected 'react', got '${config.template}'`);
      assert(config.files['src/App.tsx'] !== undefined, 'App.tsx should be in files');
      console.log('  ✓ Sandpack config generation works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 11: Heuristics Analysis - Simple React (should NOT offload)
  {
    console.log('Test 11: Heuristics - Simple React (no offload)');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { react: '^18.2.0' }
        }),
        'src/App.tsx': 'export default function App() { return <div>Hello</div>; }'
      };
      
      const heuristics = analyzeHeuristics({ files } as PreviewRequest);
      assert(heuristics.shouldOffload === false, 'Simple React should NOT offload');
      console.log('  ✓ Simple project heuristics work\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 12: Heuristics Analysis - Large Project (should offload)
  {
    console.log('Test 12: Heuristics - Large project (should offload)');
    try {
      // Create 1000 files to trigger offload threshold
      const files: Record<string, string> = {
        'package.json': JSON.stringify({ dependencies: { react: '^18.2.0' } })
      };
      for (let i = 0; i < 1000; i++) {
        files[`src/components/Component${i}.tsx`] = `export const Component${i} = () => <div>${i}</div>;`;
      }
      
      const heuristics = analyzeHeuristics({ files } as PreviewRequest);
      assert(heuristics.shouldOffload === true, 'Large project SHOULD offload');
      assert(heuristics.offloadReason !== undefined, 'Should have offload reason');
      console.log('  ✓ Large project heuristics work\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 13: Backend-Only Project Detection
  {
    console.log('Test 13: Backend-Only Project Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { express: '^4.18.0', cors: '^2.8.5' }
        }),
        'server.js': "const express = require('express');\nconst app = express();\napp.listen(3000);"
      };
      
      const result = isBackendOnlyProject(files, ['express', 'cors']);
      assert(result.isBackendOnly === true, 'Express without frontend should be backend-only');
      console.log('  ✓ Backend-only detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 14: Backend-Only Project - Next.js + Express (should NOT be backend-only)
  {
    console.log('Test 14: Next.js + Express (not backend-only)');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { next: '^14.0.0', react: '^18.2.0', express: '^4.18.0' }
        }),
        'app/page.tsx': 'export default function Home() { return <main>Hello</main>; }'
      };
      
      const result = isBackendOnlyProject(files, ['next', 'react', 'express']);
      assert(result.isBackendOnly === false, 'Next.js + Express should NOT be backend-only');
      console.log('  ✓ Full-stack detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 15: Preview Mode Selection - Nuxt
  {
    console.log('Test 15: Nuxt Preview Mode');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { nuxt: '^3.9.0', vue: '^3.4.0' }
        }),
        'nuxt.config.ts': 'export default defineNuxtConfig({});'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'nuxt', `Expected 'nuxt', got '${result.framework}'`);
      assert(result.previewMode === 'sandpack', `Expected 'sandpack', got '${result.previewMode}'`);
      console.log('  ✓ Nuxt preview mode works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 16: Preview Mode Selection - Astro (should be iframe)
  {
    console.log('Test 16: Astro Preview Mode');
    try {
      const files = {
        'package.json': JSON.stringify({
          devDependencies: { astro: '^4.0.0' }
        }),
        'astro.config.mjs': 'export default { };'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'astro', `Expected 'astro', got '${result.framework}'`);
      assert(result.previewMode === 'iframe', `Expected 'iframe', got '${result.previewMode}'`);
      console.log('  ✓ Astro preview mode works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 17: Entry Point Detection - React
  {
    console.log('Test 17: Entry Point Detection - React');
    try {
      const filePaths = ['src/index.tsx', 'src/main.tsx', 'src/App.tsx'];
      const entryPoint = detectEntryPoint(filePaths, 'react');
      assert(entryPoint !== null, 'Should detect entry point');
      assert(entryPoint?.includes('index.tsx') || entryPoint?.includes('main.tsx'), `Unexpected entry: ${entryPoint}`);
      console.log('  ✓ React entry point detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 18: Project Root Detection - Subdirectory project
  {
    console.log('Test 18: Project Root Detection - Subdirectory');
    try {
      const files = {
        'my-app/package.json': JSON.stringify({ dependencies: { react: '^18.2.0' } }),
        'my-app/src/App.tsx': 'export default function App() { return <div>Hello</div>; }'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.selectedRoot === 'my-app', `Expected 'my-app', got '${result.selectedRoot}'`);
      console.log('  ✓ Subdirectory project root detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 19: Python Gradio - pyodide mode
  {
    console.log('Test 19: Gradio Preview Mode');
    try {
      const files = {
        'requirements.txt': 'gradio==4.16.0',
        'app.py': 'import gradio as gr\ndef greet(name): return "Hello " + name\ngr.Interface(fn=greet, inputs="text", outputs="text").launch()'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'gradio', `Expected 'gradio', got '${result.framework}'`);
      assert(result.previewMode === 'pyodide', `Expected 'pyodide', got '${result.previewMode}'`);
      console.log('  ✓ Gradio detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 20: Streamlit - pyodide mode
  {
    console.log('Test 20: Streamlit Preview Mode');
    try {
      const files = {
        'requirements.txt': 'streamlit==1.30.0',
        'app.py': 'import streamlit as st\nst.title("My App")'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'streamlit', `Expected 'streamlit', got '${result.framework}'`);
      assert(result.previewMode === 'pyodide', `Expected 'pyodide', got '${result.previewMode}'`);
      console.log('  ✓ Streamlit detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 21: Error Handling - Malformed package.json (but valid code content)
  {
    console.log('Test 21: Error Handling - Malformed package.json');
    try {
      const files = {
        'package.json': '{ invalid json }',
        'src/App.tsx': 'export default function App() { return <div>Hello</div>; }'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      // With malformed package.json but valid React code in .tsx files, it should detect React
      // This is correct behavior - code content analysis catches the React patterns
      assert(result.framework === 'react', `Expected 'react', got '${result.framework}'`);
      console.log('  ✓ Malformed package.json handling works (detects React from code content)\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 22: Error Handling - Empty files
  {
    console.log('Test 22: Error Handling - Empty files');
    try {
      const result = detectProject({ files: {} } as PreviewRequest);
      assert(result.framework === 'unknown', `Expected 'unknown', got '${result.framework}'`);
      console.log('  ✓ Empty files handling works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 23: Special characters in file paths
  {
    console.log('Test 23: Special Characters in File Paths');
    try {
      const files = {
        'package.json': JSON.stringify({ dependencies: { react: '^18.2.0' } }),
        'src/[id]/page.tsx': 'export default function Page() { return <div>Dynamic</div>; }',
        'src/_components/Header.tsx': 'export default function Header() { return <header />; }'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'react', `Expected 'react', got '${result.framework}'`);
      console.log('  ✓ Special characters in paths works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 24: Vanilla HTML/CSS/JS project
  {
    console.log('Test 24: Vanilla HTML Project');
    try {
      const files = {
        'index.html': '<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><script src="app.js"></script></body></html>',
        'style.css': 'body { font-family: sans-serif; }',
        'app.js': 'console.log("Hello World");'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'vanilla', `Expected 'vanilla', got '${result.framework}'`);
      assert(result.previewMode === 'iframe', `Expected 'iframe', got '${result.previewMode}'`);
      console.log('  ✓ Vanilla HTML detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 25: Svelte detection
  {
    console.log('Test 25: Svelte Framework Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          devDependencies: { svelte: '^4.0.0', vite: '^5.0.0', '@sveltejs/vite-plugin-svelte': '^3.0.0' }
        }),
        'src/main.js': 'import App from "./App.svelte";',
        'src/App.svelte': '<script>let name = "world";</script><h1>Hello {name}!</h1>'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'svelte', `Expected 'svelte', got '${result.framework}'`);
      assert(result.previewMode === 'sandpack', `Expected 'sandpack', got '${result.previewMode}'`);
      console.log('  ✓ Svelte detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 26: Angular detection
  {
    console.log('Test 26: Angular Framework Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { '@angular/core': '^17.0.0', '@angular/common': '^17.0.0' }
        }),
        'angular.json': '{ "$schema": "./node_modules/@angular/cli/lib/config/schema.json", "version": 1 }'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'angular', `Expected 'angular', got '${result.framework}'`);
      assert(result.previewMode === 'sandpack', `Expected 'sandpack', got '${result.previewMode}'`);
      console.log('  ✓ Angular detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 27: Vite bundler detection
  {
    console.log('Test 27: Vite Bundler Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          devDependencies: { vite: '^5.0.0' }
        }),
        'vite.config.ts': 'import { defineConfig } from "vite"; export default defineConfig({});',
        'index.html': '<!DOCTYPE html><html><body><div id="app"></div></body></html>'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'vite', `Expected 'vite', got '${result.framework}'`);
      assert(result.bundler === 'vite', `Expected 'vite', got '${result.bundler}'`);
      assert(result.previewMode === 'vite', `Expected 'vite', got '${result.previewMode}'`);
      console.log('  ✓ Vite bundler detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 28: Webpack bundler detection
  {
    console.log('Test 28: Webpack Bundler Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          devDependencies: { webpack: '^5.0.0', 'webpack-cli': '^5.0.0' }
        }),
        'webpack.config.js': 'module.exports = { entry: "./src/index.js", output: { filename: "bundle.js" } };'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.bundler === 'webpack', `Expected 'webpack', got '${result.bundler}'`);
      assert(result.previewMode === 'webpack', `Expected 'webpack', got '${result.previewMode}'`);
      console.log('  ✓ Webpack bundler detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 29: Remix detection
  {
    console.log('Test 29: Remix Framework Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { '@remix-run/react': '^2.5.0', '@remix-run/node': '^2.5.0', react: '^18.2.0' }
        }),
        'remix.config.js': 'module.exports = { ignoredRouteFiles: ["**/.*"] };'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'remix', `Expected 'remix', got '${result.framework}'`);
      assert(result.previewMode === 'sandpack', `Expected 'sandpack', got '${result.previewMode}'`);
      console.log('  ✓ Remix detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Test 30: SolidJS detection
  {
    console.log('Test 30: SolidJS Framework Detection');
    try {
      const files = {
        'package.json': JSON.stringify({
          dependencies: { 'solid-js': '^1.8.0' },
          devDependencies: { 'vite-plugin-solid': '^2.8.0' }
        }),
        'src/index.tsx': 'import { render } from "solid-js/web"; render(() => <App />, document.getElementById("root"));'
      };
      
      const result = detectProject({ files } as PreviewRequest);
      assert(result.framework === 'solid', `Expected 'solid', got '${result.framework}'`);
      assert(result.previewMode === 'sandpack', `Expected 'sandpack', got '${result.previewMode}'`);
      console.log('  ✓ SolidJS detection works\n');
      passed++;
    } catch (e: any) {
      console.log(`  ✗ Failed: ${e.message}\n`);
      failed++;
    }
  }

  // Summary
  console.log('=== TEST SUMMARY ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  
  if (failed > 0) {
    console.log('\n⚠️  Some tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
    process.exit(0);
  }
}

runTests();