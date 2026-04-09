const fs = require('fs');
const content = fs.readFileSync('lib/chat/file-edit-parser.ts', 'utf8');

const newFunction = `
export function extractFunctionCallEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  if (!content.includes('<function=')) return edits;

  const toolNames = ['write_file', 'create_file', 'delete_file', 'apply_diff', 'mkdir'];
  const pattern = /<function=(\\w+)>/gi;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const toolName = match[1]?.toLowerCase();
    if (!toolNames.includes(toolName)) continue;

    const funcStart = match.index + match[0].length;
    const funcEnd = content.indexOf('</function>', funcStart);
    if (funcEnd === -1) continue;

    const funcBody = content.substring(funcStart, funcEnd);
    const pathMatch = /<parameter=path>([^<\n<]+)/i.exec(funcBody);
    const contentMatch = /<parameter=content>([\s\S]*?)(?:<\/parameter>|$)/i.exec(funcBody);

    if (!pathMatch) continue;
    const path = pathMatch[1]?.trim();
    if (!path || !isValidExtractedPath(path)) continue;

    let action = 'write';
    let fileContent = '';

    if (toolName === 'delete_file') action = 'delete';
    else if (toolName === 'apply_diff') { action = 'patch'; fileContent = contentMatch?.[1]?.trim() || ''; }
    else if (toolName === 'mkdir') action = 'mkdir';
    else fileContent = contentMatch?.[1]?.trim() || '';

    if (action === 'write' && (!fileContent || fileContent.trim().length === 0)) continue;

    edits.push({ path, content: fileContent, action });
  }

  return edits;
}
`;

const insertPoint = content.indexOf('export function extractToolTagEdits');
let newContent = content.slice(0, insertPoint) + newFunction + content.slice(insertPoint);

// Update hasAnyMarker
newContent = newContent.replace(
  "content.includes('```toolcall');",
  "content.includes('```toolcall') || content.includes('<function=');"
);

// Update extractFileEdits to call the new function
const oldCall = `allEdits.push(...extractToolTagEdits(content));
  }`;
const newCall = `allEdits.push(...extractToolTagEdits(content));
  }

  if (content.includes('<function=')) {
    allEdits.push(...extractFunctionCallEdits(content));
  }`;

newContent = newContent.replace(oldCall, newCall);

fs.writeFileSync('lib/chat/file-edit-parser.ts', newContent);
console.log('Added extractFunctionCallEdits successfully');