"use client"

import * as React from 'react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Badge } from '../components/ui/badge';
import { 
  Code as CodeIcon,
  FileText,
  Package,
  Maximize2,
  Minimize2,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import JSZip from 'jszip';
import type { Message } from '../types/index';

interface CodePreviewPanelProps {
  messages: Message[]
  isOpen: boolean
  onClose: () => void
  onRetry: (messageId: string) => void
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
}

export default function CodePreviewPanel({ messages, isOpen, onClose, onRetry }: CodePreviewPanelProps) {
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
    console.log("CodePreviewPanel messages:", messages);
    const blocks: CodeBlock[] = [];
    messages.forEach((message) => {
      if (message.role === "assistant") {
        const codeMatches = message.content.match(/```(\S*)\s*\n([\s\S]*?)```/g) || [];
        codeMatches.forEach((match, blockIndex) => {
          const languageMatch = match.match(/```(\S*)\s*\n/);
          const language = languageMatch?.[1] || "text";
          const code = match.replace(/```\S*\s*\n?/, '').replace(/```$/, '').trim();
          
          blocks.push({
            language,
            code,
            filename: `file-${message.id}-${blockIndex}.${getFileExtension(language)}`,
            index: blocks.length,
            messageId: message.id,
            isError: message.isError
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
    
    blocks.forEach((block) => {
      // Create meaningful filenames based on content
      let filename = block.filename || `file-${block.index}.${getFileExtension(block.language)}`
      
      // Analyze content for better naming
      if (block.language === "html" && block.code.includes("<html")) {
        filename = "index.html"
      } else if (block.language === "css" && block.code.includes("body") || block.code.includes("*")) {
        filename = "styles.css"
      } else if (block.language === "javascript" && block.code.includes("function main") || block.code.includes("console.log")) {
        filename = "main.js"
      } else if (block.language === "json" && block.code.includes("\"name\"") && block.code.includes("\"version\"")) {
        filename = "package.json"
      }
      
      files[filename] = block.code
      
      // Extract dependencies
      if (block.language === "json" && filename === "package.json") {
        try {
          const pkg = JSON.parse(block.code)
          if (pkg.dependencies) {
            dependencies.push(...Object.keys(pkg.dependencies))
          }
        } catch (e) {
          console.warn("Failed to parse package.json")
        }
      }
    })
    
    return {
      name: "Generated Project",
      files,
      dependencies: dependencies.length > 0 ? dependencies : undefined
    }
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsFullscreen(!isFullscreen)}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
        <iframe
          ref={iframeRef}
          srcDoc={combinedHtml}
          className={`w-full bg-white rounded-lg border ${isFullscreen ? 'h-screen' : 'h-96'}`}
          title="Live Preview"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    )
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 300 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 300 }}
        transition={{ duration: 0.3 }}
        className="fixed right-0 top-0 w-1/2 h-full bg-gray-900 border-l border-gray-700 z-50 overflow-hidden"
      >
        <Card className="h-full bg-gray-900 border-0 rounded-none">
          <CardHeader className="border-b border-gray-700">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <CodeIcon className="w-5 h-5" />
                Code Preview Panel
                <Badge variant="secondary">{codeBlocks.length} file(s)</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={downloadAsZip}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Package className="w-4 h-4 mr-2" />
                  Download ZIP
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onClose}
                >
                  Close
                </Button>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="p-0 h-full">
            <Tabs value={selectedTab} onValueChange={setSelectedTab} className="h-full">
              <TabsList className="grid w-full grid-cols-3 bg-gray-800 border-b border-gray-700">
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
              
              <TabsContent value="files" className="p-0 h-full">
                <div className="flex h-full">
                  <div className="w-64 border-r border-gray-700 bg-gray-800 overflow-y-auto">
                    <div className="p-4">
                      <h3 className="text-sm font-medium text-gray-300 mb-2">Files</h3>
                      <div className="space-y-1">
                        {codeBlocks.map((block, index) => (
                          <Button
                            key={index}
                            variant={selectedFileIndex === index ? "secondary" : "ghost"}
                            className={`w-full justify-start ${selectedFileIndex === index ? 'bg-gray-700' : ''}`}
                            onClick={() => setSelectedFileIndex(index)}
                          >
                            <FileText className="w-4 h-4 mr-2" />
                            <span className="truncate">{block.filename}</span>
                            {block.isError && (
                              <span className="ml-auto text-red-500">
                                <AlertCircle className="w-4 h-4" />
                              </span>
                            )}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto">
                    {codeBlocks.length > 0 && selectedFileIndex !== null && (
                      <div className="h-full flex flex-col">
                        <div className="p-4 border-b border-gray-700 bg-gray-800 flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{codeBlocks[selectedFileIndex].language}</Badge>
                            <span className="text-sm font-mono text-gray-300">{codeBlocks[selectedFileIndex].filename}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {codeBlocks[selectedFileIndex].isError && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onRetry(codeBlocks[selectedFileIndex].messageId)}
                                className="text-red-500 hover:text-red-400"
                              >
                                <RefreshCw className="w-4 h-4 mr-1" />
                                Retry
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                navigator.clipboard.writeText(codeBlocks[selectedFileIndex].code)
                              }}
                            >
                              <CodeIcon className="w-4 h-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto bg-gray-900">
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
                      <div className="bg-gray-800 rounded-lg p-4">
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
                            <Badge key={dep} variant="secondary">{dep}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <h4 className="text-md font-medium text-white mb-2">Setup Instructions</h4>
                      <div className="bg-gray-800 rounded-lg p-4">
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
    </AnimatePresence>
  )
}
