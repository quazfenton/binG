"use client"

import * as React from 'react';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
import { parsePatch, applyPatch } from 'diff';

interface CodePreviewPanelProps {
  messages: Message[]
  isOpen: boolean
  onClose: () => void
  // commands management
  commandsByFile?: Record<string, string[]>
  onApplyAllCommandDiffs?: () => void
  onApplyFileCommandDiffs?: (path: string) => void
  onClearAllCommandDiffs?: () => void
  onClearFileCommandDiffs?: (path: string) => void
  onSquashFileCommandDiffs?: (path: string) => void
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
  framework: 'react' | 'vue' | 'angular' | 'svelte' | 'solid' | 'vanilla' | 'next' | 'nuxt' | 'gatsby' | 'vite' | 'astro' | 'remix' | 'qwik' | 'gradio' | 'streamlit' | 'flask' | 'fastapi' | 'django' | 'vite-react'
  bundler?: 'webpack' | 'vite' | 'parcel' | 'rollup' | 'esbuild'
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun'
}

export default function CodePreviewPanel({ messages, isOpen, onClose, commandsByFile = {}, onApplyAllCommandDiffs, onApplyFileCommandDiffs, onClearAllCommandDiffs, onClearFileCommandDiffs, onSquashFileCommandDiffs }: CodePreviewPanelProps) {
  const [detectedFramework, setDetectedFramework] = useState<'react' | 'vue' | 'vanilla'>('vanilla');
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
  const [diffContent, setDiffContent] = useState<string>('');
  const [diffErrors, setDiffErrors] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const pendingFiles = useMemo(() => Object.keys(commandsByFile || {}), [commandsByFile]);


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
      vue: 'vue',
      vite: 'js', // Vite config files are typically JS
      gradio: 'py', // Gradio apps are Python
      streamlit: 'py', // Streamlit apps are Python
      flask: 'py', // Flask apps are Python
      fastapi: 'py', // FastAPI apps are Python
      django: 'py', // Django apps are Python
      svelte: 'svelte',
      astro: 'astro',
      solid: 'jsx', // SolidJS uses JSX
      qwik: 'tsx', // Qwik uses TSX
      remix: 'tsx', // Remix uses TSX
      nuxt: 'vue', // Nuxt uses Vue
      next: 'tsx', // Next.js typically uses TSX
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
      // Removed duplicate entries
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

  // Extract filename from text context before code block
  const extractFilenameFromContext = (messageContent: string, codeBlockMatch: string, language: string): string | null => {
    try {
      const codeBlockIndex = messageContent.indexOf(codeBlockMatch);
      if (codeBlockIndex === -1) return null;

      // Look at text before the code block (up to 500 characters)
      const contextBefore = messageContent.substring(Math.max(0, codeBlockIndex - 500), codeBlockIndex);

      // Get file extension for this language
      const expectedExt = getFileExtension(language);

      // Look for filenames with the correct extension in the context
      const extensionPattern = new RegExp(`([\\w\\-\\/\\.]+\\.${expectedExt})(?![\\w])`, 'gi');
      const matches = contextBefore.match(extensionPattern);

      if (matches && matches.length > 0) {
        // Get the last (closest) match to the code block
        const filename = matches[matches.length - 1];

        // Clean up the filename
        let cleaned = filename.trim();

        // Remove common prefixes that might be captured
        cleaned = cleaned.replace(/^[^\w\/]*/, ''); // Remove leading non-word chars except /
        cleaned = cleaned.replace(/[^\w\/\.\-]*$/, ''); // Remove trailing non-word chars except . and -

        return cleaned;
      }

      // Fallback: look for common path patterns for all frameworks
      const pathPatterns = [
        // Framework-specific patterns
        /(?:src\/(?:components\/|pages\/|views\/|utils\/|hooks\/|lib\/|services\/|store\/|styles\/|assets\/)?[\w\-]+\.[\w]+)/gi,
        /(?:components\/[\w\-]+\.[\w]+)/gi,
        /(?:pages\/[\w\-]+\.[\w]+)/gi,
        /(?:views\/[\w\-]+\.[\w]+)/gi,
        /(?:utils\/[\w\-]+\.[\w]+)/gi,
        /(?:hooks\/[\w\-]+\.[\w]+)/gi,
        /(?:lib\/[\w\-]+\.[\w]+)/gi,
        /(?:services\/[\w\-]+\.[\w]+)/gi,
        /(?:store\/[\w\-]+\.[\w]+)/gi,
        /(?:styles\/[\w\-]+\.[\w]+)/gi,
        /(?:assets\/[\w\-]+\.[\w]+)/gi,
        // Python specific
        /(?:app\/[\w\-]+\.py)/gi,
        /(?:models\/[\w\-]+\.py)/gi,
        /(?:views\/[\w\-]+\.py)/gi,
        /(?:templates\/[\w\-]+\.html)/gi,
        /(?:static\/[\w\-]+\.(?:css|js))/gi,
        // Java specific
        /(?:src\/main\/java\/[\w\/\-]+\.java)/gi,
        /(?:src\/test\/java\/[\w\/\-]+\.java)/gi,
        // C/C++ specific
        /(?:src\/[\w\-]+\.(?:c|cpp|h|hpp))/gi,
        /(?:include\/[\w\-]+\.(?:h|hpp))/gi,
        // PHP specific
        /(?:app\/[\w\-]+\.php)/gi,
        /(?:public\/[\w\-]+\.php)/gi,
        /(?:resources\/views\/[\w\-]+\.blade\.php)/gi,
        // Ruby specific
        /(?:app\/(?:models\/|controllers\/|views\/)?[\w\-]+\.rb)/gi,
        /(?:lib\/[\w\-]+\.rb)/gi,
        // Go specific
        /(?:cmd\/[\w\-]+\.go)/gi,
        /(?:pkg\/[\w\-]+\.go)/gi,
        /(?:internal\/[\w\-]+\.go)/gi,
        // Rust specific
        /(?:src\/[\w\-]+\.rs)/gi,
        /(?:tests\/[\w\-]+\.rs)/gi,
        // Swift specific
        /(?:Sources\/[\w\-]+\.swift)/gi,
        /(?:Tests\/[\w\-]+\.swift)/gi,
        // Kotlin specific
        /(?:src\/main\/kotlin\/[\w\/\-]+\.kt)/gi,
        /(?:src\/test\/kotlin\/[\w\/\-]+\.kt)/gi,
        // Dart/Flutter specific
        /(?:lib\/[\w\-]+\.dart)/gi,
        /(?:test\/[\w\-]+\.dart)/gi,
        // Vue specific
        /(?:src\/(?:components\/|views\/|pages\/)?[\w\-]+\.vue)/gi,
        // Svelte specific
        /(?:src\/(?:components\/|routes\/)?[\w\-]+\.svelte)/gi,
        // Angular specific
        /(?:src\/app\/[\w\-]+\.(?:component|service|module|directive|pipe)\.ts)/gi,
        /(?:src\/app\/[\w\-]+\.component\.(?:html|css|scss))/gi,
        // Generic patterns (catch-all)
        /(?:[\w\-]+\.(?:js|jsx|ts|tsx|css|scss|sass|less|html|py|java|cpp|c|php|rb|go|rs|swift|kt|dart|vue|svelte|astro|md|json|xml|yaml|yml|sh|bash|sql|dockerfile))/gi
      ];

      for (const pattern of pathPatterns) {
        const pathMatches = contextBefore.match(pattern);
        if (pathMatches && pathMatches.length > 0) {
          const filename = pathMatches[pathMatches.length - 1];

          // Check if the extension matches the language
          const fileExt = filename.split('.').pop()?.toLowerCase();

          if (fileExt) {
            // Enhanced language-extension matching for all frameworks
            const isValidExtension =
              fileExt === expectedExt ||
              // JavaScript variants
              (language === 'javascript' && ['js', 'mjs', 'cjs'].includes(fileExt)) ||
              (language === 'typescript' && ['ts', 'mts', 'cts'].includes(fileExt)) ||
              (language === 'jsx' && ['jsx', 'js'].includes(fileExt)) ||
              (language === 'tsx' && ['tsx', 'ts'].includes(fileExt)) ||
              // CSS variants
              (language === 'css' && ['css', 'scss', 'sass', 'less'].includes(fileExt)) ||
              // HTML variants
              (language === 'html' && ['html', 'htm', 'xhtml'].includes(fileExt)) ||
              // Python variants
              (language === 'python' && ['py', 'pyw', 'pyi'].includes(fileExt)) ||
              // Java variants
              (language === 'java' && ['java'].includes(fileExt)) ||
              // C/C++ variants
              (language === 'c' && ['c', 'h'].includes(fileExt)) ||
              (language === 'cpp' && ['cpp', 'cxx', 'cc', 'hpp', 'hxx', 'hh'].includes(fileExt)) ||
              // PHP variants
              (language === 'php' && ['php', 'phtml', 'php3', 'php4', 'php5'].includes(fileExt)) ||
              // Ruby variants
              (language === 'ruby' && ['rb', 'rbw'].includes(fileExt)) ||
              // Go variants
              (language === 'go' && ['go'].includes(fileExt)) ||
              // Rust variants
              (language === 'rust' && ['rs'].includes(fileExt)) ||
              // Swift variants
              (language === 'swift' && ['swift'].includes(fileExt)) ||
              // Kotlin variants
              (language === 'kotlin' && ['kt', 'kts'].includes(fileExt)) ||
              // Dart variants
              (language === 'dart' && ['dart'].includes(fileExt)) ||
              // Vue variants
              (language === 'vue' && ['vue'].includes(fileExt)) ||
              // Svelte variants
              (language === 'svelte' && ['svelte'].includes(fileExt)) ||
              // Shell variants
              (['shell', 'bash', 'sh'].includes(language) && ['sh', 'bash', 'zsh', 'fish'].includes(fileExt)) ||
              // Config/Data variants
              (language === 'json' && ['json', 'jsonc'].includes(fileExt)) ||
              (language === 'yaml' && ['yaml', 'yml'].includes(fileExt)) ||
              (language === 'xml' && ['xml', 'xsd', 'xsl'].includes(fileExt)) ||
              // Markdown variants
              (language === 'markdown' && ['md', 'markdown', 'mdown'].includes(fileExt)) ||
              // SQL variants
              (language === 'sql' && ['sql', 'mysql', 'pgsql', 'sqlite'].includes(fileExt)) ||
              // Docker variants
              (['dockerfile', 'docker'].includes(language) && ['dockerfile', 'containerfile'].includes(fileExt.toLowerCase()));

            if (isValidExtension) {
              return filename.trim();
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.warn('Error extracting filename from context:', error);
      return null;
    }
  };

  // Generate smart filename based on code content (fallback)
  const generateSmartFilename = (code: string, language: string): string | null => {
    try {
      // React/JSX component detection
      if (language === 'jsx' || language === 'tsx' || language === 'javascript' || language === 'typescript') {
        const componentMatch = code.match(/(?:export\s+default\s+|export\s+(?:const|function)\s+|function\s+|const\s+)([A-Z][a-zA-Z0-9]*)/);
        if (componentMatch) return componentMatch[1];

        const classMatch = code.match(/class\s+([A-Z][a-zA-Z0-9]*)/);
        if (classMatch) return classMatch[1];
      }

      // Vue component detection
      if (language === 'vue') {
        const nameMatch = code.match(/name:\s*['"`]([^'"`]+)['"`]/);
        if (nameMatch) return nameMatch[1];
      }

      // CSS class or ID detection
      if (language === 'css' || language === 'scss' || language === 'sass') {
        const classMatch = code.match(/\.([a-zA-Z][a-zA-Z0-9-_]*)/);
        if (classMatch) return classMatch[1];
      }

      // HTML title or main element
      if (language === 'html') {
        const titleMatch = code.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) return titleMatch[1].replace(/\s+/g, '-').toLowerCase();

        const h1Match = code.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (h1Match) return h1Match[1].replace(/\s+/g, '-').toLowerCase();
      }

      // Python class or function detection
      if (language === 'python') {
        const classMatch = code.match(/class\s+([A-Z][a-zA-Z0-9_]*)/);
        if (classMatch) return classMatch[1].toLowerCase();

        const funcMatch = code.match(/def\s+([a-zA-Z][a-zA-Z0-9_]*)/);
        if (funcMatch) return funcMatch[1];
      }

      return null;
    } catch (error) {
      console.warn('Error generating smart filename:', error);
      return null;
    }
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
      if (finalFilename.includes("<html") || finalFilename === "index.html") {
        finalFilename = "index.html";
      } else if (!finalFilename.startsWith('src/') && !finalFilename.startsWith('public/') && !finalFilename.startsWith('app/')) {
        // For other HTML files, assume they are components or views, often in src/ or app/
        finalFilename = `src/${finalFilename}`;
      }
    } else if (language === "css") {
      if (finalFilename === ".css" || finalFilename === "css" || !finalFilename.includes('.')) {
        finalFilename = "styles.css";
      } else if (!finalFilename.startsWith('src/') && !finalFilename.startsWith('public/') && !finalFilename.startsWith('styles/')) {
        finalFilename = `src/${finalFilename}`;
      }
    } else if (language === "javascript") {
      // If it's a common entry point or app file, standardize its path
      if ((finalFilename.includes("App") || finalFilename.includes("index") || finalFilename.includes("main")) && !finalFilename.startsWith('src/')) {
        finalFilename = `src/App.js`; // Standardize to src/App.js
      } else if (!finalFilename.startsWith('src/') && !finalFilename.startsWith('lib/') && !finalFilename.startsWith('public/')) {
        finalFilename = `src/${finalFilename}`;
      }
    } else if (language === "jsx" || language === "tsx") {
      // If the cleaned filename already has a valid path (e.g., 'src/App.jsx', 'components/Greeting.jsx')
      // or is a common root file, use it directly.
      if (finalFilename.startsWith('src/') || finalFilename.startsWith('components/')) {
        // Ensure it has the correct extension
        if (!finalFilename.endsWith(`.${expectedExt}`)) {
          finalFilename = `${finalFilename.split('.')[0]}.${expectedExt}`;
        }
      } else if (finalFilename.includes("App") || finalFilename.includes("index") || finalFilename.includes("main")) {
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
    } else if (language === "vue") {
      finalFilename = "src/App.vue";
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

  // Extract code blocks from messages and collect non-code text
  const codeBlocks = useMemo(() => {
    const blocks: CodeBlock[] = [];
    let nonCodeText = ''; // Collect all non-code text
    let shellCommands = ''; // Collect all .sh file contents
    const diffs: { path: string; diff: string }[] = [];

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

            // Handle .sh files specially - collect their content for README
            if (parsedContent.language === 'shell' || parsedContent.language === 'bash' || parsedContent.language === 'sh' || filename.endsWith('.sh')) {
              shellCommands += `\n${parsedContent.code.trim()}\n`;
              // Don't add .sh files to blocks, they'll go in README
            } else {
              blocks.push({
                language: parsedContent.language,
                code: parsedContent.code.trim(),
                filename,
                index: blocks.length, // Use blocks.length for sequential indexing
                messageId: message.id,
                isError: message.isError || false
              });
            }
            return; // Processed this message, move to the next
          }
        } catch (e) {
          // If parsing fails, it's likely not a JSON object, proceed to markdown parsing
          // console.log("Message content is not a valid JSON object, attempting markdown parsing.");
        }

        // If not JSON, try parsing as markdown code blocks with enhanced error handling
        const markdownCodeMatches = message.content.match(/```(\S*)(?:\s+(.*?))?\n([\s\S]*?)```/g) || [];

        markdownCodeMatches.forEach((match, blockIndex) => {
          try {
            const parsed = match.match(/```(\S*)(?:\s+(.*?))?\n([\s\S]*?)```/);
            if (!parsed || parsed.length < 4) return;

            let language = (parsed[1] || "text").toLowerCase().trim();
            const filenameHint = parsed[2] ? parsed[2].trim() : '';
            let code = parsed[3];

            // Validate code content
            if (!code || typeof code !== 'string' || !code.trim()) return;
            code = code.trim();

            // Map unified diff blocks to language=diff and filename from first header
            if (language === 'diff' || code.startsWith('*** Begin Diff') || code.startsWith('diff --git')) {
              language = 'diff';
            }

            // Enhanced filename generation with validation
            let filename = '';
            try {
              // First, try to extract filename from context before the code block
              const contextFilename = extractFilenameFromContext(message.content, match, language);

              if (contextFilename) {
                filename = contextFilename;
              } else if (filenameHint) {
                filename = cleanFilename(filenameHint, language, blocks.length);
              } else {
                // Generate smart default filename based on language and content
                const extension = getFileExtension(language);
                const baseName = generateSmartFilename(code, language) || `file-${blocks.length}`;
                filename = cleanFilename(`${baseName}.${extension}`, language, blocks.length);
              }

              // Ensure filename is valid and unique
              if (!filename || filename.length === 0) {
                filename = `file-${blocks.length}.${getFileExtension(language)}`;
              }

              // Check for duplicate filenames and append number if needed
              const existingFilenames = blocks.map(b => b.filename);
              let uniqueFilename = filename;
              let counter = 1;
              while (existingFilenames.includes(uniqueFilename)) {
                const parts = filename.split('.');
                if (parts.length > 1) {
                  const ext = parts.pop();
                  const base = parts.join('.');
                  uniqueFilename = `${base}-${counter}.${ext}`;
                } else {
                  uniqueFilename = `${filename}-${counter}`;
                }
                counter++;
              }
              filename = uniqueFilename;

            } catch (filenameError) {
              console.warn('Error processing filename:', filenameError);
              filename = `file-${blocks.length}.${getFileExtension(language)}`;
            }

            // Handle .sh files specially - collect their content for README
            if (language === 'shell' || language === 'bash' || language === 'sh' || filename.endsWith('.sh')) {
              shellCommands += `\n${code}\n`;
              // Don't add .sh files to blocks, they'll go in README
            } else {
              // If it's a diff, skip adding as a normal file block
              if (language === 'diff') {
                const targetPath = filenameHint || filename || '';
                diffs.push({ path: targetPath, diff: code });
                return;
              }
              blocks.push({
                language,
                code,
                filename,
                index: blocks.length, // Use blocks.length for sequential indexing
                messageId: message.id,
                isError: message.isError || false
              });
            }

          } catch (blockError) {
            console.warn('Error processing code block:', blockError);
            // Add fallback block with safe defaults
            const safeFilename = `file-${blocks.length}.txt`;
            blocks.push({
              language: 'text',
              code: match || 'Error processing code block',
              filename: safeFilename,
              index: blocks.length,
              messageId: message.id,
              isError: true
            });
          }
        });

        // Collect non-code text from this message
        const textWithoutCode = message.content.replace(/```[\s\S]*?```/g, '').trim();
        if (textWithoutCode.length > 50) { // Only include substantial text
          nonCodeText += `\n${textWithoutCode}\n`;
        }
      }
    });

    // Store collected data for use in README generation
    (blocks as any).nonCodeText = nonCodeText.trim();
    (blocks as any).shellCommands = shellCommands.trim();
    (blocks as any).diffs = diffs;

    return blocks;
  }, [messages]);

  // Reset selectedFileIndex when codeBlocks change
  useEffect(() => {
    if (codeBlocks.length === 0) {
      setSelectedFileIndex(0);
    } else if (selectedFileIndex >= codeBlocks.length) {
      setSelectedFileIndex(0);
    }
  }, [codeBlocks.length, selectedFileIndex]);

  // Generate project structure for complex projects
  useEffect(() => {
    if (codeBlocks.length > 0) { // Changed from > 1 to > 0 to handle single file projects
      let structure = analyzeProjectStructure(codeBlocks);
      // Apply any diffs captured in messages to the structure
      try {
        const diffs: { path: string; diff: string }[] = (codeBlocks as any).diffs || [];
        if (diffs.length > 0) {
          const filesCopy: { [key: string]: string } = { ...structure.files };
          for (const d of diffs) {
            const filePath = (d.path || '').trim();
            if (!filePath) continue;
            const original = filesCopy[filePath] || '';
            const applied = applySimpleLineDiff(original, d.diff);
            if (applied) {
              filesCopy[filePath] = applied;
            }
          }
          structure = { ...structure, files: filesCopy };
        }
      } catch {}
      setProjectStructure(structure);
    }
  }, [codeBlocks]);

  const applySimpleLineDiff = (originalContent: string, diffBlock: string): string => {
    try {
      // Extract only lines with prefixes from unified-like simple diff
      const lines = diffBlock
        .split('\n')
        .filter(l => /^(\+\s|\-\s|\s\s)/.test(l.trimStart()))
        .map(l => l.replace(/^\s+/, ''));
      if (lines.length === 0) return originalContent;
      const resultLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('+ ')) {
          resultLines.push(line.slice(2));
        } else if (line.startsWith('- ')) {
          // removed line: skip
          continue;
        } else if (line.startsWith('  ')) {
          resultLines.push(line.slice(2));
        }
      }
      const result = resultLines.join('\n');
      return result || originalContent;
    } catch (e) {
      console.warn('Failed to apply diff, returning original content');
      return originalContent;
    }
  };

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
            } else if (pkg.dependencies.nuxt || pkg.dependencies['@nuxt/core'] || pkg.dependencies['nuxt3']) {
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
            } else if (pkg.dependencies['@builder.io/qwik']) {
              framework = 'qwik';
            } else if (pkg.dependencies.gradio) {
              framework = 'gradio';
            } else if (pkg.dependencies.streamlit) {
              framework = 'streamlit';
            } else if (pkg.dependencies.flask || pkg.dependencies['Flask']) {
              framework = 'flask';
            } else if (pkg.dependencies.fastapi || pkg.dependencies['fastapi']) {
              framework = 'fastapi';
            } else if (pkg.dependencies.django || pkg.dependencies['Django']) {
              framework = 'django';
            } else if (pkg.dependencies.react) {
              framework = 'react';
            } else if (pkg.dependencies.vue || pkg.dependencies['@vue/core']) {
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
        } else if (ext === 'py' && (finalFilename.includes('gradio') || block.code.includes('import gradio'))) {
          framework = 'gradio';
        } else if (ext === 'py' && (finalFilename.includes('streamlit') || block.code.includes('import streamlit'))) {
          framework = 'streamlit';
        } else if (ext === 'py' && (finalFilename.includes('app.py') || block.code.includes('from flask import'))) {
          framework = 'flask';
        } else if (ext === 'py' && (finalFilename.includes('main.py') || block.code.includes('from fastapi import'))) {
          framework = 'fastapi';
        } else if (ext === 'py' && (finalFilename.includes('manage.py') || block.code.includes('django'))) {
          framework = 'django';
        } else if (finalFilename.includes('vite.config') || finalFilename.includes('vite.config.js') || finalFilename.includes('vite.config.ts')) {
          // If we see a vite config, it's likely a vite project
          if (framework === 'vanilla') framework = 'vite-react';
        }
      }

      // Detect package manager from lockfiles
      if (finalFilename === 'yarn.lock') packageManager = 'yarn';
      else if (finalFilename === 'pnpm-lock.yaml') packageManager = 'pnpm';
      else if (finalFilename === 'bun.lockb') packageManager = 'bun';
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

    // Get collected data from codeBlocks
    const nonCodeText = (codeBlocks as any).nonCodeText || '';
    const shellCommands = (codeBlocks as any).shellCommands || '';

    // Always add README
    const readme = `# Code Project

This project contains ${projectStructure ? Object.keys(projectStructure.files).length : codeBlocks.length} files.

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
${shellCommands ? `### Setup Commands:
\`\`\`bash
${shellCommands}
\`\`\`

### Instructions:
` : ''}Please review each file and follow the appropriate setup instructions for your programming language.

${nonCodeText ? `## Documentation:

${nonCodeText}

` : ''}Programmed on: ${new Date().toLocaleString()}
`
    zip.file("README.md", readme)

    const content = await zip.generateAsync({ type: "blob" })
    const url = URL.createObjectURL(content)
    const a = document.createElement("a")
    a.href = url
    a.download = `code-${Date.now()}.zip`
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
    const oldFilename = codeBlocks[index]?.filename

    // Update project structure if it exists
    if (projectStructure && oldFilename) {
      const newFiles = { ...projectStructure.files }

      if (newFiles[oldFilename]) {
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

  // Function to detect popular dependencies from code content (only used when package.json is missing)
  const getPopularDependencies = (codeContent: string, framework: string): Record<string, string> => {
    const deps: Record<string, string> = {};
    switch (framework) {
      case 'react':
      case 'next':
      case 'vite':
      case 'vite-react':
      case 'gatsby':
      case 'remix':
        deps['react'] = 'latest';
        deps['react-dom'] = 'latest';
        break;
      case 'vue':
      case 'nuxt':
        deps['vue'] = 'latest';
        break;
      case 'svelte':
        deps['svelte'] = 'latest';
        break;
      case 'solid':
        deps['solid-js'] = 'latest';
        break;
      default:
        break;
    }
    return deps;
  };

  const renderLivePreview = () => {
    // Enhanced framework support with better template mapping
    const getSandpackTemplate = (framework: string) => {
      switch (framework) {
        case 'react':
        case 'vite-react':
          return 'react';
        case 'next':
          return 'nextjs';
        case 'vue':
        case 'nuxt':
          return 'vue';
        case 'angular': return 'angular';
        case 'svelte': return 'svelte';
        case 'solid': return 'solid';
        case 'astro': return 'astro';
        case 'remix': return 'remix';
        case 'gatsby': return 'gatsby';
        case 'vite': return 'react';
        default: return 'vanilla';
      }
    };

    if (projectStructure && ['react', 'vue', 'angular', 'svelte', 'solid', 'next', 'nuxt', 'astro', 'remix', 'gatsby', 'vite'].includes(projectStructure.framework)) {
      try {
        // Map files to Sandpack format
        const sandpackFiles = Object.entries(projectStructure.files).reduce(
          (acc, [path, content]) => {
            // Skip empty or invalid files
            if (typeof content !== 'string' || !content.trim()) return acc;

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
                sandpackFiles['/index.html'] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/src/index.js"></script>
  </body>
</html>`
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
                sandpackFiles['/src/main.js'] = {
                  code: `import { createApp } from 'vue';
import App from './App.vue';
createApp(App).mount('#app');`
                };
                sandpackFiles['/index.html'] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`
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
                sandpackFiles['/src/main.js'] = {
                  code: `import App from './App.svelte';
const app = new App({ target: document.getElementById('app') });
export default app;`
                };
                sandpackFiles['/index.html'] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>`
                };
                break;
              default:
                sandpackFiles['/src/index.js'] = {
                  code: `console.log('Hello from ${projectStructure.framework}!');`
                };
                sandpackFiles['/index.html'] = {
                  code: `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/src/index.js"></script>
  </body>
</html>`
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
                }, {} as Record<string, string>) || getPopularDependencies(Object.values(projectStructure.files).join('\n'), projectStructure.framework),
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

  useEffect(() => {
    if (isOpen && messages.length > 0) {
      // Extract project structure from messages
      const projectMessages = messages
        .filter(msg => msg.role === 'assistant')
        .filter(msg => {
          const content = typeof msg.content === 'string' ? msg.content : '';
          return content.includes('```json') && content.includes('"files"');
        });

      if (projectMessages.length > 0) {
        const lastProjectMessage = projectMessages[projectMessages.length - 1];
        const content = typeof lastProjectMessage.content === 'string' ? lastProjectMessage.content : '';
        const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        
        if (jsonMatch) {
          try {
            const projectData = JSON.parse(jsonMatch[1]);
            setProjectStructure(projectData);
          } catch (error) {
            console.error('Error parsing project structure:', error);
          }
        }
      }

      // Apply diffs from messages
      const diffBlocks = messages
        .filter(msg => msg.role === 'assistant')
        .flatMap(msg => {
          const content = typeof msg.content === 'string' ? msg.content : '';
          const diffMatches = content.match(/```diff\s+([^\n]+)\s*\n([\s\S]*?)```/g);
          return diffMatches?.map(match => {
            const [, path, diff] = match.match(/```diff\s+([^\n]+)\s*\n([\s\S]*?)```/) || [];
            return { path, diff };
          }) || [];
        })
        .filter(Boolean);

      if (diffBlocks.length > 0 && projectStructure) {
        const newProjectStructure = { ...projectStructure };
        
        for (const { path, diff } of diffBlocks) {
          try {
            // Parse unified diff and apply patch
            const unifiedDiff = `--- ${path}\n+++ ${path}\n${diff}`;
            const parsedDiff = parsePatch(unifiedDiff);
            
            if (parsedDiff.length > 0) {
              const currentContent = newProjectStructure.files[path] || '';
              const patchedContent = applyPatch(currentContent, parsedDiff[0]);
              
              if (patchedContent !== false) {
                newProjectStructure.files[path] = patchedContent;
              } else {
                throw new Error(`Failed to apply patch to ${path}`);
              }
            }
          } catch (error) {
            console.error(`Error applying diff to ${path}:`, error);
            setDiffErrors(prev => [...prev, `Failed to apply diff to ${path}: ${(error as Error).message}`]);
          }
        }
        
        setProjectStructure(newProjectStructure);
      }
    }
  }, [messages, projectStructure, isOpen]);

  // Clear diff errors when closing
  useEffect(() => {
    if (!isOpen) {
      setDiffErrors([]);
    }
  }, [isOpen]);

  const handleApplyDiff = () => {
    if (!diffContent.trim() || !selectedFile || !projectStructure) return;

    try {
      const unifiedDiff = `--- ${selectedFile}\n+++ ${selectedFile}\n${diffContent}`;
      const parsedDiff = parsePatch(unifiedDiff);
      
      if (parsedDiff.length > 0) {
        const currentContent = projectStructure.files[selectedFile] || '';
        const patchedContent = applyPatch(currentContent, parsedDiff[0]);
        
        if (patchedContent !== false) {
          const newProjectStructure = { ...projectStructure };
          newProjectStructure.files[selectedFile] = patchedContent;
          setProjectStructure(newProjectStructure);
          setDiffContent('');
          setDiffErrors([]);
        } else {
          throw new Error('Failed to apply patch');
        }
      }
    } catch (error) {
      console.error('Error applying diff:', error);
      setDiffErrors(prev => [...prev, `Failed to apply diff: ${(error as Error).message}`]);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key={isOpen ? 'visible' : 'hidden'}
          initial={{ opacity: 0, x: '100%' }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: '100%' }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="fixed top-0 h-full bg-black/20 backdrop-blur-2xl border border-white/10 z-[100] overflow-hidden shadow-2xl
                     md:right-0 md:rounded-l-xl md:left-auto
                     left-0 right-0 rounded-none"
          style={{
            width: `min(100vw, ${panelWidth}px)`
          }}
        >
          {/* Resize Handle - Hidden on mobile */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 bg-white/20 cursor-ew-resize hover:bg-white/30 transition-all duration-200 hidden md:block"
            onMouseDown={handleMouseDown}
          />

          <Card className="h-full bg-transparent border-0 rounded-none">
            <CardHeader className="border-b border-white/10 bg-black/20 px-3 md:px-6">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-white flex items-center gap-2 text-sm md:text-base">
                  <CodeIcon className="w-4 h-4 md:w-5 md:h-5" />
                  <span className="hidden sm:inline">Code Preview Panel</span>
                  <span className="sm:hidden">Code</span>
                  <span className="bg-gray-700 text-gray-300 rounded-full px-2 py-0.5 text-xs">
                    {codeBlocks.length}
                  </span>
                </CardTitle>
                <div className="flex items-center gap-1 md:gap-2">
                  <button
                    onClick={downloadAsZip}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center"
                  >
                    <Package className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Download ZIP</span>
                    <span className="sm:hidden">ZIP</span>
                  </button>
                  {projectStructure && (
                    <button
                      onClick={() => {
                        localStorage.setItem('visualEditorProject', JSON.stringify(projectStructure));
                        window.open('/visual-editor', '_blank');
                      }}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-2 md:px-3 py-1.5 rounded text-xs md:text-sm flex items-center"
                    >
                      <Edit className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                      <span className="hidden sm:inline">Edit</span>
                      <span className="sm:hidden">Edit</span>
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="border border-gray-300 hover:bg-gray-700 text-gray-300 px-2 md:px-3 py-1.5 rounded text-xs md:text-sm min-w-[44px]"
                  >
                    Close
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0 h-full">
              <Tabs value={selectedTab} onValueChange={setSelectedTab} className="h-full">
                <TabsList className="grid w-full grid-cols-3 bg-black/40 border-b border-white/10 px-2 md:px-4">
                  <TabsTrigger value="preview" className="text-white text-xs md:text-sm">
                    <Eye className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Live Preview</span>
                    <span className="sm:hidden">Preview</span>
                  </TabsTrigger>
                  <TabsTrigger value="files" className="text-white text-xs md:text-sm">
                    <FileText className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Files</span>
                    <span className="sm:hidden">Files</span>
                  </TabsTrigger>
                  <TabsTrigger value="structure" className="text-white text-xs md:text-sm">
                    <Package className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                    <span className="hidden sm:inline">Project</span>
                    <span className="sm:hidden">Project</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="preview" className="p-2 md:p-4 h-full">
                  {renderLivePreview()}
                </TabsContent>

                {detectedFramework !== 'vanilla' && (
                  <TabsContent value="sandpack" className="p-0 h-full">
                    {renderLivePreview()}
                  </TabsContent>
                )}

                <TabsContent value="files" className="p-0 h-full">
                  <div className="flex h-full flex-col md:flex-row">
                    <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-white/10 bg-black/30 overflow-y-auto max-h-48 md:max-h-none">
                      <div className="p-2 md:p-4">
                        <h3 className="text-sm font-medium text-gray-300 mb-2">Files</h3>
                        <div className="space-y-1">
                          {codeBlocks.map((block, index) => (
                            <div
                              className={`flex items-center w-full justify-between p-2 group ${selectedFileIndex === index ? 'bg-gray-700' : 'hover:bg-gray-800'
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
                          {codeBlocks[selectedFileIndex] ? (
                            <>
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
                            </>
                          ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-400">
                              <p>No code block selected</p>
                            </div>
                          )}
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
