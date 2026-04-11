const fs = require('fs');
let content = fs.readFileSync('lib/chat/file-edit-parser.ts', 'utf8');

// Add <function= check to hasAnyMarker
const hasAnyMarkerSection = "content.includes('```toolcall');";
const newHasAnyMarker = "content.includes('```toolcall') || content.includes('<function=');";
content = content.replace(hasAnyMarkerSection, newHasAnyMarker);

// Add inline handler in extractFileEdits after extractToolTagEdits call
// Find the pattern and add the handler inline
const oldPattern = `allEdits.push(...extractToolTagEdits(content));
  }`;
const newPattern = `allEdits.push(...extractToolTagEdits(content));
  }

  // Format D: <function=tool_name> format (Mistral models) - inline handler
  if (content.includes('<function=')) {
    const funcPattern = /<function=(\\w+)>/gi;
    let funcMatch;
    while ((funcMatch = funcPattern.exec(content)) !== null) {
      const toolName = funcMatch[1]?.toLowerCase();
      if (!['write_file', 'create_file', 'delete_file', 'apply_diff', 'mkdir'].includes(toolName)) continue;
      
      const funcStart = funcMatch.index + funcMatch[0].length;
      const funcEnd = content.indexOf('</function>', funcStart);
      if (funcEnd === -1) continue;
      
      const funcBody = content.substring(funcStart, funcEnd);
      
      // Simple path extraction - find text after <parameter=path> until newline or <
      const pathStart = funcBody.indexOf('<parameter=path>');
      if (pathStart === -1) continue;
      const pathEnd = funcBody.indexOf('\n', pathStart);
      const pathEnd2 = funcBody.indexOf('<', pathStart);
      const pathExtractEnd = pathEnd === -1 ? pathEnd2 : (pathEnd2 === -1 ? pathEnd : Math.min(pathEnd, pathEnd2));
      let path = funcBody.substring(pathStart + 16, pathExtractEnd).trim();
      
      if (!path || !isValidExtractedPath(path)) continue;
      
      let action = 'write';
      let fileContent = '';
      
      if (toolName === 'delete_file') action = 'delete';
      else if (toolName === 'apply_diff') { action = 'patch'; }
      else if (toolName === 'mkdir') action = 'mkdir';
      else {
        // Extract content
        const contentStart = funcBody.indexOf('<parameter=content>');
        if (contentStart !== -1) {
          const contentEnd = funcBody.indexOf('