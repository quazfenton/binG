const fs = require('fs');
let content = fs.readFileSync('lib/chat/file-edit-parser.ts', 'utf8');

// Add <function= check to hasAnyMarker
content = content.replace(
  "content.includes('```toolcall');",
  "content.includes('```toolcall') || content.includes('<function=');"
);

// Add inline handler after extractToolTagEdits
content = content.replace(
  'allEdits.push(...extractToolTagEdits(content));\n  }',
  `allEdits.push(...extractToolTagEdits(content));
  }

  // Format D: <function=tool_name> format (Mistral)
  if (content.includes('<function=')) {
    const funcs = content.match(/<function=(\\w+)>[\\s\\S]*?<\\/function>/gi) || [];
    for (const funcBlock of funcs) {
      const nameMatch = /<function=(\\w+)>/i.exec(funcBlock);
      if (!nameMatch) continue;
      const name = nameMatch[1].toLowerCase();
      if (!['write_file','create_file','delete_file','apply_diff','mkdir'].includes(name)) continue;
      
      const pathMatch = /<parameter=path>([^<\\n]+)/i.exec(funcBlock);
      if (!pathMatch) continue;
      const path = pathMatch[1].trim();
      if (!path || !isValidExtractedPath(path)) continue;
      
      let action = name === 'delete_file' ? 'delete' : name === 'apply_diff' ? 'patch' : name === 'mkdir' ? 'mkdir' : 'write';
      let fileContent = '';
      
      if (action === 'write') {
        const contentMatch = /<parameter=content>([\\s\\S]*?)(?:<\\/parameter>|$)/i.exec(funcBlock);
        fileContent = contentMatch ? contentMatch[1].trim() : '';
        if (!fileContent) continue;
      }
      
      allEdits.push({ path, content: fileContent, action });
    }
  }`
);

fs.writeFileSync('lib/chat/file-edit-parser.ts', content);
console.log('Added inline handler');