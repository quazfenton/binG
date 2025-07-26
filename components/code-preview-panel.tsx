"use client"

import * as React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { 
  Code as CodeIcon,
  FileText,
  Package,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertCircle,
  Eye,
  Edit
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
  framework: 'react' | 'vue' | 'angular' | 'vanilla'
}

export default function CodePreviewPanel({ messages, isOpen, onClose }: CodePreviewPanelProps) {
  const [detectedFramework, setDetectedFramework] = useState<'react'|'vue'|'vanilla'>('vanilla');
  const [selectedTab, setSelectedTab] = useState("preview")
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [projectStructure, setProjectStructure] = useState<ProjectStructure | null>(null)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

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
            blocks.push({
              language: parsedContent.language,
              code: parsedContent.code.trim(),
              // Use provided filename, or generate a default if missing or empty
              filename: parsedContent.filename ? parsedContent.filename.trim() : `file-${message.id}-${blocks.length}.${getFileExtension(parsedContent.language)}`,
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

          // Extract filename from hint or generate default
          const filename = filenameHint && filenameHint.match(/\S+\.\S+$/)
            ? filenameHint
            : `file-${message.id}-${blocks.length}.${getFileExtension(language)}`; // Use blocks.length for index

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
    if (codeBlocks.length > 1) {
      const structure = analyzeProjectStructure(codeBlocks);
      setProjectStructure(structure);
    }
  }, [codeBlocks]);

  const analyzeProjectStructure = (blocks: CodeBlock[]): ProjectStructure => {
    const files: { [key: string]: string } = {};
    const dependencies: string[] = [];
    let framework: 'react' | 'vue' | 'angular' | 'vanilla' = 'vanilla';
    
    for (const block of blocks) {
      // Skip empty files first
      if (!block.code.trim()) {
        continue;
      }

      let finalFilename = block.filename; // Start with the filename from the block

      // If the filename is a generic placeholder, try to infer a better one.
      // Otherwise, keep the provided filename.
      if (!finalFilename || finalFilename.startsWith('file-')) {
        if (block.language === "html" && block.code.includes("<html")) {
          finalFilename = "index.html";
        } else if (block.language === "css") {
          finalFilename = "styles.css";
        } else if (block.language === "javascript") {
          finalFilename = "script.js";
        } else if (block.language === "json" && block.code.includes("\"name\"") && block.code.includes("\"version\"")) {
          finalFilename = "package.json";
        } else if (block.language === "jsx" || block.language === "tsx") {
          // For React components
          finalFilename = "src/App." + (block.language === "jsx" ? "jsx" : "tsx");
        } else if (block.language === "vue") {
          finalFilename = "src/App.vue";
        } else if (block.language === "typescript" && block.code.includes("@Component")) {
          // For Angular components
          finalFilename = "src/app/app.component.ts";
        } else if (block.language === "shell" || block.language === "bash") {
          finalFilename = `script-${block.index}.sh`;
        } else {
          // If no specific inference, use the original filename or generate a default.
          finalFilename = finalFilename || `file-${block.index}.${getFileExtension(block.language)}`;
        }
      }
      
      // Clean up filenames - remove any special characters and comments
      finalFilename = finalFilename
        .replace(/^[\/\\]+/, '') // Remove leading slashes/backslashes
        .replace(/^[\/\\]{2,}\s*/, '') // Remove leading comment slashes
        .replace(/^#\s*/, '') // Remove leading # comments
        .replace(/^\/\*\s*|\s*\*\/$/, '') // Remove block comments
        .replace(/^\s+|\s+$/, '') // Trim whitespace
        .replace(/[^a-zA-Z0-9_\-.\/\\]/g, '_') // Replace special characters
        .replace(/(\.\.\/|\.\/)+/g, '') // Remove relative paths
        .trim();

      // Ensure a filename is always set, even if it's a default one.
      if (!finalFilename) {
           finalFilename = `file-${block.index}.${getFileExtension(block.language)}`;
      }
      
      files[finalFilename] = block.code
      
      // Extract dependencies
      if (block.language === "json" && finalFilename === "package.json") {
        try {
          const pkg = JSON.parse(block.code)
          if (pkg.dependencies) {
            dependencies.push(...Object.keys(pkg.dependencies))
            
            // Detect framework based on dependencies
            if (pkg.dependencies.react) {
              framework = 'react';
            } else if (pkg.dependencies.vue) {
              framework = 'vue';
            } else if (pkg.dependencies['@angular/core']) {
              framework = 'angular';
            }
          }
        } catch (e) {
          console.warn("Failed to parse package.json")
        }
      }
      
      // Detect framework based on file extensions
      if (framework === 'vanilla') {
        const ext = getFileExtension(block.language);
        if (ext === 'jsx' || ext === 'tsx') {
          framework = 'react';
        } else if (ext === 'vue') {
          framework = 'vue';
        } else if (ext === 'ts' && finalFilename.includes('.component.')) {
          framework = 'angular';
        }
      }
    }
    
    const structure = {
      name: "Generated Project",
      files,
      dependencies: dependencies.length > 0 ? dependencies : undefined,
      framework
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

  const renderLivePreview = () => {
    if (projectStructure?.framework === 'react' ||
        projectStructure?.framework === 'vue' ||
        projectStructure?.framework === 'angular') {
      try {
        // Map files to Sandpack format
        const sandpackFiles = Object.entries(projectStructure.files).reduce(
          (acc, [path, content]) => {
            // Skip empty files
            if (!content.trim()) return acc;
            
            // Normalize paths
            let normalizedPath = path
              .replace(/^[\/\\]+/, '')
              .replace(/^[\/\\]{2,}\s*/, '')
              .replace(/^#\s*/, '')
              .replace(/^\/\*\s*|\s*\*\/$/, '')
              .replace(/^\s+|\s+$/, '')
              .replace(/[^a-zA-Z0-9_\-.\/\\]/g, '_')
              .replace(/(\.\.\/|\.\/)+/g, '')
              .trim();
            
            // Ensure src/ prefix for framework projects
            if (!normalizedPath.startsWith('src/') && !normalizedPath.startsWith('app/')) {
              normalizedPath = `src/${normalizedPath}`;
            }
            acc[`/${normalizedPath}`] = { code: content };
            return acc;
          },
          {} as Record<string, { code: string }>
        );

        // Add entry file if missing
        if (!sandpackFiles['/src/index.js'] && !sandpackFiles['/src/main.js']) {
          sandpackFiles['/src/index.js'] = {
            code: "console.log('Hello from Sandpack!');"
          };
        }

        return (
          <div className="h-96">
            <Sandpack
              template={projectStructure.framework}
              theme="dark"
              options={{
                showTabs: true,
                showLineNumbers: true,
                showNavigator: true,
                showConsole: true,
              }}
              files={sandpackFiles}
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
                Error: {(error as Error).message}
              </p>
            </div>
          </div>
        );
      }
    }


    try {
      const htmlFile = codeBlocks.find(block => block.language === "html")
      const cssFile = codeBlocks.find(block => block.language === "css")
      const jsFile = codeBlocks.find(block => block.language === "javascript")
      
      if (!htmlFile) {
        return (
          <div className="flex items-center justify-center h-96 bg-gray-900 rounded-lg">
            <div className="text-center">
              <CodeIcon className="w-16 h-16 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-400">No HTML code found for live preview</p>
              <p className="text-sm text-gray-600 mt-2">Add HTML code to enable live preview</p>
            </div>
          </div>
        )
      }
      
      // Create complete HTML document
      const combinedHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Live Preview</title>
  ${cssFile ? `<style>${cssFile.code}</style>` : ''}
</head>
<body>
  ${htmlFile.code}
  ${jsFile ? `<script>${jsFile.code}</script>` : ''}
</body>
</html>
`
      return (
        <div className="relative">
          <div className="absolute top-2 right-2 z-10">
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
            sandbox="allow-scripts allow-scripts allow-same-origin"
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
          className="fixed right-0 top-0 w-1/2 h-full bg-black/20 backdrop-blur-2xl border border-white/10 rounded-l-xl z-[100] overflow-hidden shadow-2xl"
        >
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
                            className={`flex items-center w-full justify-start p-2 cursor-pointer ${
                              selectedFileIndex === index ? 'bg-gray-700' : 'hover:bg-gray-800'
                            }`}
                            key={index}
                            onClick={() => setSelectedFileIndex(index)}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            <span className="truncate">{block.filename}</span>
                            {block.isError && (
                              <span className="ml-auto text-red-500">
                                <AlertCircle className="w-4 h-4" />
                              </span>
                            )}
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
