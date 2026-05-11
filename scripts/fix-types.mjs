import fs from 'fs';
import path from 'path';

const TYPE_FIXES = [
  // 1. ToolExecutionResult Enhancement
  {
    file: 'web/lib/tools/tool-integration/types.ts',
    replaces: [
      { 
        old: 'export interface ToolExecutionResult {', 
        new: 'export interface ToolExecutionResult {\n  success?: boolean;\n  output?: string;\n  error?: string;\n  authRequired?: boolean;\n  authUrl?: string;' 
      }
    ]
  },
  // 2. Tambo ToolExecutionResult
  {
    file: 'web/lib/tambo/tambo-tools.ts',
    replaces: [
      { 
        old: 'export interface ToolExecutionResult {', 
        new: 'export interface ToolExecutionResult {\n  success?: boolean;\n  output?: string;\n  error?: string;\n  authRequired?: boolean;\n  authUrl?: string;' 
      }
    ]
  },
  // 3. BashToolExecutionResult
  {
    file: 'web/lib/orchestra/mastra/tools/filesystem-tools.ts',
    replaces: [
      {
        old: 'export interface BashToolExecutionResult {',
        new: 'export interface BashToolExecutionResult {\n  success?: boolean;\n  output?: string;\n  error?: string;'
      }
    ]
  }
];

TYPE_FIXES.forEach(f => {
  const filePath = path.resolve(process.cwd(), f.file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  
  f.replaces.forEach(r => {
    if (content.includes(r.old) && !content.includes('success?: boolean')) {
        content = content.replace(r.old, r.new);
    }
  });
  
  if (content !== original) {
    fs.writeFileSync(filePath, content);
    console.log(`FIXED TYPES: ${f.file}`);
  }
});
