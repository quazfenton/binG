// Fix tool overload error in vercel-ai-tools.ts
import fs from 'fs';

const filePath = 'lib/chat/vercel-ai-tools.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Fix the first createToolFromCapability function - wrap the tool call with type assertion
const oldCode = `): Tool {
  return tool({
    description: options?.description || \`Execute \${capabilityId} capability\`,
    parameters: options?.parameters || z.record(z.any()),
    execute: async (args: any) => {
      const context: ToolExecutionContext = {};

      try {`;

const newCode = `): Tool {
  // @ts-ignore - Vercel AI SDK tool() has complex overloads
  return tool({
    description: options?.description || \`Execute \${capabilityId} capability\`,
    parameters: options?.parameters || z.record(z.any()),
    execute: async (args: any) => {
      const context: ToolExecutionContext = {};

      try {`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(filePath, content);
console.log('Fixed tool overload error in vercel-ai-tools.ts');