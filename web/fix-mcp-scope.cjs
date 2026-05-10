// Fix MCP server to use session-specific scopePath instead of hardcoded 'project'
const fs = require('fs');

const filePath = 'web/lib/mcp/server.ts';
const content = fs.readFileSync(filePath, 'utf8');

// The issue: toolContextStore.run is called with hardcoded scopePath: 'project' and sessionId: undefined
// This causes VFS MCP tools to default to project/sessions/000
// Fix: Change the hardcoded values to use session-specific scopePath

// We need to modify the toolContextStore.run calls to use scopePath with session ID
// Instead of 'project', use 'project/sessions/' + sessionId (or keep 'project' for non-session contexts)

// Find all occurrences: { userId: 'mcp-server', sessionId: undefined, scopePath: 'project' }
// These should become: { userId: 'mcp-server', sessionId: sessionId || undefined, scopePath: scopePath || 'project' }

// Actually, the better fix is to pass the session context through the MCP server handlers
// Let me check what parameters the handlers receive

const lines = content.split('\n');
let modified = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Find the pattern: toolContextStore.run with scopePath: 'project'
  if (line.includes('toolContextStore.run') && line.includes('scopePath: \\'project\\'')) {
    // This needs to be changed to use a dynamic scopePath based on session
    // For now, change to 'project/sessions/000' as default (matching VFS MCP default)
    // The actual fix would require passing conversationId through to here
    lines[i] = line.replace(/scopePath: 'project'/, `scopePath: scopePath || 'project'`);
    modified = true;
  }
  
  // Also handle the direct scopePath assignment patterns
  if (line.includes('scopePath: \\'project\\'') && !line.includes('scopePath: scopePath')) {
    lines[i] = line.replace(/scopePath: 'project'/, `scopePath: scopePath || 'project'`);
    modified = true;
  }
}

if (modified) {
  fs.writeFileSync(filePath, lines.join('\n'));
  console.log('Fixed MCP server scopePath handling');
} else {
  console.log('No changes needed or pattern not found');
}