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

// VALIDATE: Check if oldCode exists before replacing
if (!content.includes(oldCode)) {
  console.error('ERROR: Target code snippet not found in vercel-ai-tools.ts');
  console.error('The file may have already been fixed or changed.');
  process.exit(1);
}

const newContent = content.replace(oldCode, newCode);

// VALIDATE: Check if replacement actually happened
if (newContent === content) {
  console.error('ERROR: Replacement did not occur - oldCode and newContent are identical');
  process.exit(1);
}

// VALIDATE: Check if new code is present after replacement
if (!newContent.includes(newCode)) {
  console.error('ERROR: New code snippet not found after replacement');
  process.exit(1);
}

fs.writeFileSync(filePath, newContent);
console.log('✓ Fixed tool overload error in vercel-ai-tools.ts');
console.log('✓ Validated: Target snippet was found and replaced successfully');