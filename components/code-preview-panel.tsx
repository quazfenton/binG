"use client"

import * as React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { 
  Code as CodeIcon,
  FileText,
  Package,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertCircle,
  Eye,
  Edit,
  Check,
  X
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Sandpack } from "@codesandbox/sandpack-react";
import JSZip from 'jszip';
import type { Message } from '../types/index';

interface CodePreviewPanelProps {
  messages: Message[]
  isOpen: boolean
  onClose: () => void
}

interface CodeBlock {
  language: string
  code: string
  filename?: string
  index: number
  messageId: string
  isError?: boolean
}

interface ProjectStructure {
  name: string
  files: { [key: string]: string }
  dependencies?: string[]
  devDependencies?: string[]
  scripts?: { [key: string]: string }
  framework: 'react' | 'vue' | 'angular' | 'svelte' | 'solid' | 'vanilla' | 'next' | 'nuxt' | 'gatsby' | 'vite' | 'astro' | 'remix'
  bundler?: 'webpack' | 'vite' | 'parcel' | 'rollup' | 'esbuild'
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun'
}

export default function CodePreviewPanel({ messages, isOpen, onClose }: CodePreviewPanelProps) {
  const [detectedFramework, setDetectedFramework] = useState<'react'|'vue'|'vanilla'>('vanilla');
  const [selectedTab, setSelectedTab] = useState("preview")
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [projectStructure, setProjectStructure] = useState<ProjectStructure | null>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0)
  const [editingFileIndex, setEditingFileIndex] = useState<number | null>(null)
  const [editingFileName, setEditingFileName] = useState<string>('')
  const [panelWidth, setPanelWidth] = useState(800)
  const [isDragging, setIsDragging] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const getFileExtension = (language: string): string => {
    const extensions: Record<string, string> = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      html: 'html',
      css: 'css',
      json: 'json',
      xml: 'xml',
      sql: 'sql',
      jsx: 'jsx',
      tsx: 'tsx',
      php: 'php',
      ruby: 'rb',
      go: 'go',
      rust: 'rs',
      swift: 'swift',
      kotlin: 'kt',
      scala: 'scala',
      r: 'r',
      matlab: 'm',
      perl: 'pl',
      lua: 'lua',
      dart: 'dart',
      vue: 'vue',
      svelte: 'svelte',
      shell: 'sh',
      bash: 'sh',
      yaml: 'yml',
      yml: 'yml',
      markdown: 'md',
      md: 'md',
      text: 'txt'
    };
    return extensions[language.toLowerCase()] || 'txt';
  };

  // Helper to clean and normalize filenames
  const cleanFilename = (filenameHint: string, language: string, index: number): string => {
    let cleaned = filenameHint.trim();

    // Step 1: Aggressively remove leading special characters, comments, and common path prefixes/suffixes
    // This is to get a "base" filename from potentially messy markdown hints.
    cleaned = cleaned
      .replace(/^[\s\-_=\+\*`~!@#$%^&()\[\]{}|;:'",.<>?\/\\-]+/, '') // Remove leading special chars, including __--_
      .replace(/^\s*(\/\/|#|\/\*)\s*/, '') // Remove leading //, #, /*
      .replace(/\s*(\*\/)\s*$/, '') // Remove trailing */
      .replace(/^(\.\/|\.\.\/)+/, '') // Remove leading ./ or ../ segments
      .replace(/\/\/+/g, '/') // Remove any duplicate slashes (e.g., "src//App.js" -> "src/App.js")
      .replace(/\/$/, '') // Remove trailing slashes if any
      .trim(); // Trim any remaining whitespace

    // Normalize backslashes to forward slashes
    cleaned = cleaned.replace(/\\/g, '/');

    // Replace any characters that are not alphanumeric, underscore, hyphen, dot, or slash with an underscore
    // This allows for valid path structures like 'src/components/file.js'
    cleaned = cleaned.replace(/[^a-zA-Z0-9_\-./]/g, '_');

    // Deduplicate common path prefixes if they appear as 'src/src/' or 'components/components/'
    if (cleaned.startsWith('src/src/')) {
      cleaned = cleaned.substring(4);
    }
    if (cleaned.startsWith('components/components/')) {
      cleaned = cleaned.substring(11);
    }

    let finalFilename = cleaned;
    const expectedExt = getFileExtension(language);

    // Step 2: Apply framework-specific naming conventions and ensure correct path/extension
    // This logic should *add* prefixes only if they are not already present.
    if (language === "html") {
      // For HTML, if it's a root file or contains <html>, standardize to index.html
     // For other HTML files, assume they are components or views, often in src/ or app/
      if (finalFilename.includes("/")) {
        finalFilename = finalFilename;
      } else {
        finalFilename = "index.html";
      }
    } else if (language === "css") {
      if (finalFilename.includes('/')) {
        finalFilename = finalFilename;
      } else if (finalFilename === "styles" || finalFilename.includes('css')) {        
        finalFilename = "styles.css";
      }
    } else if (language === "javascript") {
      // If it's a common entry point or app file, standardize its path
      if ((finalFilename.includes("App") || finalFilename.includes("index") || finalFilename.includes("main")) && !finalFilename.startsWith('src/')) {
        finalFilename = `src/App.js`; // Standardize to src/App.js
      } else if (!finalFilename.startsWith('src/') && !finalFilename.startsWith('lib/') && !finalFilename.startsWith('public/')) {
        finalFilename = finalFilename;
      }
    } else if (language === "jsx" || language === "tsx") {
      // If the cleaned filename already has a valid path (e.g., 'src/App.jsx', 'components/Greeting.jsx')
      // or is a common root file, use it directly.
        // Ensure it has the correct extension
        if (!finalFilename.endsWith(`.${expectedExt}`)) {
          finalFilename = `${finalFilename.split('.')[0]}.${expectedExt}`;
        }
       //if (finalFilename.startsWith('src/') || finalFilename.startsWith('components/')) {
       if (finalFilename.includes("App") || finalFilename.includes("index") || finalFilename.includes("main")) {
        // For main app files, standardize to src/App.jsx or src/App.tsx
        finalFilename = `src/App.${expectedExt}`;
      } else {
        // For other components, assume they belong in src/
        finalFilename = `src/${finalFilename}`;
        // Ensure it has the correct extension
        if (!finalFilename.endsWith(`.${expectedExt}`)) {
          finalFilename = `${finalFilename.split('.')[0]}.${expectedExt}`;
        }
      }
  //  } else if (language === "vue") {
     // finalFilename = "src/App.vue";
    } else if (language === "typescript") {
      // For Angular components, ensure 'src/app/' prefix and correct extension
      if (finalFilename.includes('.component.') && !finalFilename.startsWith('src/app/')) {
        finalFilename = `src/app/${finalFilename}`;
      } else if (!finalFilename.startsWith('src/')) {
        finalFilename = `src/${finalFilename}`;
      }
      // Ensure correct extension
      if (!finalFilename.endsWith(`.${expectedExt}`)) {
        finalFilename = `${finalFilename.split('.')[0]}.${expectedExt}`;
      }
    } else if (language === "json" && finalFilename.includes("package")) {
      finalFilename = "package.json";
    } else if (language === "shell" || language === "bash") {
      finalFilename = `script-${index}.sh`;
    }

    // Step 3: Ensure a valid filename and correct extension as a final pass
    // Only generate a default filename if it's truly empty or a generic placeholder like ".txt"
    if (!finalFilename || finalFilename === '.' || finalFilename === '..') {
      finalFilename = `file-${index}.${expectedExt}`;
    } else {
      const parts = finalFilename.split('.');
      const currentExt = parts.length > 1 ? parts[parts.length - 1] : '';
      if (currentExt === 'txt' || currentExt === '' || currentExt !== expectedExt) {
        if (parts.length > 1) {
          parts[parts.length - 1] = expectedExt;
          finalFilename = parts.join('.');
        } else {
          finalFilename = `${finalFilename}.${expectedExt}`;
        }
      }
    }

    return finalFilename;
  };

  // Extract code blocks from messages
  const codeBlocks = useMemo(() => {
    const blocks: CodeBlock[] = [];
    messages.forEach((message) => {
      if (message.role === "assistant") {
        let parsedContent: any = null;
        try {
          // Attempt to parse message.content as JSON
          parsedContent = JSON.parse(message.content);
          // Check if it has the expected structure for a code block
          if (parsedContent && typeof parsedContent === 'object' && parsedContent.language && parsedContent.code) {
            // It's a JSON object representing a code block
            const filename = cleanFilename(parsedContent.filename || `file-${message.id}-${blocks.length}.${getFileExtension(parsedContent.language)}`, parsedContent.language, blocks.length);
            if (!parsedContent.code.trim()) return; // Skip empty code blocks

            blocks.push({
              language: parsedContent.language,
              code: parsedContent.code.trim(),
              filename,
              index: blocks.length, // Use blocks.length for sequential indexing
              messageId: message.id,
              isError: message.isError || false
            });
            return; // Processed this message, move to the next
          }
        } catch (e) {
          // If parsing fails, it's likely not a JSON object, proceed to markdown parsing
          // console.log("Message content is not a valid JSON object, attempting markdown parsing.");
        }

        // If not JSON, try parsing as markdown code blocks
        const markdownCodeMatches = message.content.match(/```(\S*)(?:\s+(.*?))?\n([\s\S]*?)```/g) || [];
        
        markdownCodeMatches.forEach((match, blockIndex) => {
          const parsed = match.match(/```(\S*)(?:\s+(.*?))?\n([\s\S]*?)```/);
          if (!parsed) return;
          
          const language = parsed[1] || "text";
          const filenameHint = parsed[2] ? parsed[2].trim() : '';
          let code = parsed[3].trim();

          if (!code.trim()) return; // Skip empty code blocks

          // Extract filename from hint or generate default, then clean
          const filename = cleanFilename(filenameHint || `file-${message.id}-${blocks.length}.${getFileExtension(language)}`, language, blocks.length);

          blocks.push({
            language,
            code,
            filename,
            index: blocks.length, // Use blocks.length for sequential indexing
            messageId: message.id,
            isError: message.isError || false
          });
        });
      }
    });
    return blocks;
  }, [messages]);

  // Generate project structure for complex projects
  useEffect(() => {
    if (codeBlocks.length > 0) { // Changed from > 1 to > 0 to handle single file projects
      const structure = analyzeProjectStructure(codeBlocks);
      setProjectStructure(structure);
    }
  }, [codeBlocks]);

  const analyzeProjectStructure = (blocks: CodeBlock[]): ProjectStructure => {
    const files: { [key: string]: string } = {};
    const dependencies: string[] = [];
    const devDependencies: string[] = [];
    const scripts: { [key: string]: string } = {};
    let framework: ProjectStructure['framework'] = 'vanilla';
    let bundler: ProjectStructure['bundler'] = undefined;
    let packageManager: ProjectStructure['packageManager'] = 'npm';
    
    for (const block of blocks) {
      // Use the filename that was already cleaned in useMemo
      const finalFilename = block.filename; 
      
      // Ensure a filename is always set, even if it's a default one.
      if (!finalFilename) {
           console.error("Filename is unexpectedly null or undefined after cleaning.");
           continue; // Skip this block if filename is missing
      }
      
      files[finalFilename] = block.code
      
      // Extract dependencies and project info
      if (block.language === "json" && finalFilename === "package.json") {
        try {
          const pkg = JSON.parse(block.code)
          if (pkg.dependencies) {
            dependencies.push(...Object.keys(pkg.dependencies))
            
            // Enhanced framework detection based on dependencies
            if (pkg.dependencies.next || pkg.dependencies['next']) {
              framework = 'next';
            } else if (pkg.dependencies.nuxt || pkg.dependencies['@nuxt/core']) {
              framework = 'nuxt';
            } else if (pkg.dependencies.gatsby || pkg.dependencies['gatsby']) {
              framework = 'gatsby';
            } else if (pkg.dependencies.astro || pkg.dependencies['astro']) {
              framework = 'astro';
            } else if (pkg.dependencies['@remix-run/react']) {
              framework = 'remix';
            } else if (pkg.dependencies.svelte || pkg.dependencies['svelte']) {
              framework = 'svelte';
            } else if (pkg.dependencies['solid-js']) {
              framework = 'solid';
            } else if (pkg.dependencies.react) {
              framework = 'react';
            } else if (pkg.dependencies.vue) {
              framework = 'vue';
            } else if (pkg.dependencies['@angular/core']) {
              framework = 'angular';
            }
          }
          
          if (pkg.devDependencies) {
            devDependencies.push(...Object.keys(pkg.devDependencies))
            
            // Detect bundler from devDependencies
            if (pkg.devDependencies.vite) {
              bundler = 'vite';
            } else if (pkg.devDependencies.webpack) {
              bundler = 'webpack';
            } else if (pkg.devDependencies.parcel) {
              bundler = 'parcel';
            } else if (pkg.devDependencies.rollup) {
              bundler = 'rollup';
            } else if (pkg.devDependencies.esbuild) {
              bundler = 'esbuild';
            }
          }
          
          if (pkg.scripts) {
            Object.assign(scripts, pkg.scripts);
          }
          
          // Detect package manager from lockfiles or packageManager field
          if (pkg.packageManager) {
            if (pkg.packageManager.includes('yarn')) packageManager = 'yarn';
            else if (pkg.packageManager.includes('pnpm')) packageManager = 'pnpm';
            else if (pkg.packageManager.includes('bun')) packageManager = 'bun';
          }
        } catch (e) {
          console.warn("Failed to parse package.json")
        }
      }
      
      // Detect framework based on file extensions and paths
      if (framework === 'vanilla') {
        const ext = getFileExtension(block.language);
        if (ext === 'jsx' || ext === 'tsx') {
          framework = 'react';
        } else if (ext === 'vue') {
          framework = 'vue';
        } else if (ext === 'svelte') {
          framework = 'svelte';
        } else if (ext === 'astro') {
          framework = 'astro';
        } else if (ext === 'ts' && finalFilename.includes('.component.')) {
          framework = 'angular';
        }
      }
      
      // Detect package manager from lockfiles
      if (finalFilename === 'yarn.lock') packageManager = 'yarn';
      else if (finalFilename === 'pnpm-lock.yaml') packageManager = 'pnpm';
      else if (finalFilename === 'bun.lockb') packageManager = 'bun';
    }
    
    // Add README content if there's remaining text
    const readmeContent = extractReadmeContent(blocks);
    if (readmeContent) {
      files['README.md'] = readmeContent;
    }
    
    const structure: ProjectStructure = {
      name: "Generated Project",
      files,
      dependencies: dependencies.length > 0 ? dependencies : undefined,
      devDependencies: devDependencies.length > 0 ? devDependencies : undefined,
      scripts: Object.keys(scripts).length > 0 ? scripts : undefined,
      framework,
      bundler,
      packageManager
    };
    return structure;
  }
  
  // Extract README content from non-code text in messages
  const extractReadmeContent = (blocks: CodeBlock[]): string | null => {
    const readmeBlocks = blocks.filter(block => 
      block.language === 'markdown' || 
      block.language === 'md' || 
      block.filename?.toLowerCase().includes('readme')
    );
    
    if (readmeBlocks.length > 0) {
      return readmeBlocks.map(block => block.code).join('\n\n');
    }
    
    // Extract tutorial/summary text from messages
    const tutorialText = messages
      .filter(msg => msg.role === 'assistant')
      .map(msg => {
        // Remove code blocks and extract remaining text
        const textWithoutCode = msg.content.replace(/```[\s\S]*?```/g, '').trim();
        return textWithoutCode;
      })
      .filter(text => text.length > 100) // Only include substantial text
      .join('\n\n');
    
    if (tutorialText.length > 200) {
      return `# Project Documentation\n\n${tutorialText}`;
    }
    
    return null;
  }

  const downloadAsZip = async () => {
    const zip = new JSZip()
    
    // Use project structure files if available
    if (projectStructure) {
      Object.entries(projectStructure.files).forEach(([filename, content]) => {
        zip.file(filename, content)
      })
    } else {
      // Fallback to code blocks
      codeBlocks.forEach((block) => {
        const filename = block.filename || `snippet-${block.index}.${getFileExtension(block.language)}`
        zip.file(filename, block.code)
      })
    }
    
    // Always add README
    const readme = `# Generated Code Project

This project contains ${projectStructure ? Object.keys(projectStructure.files).length : codeBlocks.length} code files extracted from an AI conversation.

## Files:
${projectStructure
  ? Object.keys(projectStructure.files).map(filename => `- ${filename}`).join('\n')
  : codeBlocks.map(block => `- ${block.filename} (${block.language})`).join('\n')
}

## Dependencies:
${projectStructure?.dependencies?.length
  ? projectStructure.dependencies.map(dep => `- ${dep}`).join('\n')
  : 'None'
}

## Usage:
Please review each file and follow the appropriate setup instructions for your programming language.

Generated on: ${new Date().toLocaleString()}
`
    zip.file("README.md", readme)
    
    const content = await zip.generateAsync({ type: "blob" })
    const url = URL.createObjectURL(content)
    const a = document.createElement("a")
    a.href = url
    a.download = `code-project-${Date.now()}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Filename editing functions
  const startEditingFilename = (index: number, currentFilename: string) => {
    setEditingFileIndex(index)
    setEditingFileName(currentFilename)
  }

  const cancelEditingFilename = () => {
    setEditingFileIndex(null)
    setEditingFileName('')
  }

  const saveFilename = (index: number, newFilename: string) => {
    if (!newFilename.trim()) {
      cancelEditingFilename()
      return
    }

    const trimmedFilename = newFilename.trim()
    const oldFilename = codeBlocks[index].filename

    // Update project structure if it exists
    if (projectStructure) {
      const newFiles = { ...projectStructure.files }
      
      if (oldFilename && newFiles[oldFilename]) {
        // Move the content to the new filename
        newFiles[trimmedFilename] = newFiles[oldFilename]
        delete newFiles[oldFilename]
        
        setProjectStructure({
          ...projectStructure,
          files: newFiles
        })
      }
    }

    // Force re-render by updating a state that triggers useMemo recalculation
    // This ensures the preview updates with the new filename
    setSelectedFileIndex(prev => prev === index ? index : prev)
    
    cancelEditingFilename()
  }

  // Resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartWidth.current = panelWidth
    e.preventDefault()
  }, [panelWidth])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return
    
    const deltaX = dragStartX.current - e.clientX
    const newWidth = Math.max(400, Math.min(1200, dragStartWidth.current + deltaX))
    setPanelWidth(newWidth)
  }, [isDragging])

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  const renderLivePreview = () => {
    // Enhanced framework support with better template mapping
    const getSandpackTemplate = (framework: string) => {
      switch (framework) {
        case 'react': return 'react';
        case 'next': return 'nextjs';
        case 'vue': return 'vue';
        case 'nuxt': return 'nuxt';
        case 'angular': return 'angular';
        case 'svelte': return 'svelte';
        case 'solid': return 'solid';
        case 'astro': return 'astro';
        case 'remix': return 'remix';
        case 'gatsby': return 'gatsby';
        case 'vite': return 'vite-react';
        default: return 'vanilla';
      }
    };

    if (projectStructure && ['react', 'vue', 'angular', 'svelte', 'solid', 'next', 'nuxt', 'astro', 'remix', 'gatsby', 'vite'].includes(projectStructure.framework)) {
      try {
        // Map files to Sandpack format
        const sandpackFiles = Object.entries(projectStructure.files).reduce(
          (acc, [path, content]) => {
            // Skip empty files
            if (!content.trim()) return acc;
            
            // The path should already be correctly formatted by cleanFilename.
            // We just need to ensure it's prefixed with '/' for Sandpack.
            const sandpackPath = path.startsWith('/') ? path : `/${path}`;
            
            acc[sandpackPath] = { code: content };
            return acc;
          },
          {} as Record<string, { code: string }>
        );

        // Framework-specific entry file handling
        const addEntryFileIfMissing = () => {
          const hasEntryFile = Object.keys(sandpackFiles).some(path => 
            path.includes('index.') || path.includes('main.') || path.includes('App.')
          );

          if (!hasEntryFile) {
            switch (projectStructure.framework) {
              case 'react':
              case 'next':
              case 'gatsby':
                sandpackFiles['/src/App.jsx'] = {
                  code: `import React from 'react';

export default function App() {
  return (
    <div className="App">
      <h1>Hello React!</h1>
      <p>This is a generated React application.</p>
    </div>
  );
}`
                };
                sandpackFiles['/src/index.js'] = {
                  code: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);`
                };
                break;
              case 'vue':
              case 'nuxt':
                sandpackFiles['/src/App.vue'] = {
                  code: `<template>
  <div id="app">
    <h1>Hello Vue!</h1>
    <p>This is a generated Vue application.</p>
  </div>
</template>

<script>
export default {
  name: 'App'
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  text-align: center;
  color: #2c3e50;
  margin-top: 60px;
}
</style>`
                };
                break;
              case 'svelte':
                sandpackFiles['/src/App.svelte'] = {
                  code: `<script>
  let name = 'Svelte';
</script>

<main>
  <h1>Hello {name}!</h1>
  <p>This is a generated Svelte application.</p>
</main>

<style>
  main {
    text-align: center;
    padding: 1em;
    max-width: 240px;
    margin: 0 auto;
  }
</style>`
                };
                break;
              default:
                sandpackFiles['/src/index.js'] = {
                  code: `console.log('Hello from ${projectStructure.framework}!');`
                };
            }
          }
        };

        addEntryFileIfMissing();

        const template = getSandpackTemplate(projectStructure.framework);

        return (
          <div className="h-96">
            <Sandpack
              template={template as any}
              theme="dark"
              options={{
                showTabs: true,
                showLineNumbers: true,
                showNavigator: true,
                showConsole: true,
                showRefreshButton: true,
                autorun: true,
                recompileMode: 'delayed',
                recompileDelay: 300,
              }}
              files={sandpackFiles}
              customSetup={{
                dependencies: projectStructure.dependencies?.reduce((acc, dep) => {
                  acc[dep] = 'latest';
                  return acc;
                }, {} as Record<string, string>) || {},
                devDependencies: projectStructure.devDependencies?.reduce((acc, dep) => {
                  acc[dep] = 'latest';
                  return acc;
                }, {} as Record<string, string>) || {},
              }}
            />
          </div>
        );
      } catch (error) {
        return (
          <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
            <div className="text-center">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
              <p className="text-red-400">Failed to render framework preview</p>
              <p className="text-sm text-gray-600 mt-2">
                Framework: {projectStructure.framework}
              </p>
              <p className="text-sm text-gray-600">
                Error: {(error as Error).message}
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-2 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          </div>
        );
      }
    }


    // Enhanced vanilla HTML/CSS/JS preview with JSBin-style features
    try {
      const htmlFile = codeBlocks.find(block => block.language === "html")
      const cssFile = codeBlocks.find(block => block.language === "css")
      const jsFile = codeBlocks.find(block => block.language === "javascript" || block.language === "js")
      const tsFile = codeBlocks.find(block => block.language === "typescript" || block.language === "ts")
      
      // If no HTML but has other web files, create a basic HTML structure
      if (!htmlFile && (cssFile || jsFile || tsFile)) {
        const autoGeneratedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated Preview</title>
  ${cssFile ? `<style>${cssFile.code}</style>` : ''}
</head>
<body>
  <div id="app">
    <h1>Auto-generated Preview</h1>
    <p>This preview was automatically generated from your code.</p>
    <div id="content"></div>
  </div>
  ${jsFile ? `<script>${jsFile.code}</script>` : ''}
  ${tsFile ? `<script type="module">
    // TypeScript code (simplified for preview)
    ${tsFile.code.replace(/import .* from .*/g, '// Import removed for preview')}
  </script>` : ''}
</body>
</html>`;

        return (
          <div className="relative">
            <div className="absolute top-2 right-2 z-10 flex gap-2">
              <div className="bg-yellow-600 text-white px-2 py-1 rounded text-xs">
                Auto-generated
              </div>
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="bg-gray-800 text-gray-300 p-1 rounded border border-gray-600"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
            <iframe
              ref={iframeRef}
              srcDoc={autoGeneratedHtml}
              className={`w-full bg-white rounded-lg border ${isFullscreen ? 'h-screen' : 'h-96'}`}
              title="Auto-generated Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        );
      }
      
      if (!htmlFile) {
        return (
          <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
            <div className="text-center">
              <CodeIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-400">No HTML code found for live preview</p>
              <p className="text-sm text-gray-600 mt-2">Generate code to enable live preview</p>
              {codeBlocks.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs text-gray-500 mb-2">Available code blocks:</p>
                  <div className="flex flex-wrap gap-1 justify-center">
                    {codeBlocks.map((block, index) => (
                      <span key={index} className="bg-gray-700 text-gray-300 px-2 py-1 rounded text-xs">
                        {block.language}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      }
      
      // Enhanced HTML document with better error handling and console capture
      const combinedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Preview</title>
  <style>
    /* Reset and base styles */
    * { box-sizing: border-box; }
    body { margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    
    /* Custom styles */
    ${cssFile ? cssFile.code : ''}
    
    /* Error display styles */
    .preview-error {
      background: #fee;
      border: 1px solid #fcc;
      color: #c33;
      padding: 10px;
      margin: 10px 0;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }
  </style>
</head>
<body>
  ${htmlFile.code}
  
  <script>
    // Error handling and console capture
    window.addEventListener('error', function(e) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'preview-error';
      errorDiv.innerHTML = '<strong>JavaScript Error:</strong><br>' + e.message + '<br>Line: ' + e.lineno;
      document.body.appendChild(errorDiv);
    });
    
    // Console capture for debugging
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    
    console.log = function(...args) {
      originalLog.apply(console, args);
      // Could add visual console output here if needed
    };
    
    console.error = function(...args) {
      originalError.apply(console, args);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'preview-error';
      errorDiv.innerHTML = '<strong>Console Error:</strong><br>' + args.join(' ');
      document.body.appendChild(errorDiv);
    };
    
    // User JavaScript
    try {
      ${jsFile ? jsFile.code : ''}
    } catch (error) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'preview-error';
      errorDiv.innerHTML = '<strong>Script Error:</strong><br>' + error.message;
      document.body.appendChild(errorDiv);
    }
  </script>
</body>
</html>`;

      return (
        <div className="relative">
          <div className="absolute top-2 right-2 z-10 flex gap-2">
            <button
              onClick={() => {
                if (iframeRef.current) {
                  iframeRef.current.src = iframeRef.current.src; // Refresh iframe
                }
              }}
              className="bg-gray-800 text-gray-300 p-1 rounded border border-gray-600"
              title="Refresh Preview"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="bg-gray-800 text-gray-300 p-1 rounded border border-gray-600"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
          <iframe
            ref={iframeRef}
            srcDoc={combinedHtml}
            className={`w-full bg-white rounded-lg border ${isFullscreen ? 'h-screen' : 'h-96'}`}
            title="Live Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onError={(e) => console.error("Iframe error", e)}
          />
        </div>
      )
    } catch (error) {
      return (
        <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
            <p className="text-red-400">Failed to render HTML preview</p>
            <p className="text-sm text-gray-600 mt-2">
              Error: {(error as Error).message}
            </p>
          </div>
        </div>
      );
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key={isOpen ? 'visible' : 'hidden'}
          initial={{ opacity: 0, x: '100%' }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: '100%' }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="fixed right-0 top-0 h-full bg-black/20 backdrop-blur-2xl border border-white/10 rounded-l-xl z-[100] overflow-hidden shadow-2xl"
          style={{ width: `${panelWidth}px` }}
        >
          {/* Resize Handle */}
          <div 
            className="absolute left-0 top-0 bottom-0 w-1 bg-white/20 cursor-ew-resize hover:bg-white/30 transition-all duration-200"
            onMouseDown={handleMouseDown}
          />
          
        <Card className="h-full bg-transparent border-0 rounded-none">
          <CardHeader className="border-b border-white/10 bg-black/20">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <CodeIcon className="w-5 h-5" />
                Code Preview Panel
                <span className="bg-gray-700 text-gray-300 rounded-full px-2.5 py-0.5 text-xs">
                  {codeBlocks.length} file(s)
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadAsZip}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded text-sm flex items-center"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Download ZIP
                </button>
                {projectStructure && (
                  <button
                    onClick={() => {
                      localStorage.setItem('visualEditorProject', JSON.stringify(projectStructure));
                      window.open('/visual-editor', '_blank');
                    }}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded text-sm flex items-center"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="border border-gray-300 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="p-0 h-full">
            <Tabs value={selectedTab} onValueChange={setSelectedTab} className="h-full">
              <TabsList className="grid w-full grid-cols-3 bg-black/40 border-b border-white/10">
                <TabsTrigger value="preview" className="text-white">
                  <Eye className="w-4 h-4 mr-2" />
                  Live Preview
                </TabsTrigger>
                <TabsTrigger value="files" className="text-white">
                  <FileText className="w-4 h-4 mr-2" />
                  Files
                </TabsTrigger>
                <TabsTrigger value="structure" className="text-white">
                  <Package className="w-4 h-4 mr-2" />
                  Project
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="preview" className="p-4 h-full">
                {renderLivePreview()}
              </TabsContent>
              
              {detectedFramework !== 'vanilla' && (
                <TabsContent value="sandpack" className="p-0 h-full">
                  {renderLivePreview()}
                </TabsContent>
              )}
              
              <TabsContent value="files" className="p-0 h-full">
                <div className="flex h-full">
                  <div className="w-64 border-r border-white/10 bg-black/30 overflow-y-auto">
                    <div className="p-4">
                      <h3 className="text-sm font-medium text-gray-300 mb-2">Files</h3>
                      <div className="space-y-1">
                        {codeBlocks.map((block, index) => (
                          <div
                            className={`flex items-center w-full justify-between p-2 group ${
                              selectedFileIndex === index ? 'bg-gray-700' : 'hover:bg-gray-800'
                            }`}
                            key={index}
                          >
                            <div 
                              className="flex items-center flex-1 cursor-pointer"
                              onClick={() => setSelectedFileIndex(index)}
                            >
                              <FileText className="w-4 h-4 mr-2 flex-shrink-0" />
                              
                              {editingFileIndex === index ? (
                                <div className="flex items-center gap-1 flex-1">
                                  <Input
                                    value={editingFileName}
                                    onChange={(e) => setEditingFileName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        saveFilename(index, editingFileName)
                                      } else if (e.key === 'Escape') {
                                        cancelEditingFilename()
                                      }
                                    }}
                                    className="h-6 text-xs bg-gray-600 border-gray-500 text-white flex-1"
                                    autoFocus
                                    onBlur={() => saveFilename(index, editingFileName)}
                                  />
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => saveFilename(index, editingFileName)}
                                    className="h-6 w-6 p-0 text-green-400 hover:text-green-300"
                                  >
                                    <Check className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={cancelEditingFilename}
                                    className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="truncate flex-1">{block.filename}</span>
                              )}
                            </div>

                            <div className="flex items-center gap-1">
                              {editingFileIndex !== index && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    startEditingFilename(index, block.filename || '')
                                  }}
                                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white transition-opacity"
                                >
                                  <Edit className="w-3 h-3" />
                                </Button>
                              )}
                              
                              {block.isError && (
                                <span className="text-red-500">
                                  <AlertCircle className="w-4 h-4" />
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto">
                    {codeBlocks.length > 0 && selectedFileIndex !== null && (
                      <div className="h-full flex flex-col">
                        <div className="p-4 border-b border-white/10 bg-black/40 flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className="border border-gray-500 text-gray-300 rounded px-2 py-0.5 text-xs">
                              {codeBlocks[selectedFileIndex].language}
                            </span>
                            <span className="text-sm font-mono text-gray-300">{codeBlocks[selectedFileIndex].filename}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="flex items-center text-sm hover:bg-gray-200 px-2 py-1 rounded"
                              onClick={() => {
                                navigator.clipboard.writeText(codeBlocks[selectedFileIndex].code)
                              }}
                            >
                              <CodeIcon className="w-4 h-4 mr-1" />
                              Copy
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto bg-black/30">
                          <SyntaxHighlighter
                            style={oneDark as any}
                            language={codeBlocks[selectedFileIndex].language}
                            PreTag="div"
                            className="!m-0 !bg-gray-900 h-full text-sm"
                            showLineNumbers
                          >
                            {codeBlocks[selectedFileIndex].code}
                          </SyntaxHighlighter>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="structure" className="p-4 h-full overflow-y-auto">
                {projectStructure ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2">Project Structure</h3>
                      <div className="bg-black/40 rounded-lg p-4">
                        <pre className="text-sm text-gray-300">
                          {Object.keys(projectStructure.files).map(filename => (
                            <div key={filename} className="flex items-center gap-2 mb-1">
                              <FileText className="w-4 h-4" />
                              {filename}
                            </div>
                          ))}
                        </pre>
                      </div>
                    </div>
                    
                    {projectStructure.dependencies && (
                      <div>
                        <h4 className="text-md font-medium text-white mb-2">Dependencies</h4>
                        <div className="flex flex-wrap gap-2">
                          {projectStructure.dependencies.map(dep => (
                            <span key={dep} className="bg-gray-700 text-gray-300 rounded px-2 py-0.5 text-xs">
                              {dep}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <h4 className="text-md font-medium text-white mb-2">Setup Instructions</h4>
                      <div className="bg-black/40 rounded-lg p-4">
                        <pre className="text-sm text-gray-300">
{`1. Download the ZIP file
2. Extract to your desired location
3. Review the README.md file
4. Install dependencies (if any)
5. Run the project according to the language requirements`}
                        </pre>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-400">
                    <Package className="w-16 h-16 mx-auto mb-4" />
                    <p>No project structure detected</p>
                    <p className="text-sm mt-2">Add more code files to analyze project structure</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </motion.div>
      )}
    </AnimatePresence>
  )
}
