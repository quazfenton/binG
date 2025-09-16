/**
 * Code Parser Module
 *
 * Centralizes code block extraction and filename parsing logic.
 * This module provides reusable functions for parsing code blocks from messages,
 * extracting filenames, and generating intelligent file names.
 */

import type { Message } from "../types/index";
import { createInputContext, processSafeContent } from "./input-response-separator";

export interface CodeBlock {
  language: string;
  code: string;
  filename?: string;
  index: number;
  messageId: string;
  isError?: boolean;
}

export interface ParsedCodeData {
  codeBlocks: CodeBlock[];
  projectStructure: {
    name: string;
    files: { [key: string]: string };
    dependencies?: string[];
    devDependencies?: string[];
    scripts?: { [key: string]: string };
    framework: string;
    bundler?: string;
    packageManager?: string;
  } | null;
}

/**
 * Extract filename from various contexts in the code block
 */
export function extractFilenameFromContext(
  code: string,
  language: string,
): string | undefined {
  // Try to extract filename from code comments
  const commentPatterns = [
    /\/\/\s*(?:file:|filename:)\s*([^\n\r]+)/i,
    /\/\*\s*(?:file:|filename:)\s*([^*]+)\*\//i,
    /#\s*(?:file:|filename:)\s*([^\n\r]+)/i,
    /<!--\s*(?:file:|filename:)\s*([^>]+)-->/i,
  ];

  for (const pattern of commentPatterns) {
    const match = code.match(pattern);
    if (match) {
      return cleanFilename(match[1].trim());
    }
  }

  // Try to extract from import/export statements
  const importPatterns = [
    /from\s+['"]\.\/([^'"]+)['"]/g,
    /import\s+['"]\.\/([^'"]+)['"]/g,
    /require\(['"]\.\/([^'"]+)['"]\)/g,
  ];

  for (const pattern of importPatterns) {
    const match = code.match(pattern);
    if (match) {
      return cleanFilename(match[1]);
    }
  }

  // Try to extract from class/function names for certain languages
  if (language === "javascript" || language === "typescript") {
    const classMatch = code.match(/export\s+(?:default\s+)?class\s+(\w+)/);
    if (classMatch) {
      return `${classMatch[1].toLowerCase()}.${language === "typescript" ? "ts" : "js"}`;
    }

    const componentMatch = code.match(
      /(?:export\s+)?(?:const|function)\s+(\w+)\s*(?:\(|=)/,
    );
    if (componentMatch && componentMatch[1].match(/^[A-Z]/)) {
      return `${componentMatch[1]}.${language === "typescript" ? "tsx" : "jsx"}`;
    }
  }

  return undefined;
}

/**
 * Generate smart filename based on code content and language
 */
export function generateSmartFilename(
  code: string,
  language: string,
  index: number,
): string {
  const extension = getFileExtension(language);

  // Check for specific patterns that suggest file types
  if (language === "json") {
    if (code.includes('"scripts"') && code.includes('"dependencies"')) {
      return "package.json";
    }
    if (code.includes('"compilerOptions"')) {
      return "tsconfig.json";
    }
    if (code.includes('"extends"') || code.includes('"rules"')) {
      return ".eslintrc.json";
    }
  }

  if (language === "html") {
    if (code.includes("<html") || code.includes("<!DOCTYPE")) {
      return "index.html";
    }
  }

  if (language === "css" || language === "scss" || language === "sass") {
    if (
      code.includes("@import") ||
      code.includes("body") ||
      code.includes("html")
    ) {
      return `styles.${extension}`;
    }
  }

  // For JavaScript/TypeScript, try to determine file type
  if (language === "javascript" || language === "typescript") {
    if (code.includes("export default") || code.includes("export {")) {
      // Check for React components
      if (
        code.includes("React") ||
        code.includes("jsx") ||
        code.includes("<")
      ) {
        return `Component.${language === "typescript" ? "tsx" : "jsx"}`;
      }
      return `module.${extension}`;
    }

    if (code.includes("import") && code.includes("from")) {
      return `index.${extension}`;
    }
  }

  // For Python
  if (language === "python") {
    if (code.includes('if __name__ == "__main__"')) {
      return "main.py";
    }
    if (code.includes("class ")) {
      const classMatch = code.match(/class\s+(\w+)/);
      if (classMatch) {
        return `${classMatch[1].toLowerCase()}.py`;
      }
    }
    if (code.includes("def ")) {
      const funcMatch = code.match(/def\s+(\w+)/);
      if (funcMatch && funcMatch[1] !== "__init__") {
        return `${funcMatch[1]}.py`;
      }
    }
  }

  // Fallback to generic filename
  return `file${index + 1}.${extension}`;
}

/**
 * Clean and validate filename
 */
export function cleanFilename(filename: string): string {
  // Remove any path separators and clean the filename
  return filename
    .replace(/[\/\\]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .trim()
    .replace(/\s+/g, "_");
}

/**
 * Get file extension based on language
 */
export function getFileExtension(language: string): string {
  const extensions: Record<string, string> = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    java: "java",
    cpp: "cpp",
    c: "c",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    json: "json",
    xml: "xml",
    sql: "sql",
    jsx: "jsx",
    tsx: "tsx",
    php: "php",
    vue: "vue",
    svelte: "svelte",
    go: "go",
    rust: "rs",
    kotlin: "kt",
    swift: "swift",
    bash: "sh",
    shell: "sh",
    zsh: "zsh",
    dockerfile: "Dockerfile",
    yaml: "yml",
    yml: "yml",
    markdown: "md",
    md: "md",
    txt: "txt",
    conf: "conf",
    ini: "ini",
    toml: "toml",
    env: "env",
  };

  return extensions[language.toLowerCase()] || "txt";
}

/**
 * Extract code blocks from messages with enhanced parsing (respects input/response context)
 */
export function extractCodeBlocksFromMessages(
  messages: Message[],
): CodeBlock[] {
  const codeBlocks: CodeBlock[] = [];
  let globalIndex = 0;

  messages.forEach((message) => {
    if (message.content) {
      // Create context for the message
      const messageContext = createInputContext(message.role);
      
      // Only process code blocks from assistant messages for file operations
      if (message.role === "assistant") {
        // Enhanced regex to capture code blocks with optional language and filename
        const codeBlockRegex =
          /```(?:([a-zA-Z0-9+\-_.]+)(?:\s+(.+?))?)?\n([\s\S]*?)```/g;
        let match;

        while ((match = codeBlockRegex.exec(message.content)) !== null) {
          const [, detectedLanguage = "text", possibleFilename, code] = match;
          const language = detectedLanguage.toLowerCase();

          // Try to extract filename from various sources
          let filename = possibleFilename
            ? cleanFilename(possibleFilename)
            : undefined;

          if (!filename) {
            filename = extractFilenameFromContext(code, language);
          }

          if (!filename) {
            filename = generateSmartFilename(code, language, globalIndex);
          }

          // Check if this might be an error block
          const isError =
            code.toLowerCase().includes("error") ||
            code.toLowerCase().includes("exception") ||
            language === "error";

          codeBlocks.push({
            language,
            code: code.trim(),
            filename,
            index: globalIndex,
            messageId: message.id,
            isError,
          });

          globalIndex++;
        }
      }
    }
  });

  return codeBlocks;
}

/**
 * Detect project framework based on code blocks
 */
export function detectProjectFramework(codeBlocks: CodeBlock[]): string {
  const frameworks = {
    react: 0,
    vue: 0,
    angular: 0,
    svelte: 0,
    next: 0,
    nuxt: 0,
    gatsby: 0,
    vite: 0,
    astro: 0,
    remix: 0,
    qwik: 0,
    vanilla: 0,
  };

  codeBlocks.forEach((block) => {
    const code = block.code.toLowerCase();

    // React indicators
    if (
      code.includes("react") ||
      code.includes("jsx") ||
      block.language === "jsx" ||
      block.language === "tsx"
    ) {
      frameworks.react += 2;
    }

    if (
      code.includes("next") ||
      code.includes("next.js") ||
      block.filename?.includes("next.config")
    ) {
      frameworks.next += 3;
    }

    // Vue indicators
    if (
      code.includes("vue") ||
      block.language === "vue" ||
      code.includes("<template>")
    ) {
      frameworks.vue += 2;
    }

    if (code.includes("nuxt") || block.filename?.includes("nuxt.config")) {
      frameworks.nuxt += 3;
    }

    // Angular indicators
    if (
      code.includes("@angular") ||
      code.includes("@component") ||
      code.includes("angular")
    ) {
      frameworks.angular += 2;
    }

    // Svelte indicators
    if (code.includes("svelte") || block.language === "svelte") {
      frameworks.svelte += 2;
    }

    // Other frameworks
    if (code.includes("gatsby") || block.filename?.includes("gatsby-config")) {
      frameworks.gatsby += 3;
    }

    if (code.includes("vite") || block.filename?.includes("vite.config")) {
      frameworks.vite += 2;
    }

    if (code.includes("astro") || block.filename?.includes("astro.config")) {
      frameworks.astro += 3;
    }

    if (code.includes("remix") || block.filename?.includes("remix.config")) {
      frameworks.remix += 3;
    }

    if (code.includes("qwik")) {
      frameworks.qwik += 2;
    }
  });

  // Find the framework with the highest score
  const detectedFramework = Object.entries(frameworks).reduce((a, b) =>
    frameworks[a[0] as keyof typeof frameworks] >
    frameworks[b[0] as keyof typeof frameworks]
      ? a
      : b,
  )[0];

  return frameworks[detectedFramework as keyof typeof frameworks] > 0
    ? detectedFramework
    : "vanilla";
}

/**
 * Create project structure from code blocks
 */
export function createProjectStructure(
  codeBlocks: CodeBlock[],
): ParsedCodeData["projectStructure"] {
  if (codeBlocks.length === 0) return null;

  const files: { [key: string]: string } = {};
  let dependencies: string[] = [];
  let devDependencies: string[] = [];
  let scripts: { [key: string]: string } = {};

  codeBlocks.forEach((block) => {
    if (block.filename && !block.isError) {
      files[block.filename] = block.code;

      // Extract dependencies from package.json
      if (block.filename === "package.json" && block.language === "json") {
        try {
          const packageJson = JSON.parse(block.code);
          dependencies = Object.keys(packageJson.dependencies || {});
          devDependencies = Object.keys(packageJson.devDependencies || {});
          scripts = packageJson.scripts || {};
        } catch (e) {
          // Invalid JSON, skip
        }
      }
    }
  });

  const framework = detectProjectFramework(codeBlocks);

  return {
    name: "Generated Project",
    files,
    dependencies,
    devDependencies,
    scripts,
    framework,
    bundler:
      framework === "next"
        ? "webpack"
        : framework === "vite"
          ? "vite"
          : undefined,
    packageManager: "npm",
  };
}

/**
 * Main export function that combines all parsing logic
 */
export function parseCodeBlocksFromMessages(
  messages: Message[],
): ParsedCodeData {
  const codeBlocks = extractCodeBlocksFromMessages(messages);
  const projectStructure = createProjectStructure(codeBlocks);

  return {
    codeBlocks,
    projectStructure,
  };
}
