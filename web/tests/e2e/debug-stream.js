#!/usr/bin/env node
/**
 * Debug streaming events - proper check
 */

async function debugStream() {
  console.log('Debugging streaming events...\n');
  
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Write hello.js with: console.log("hi")' }],
      stream: true,
      provider: 'mistral',
      model: 'mistral-small-latest',
      enableFilesystemEdits: true,
    }),
  });

  const reader = res.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';
  const allEvents = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          allEvents.push(data);
        } catch {}
      }
    }
  }

  console.log(`Total events: ${allEvents.length}`);
  
  // Find file_edit events - check path property
  const fileEdits = allEvents.filter(e => e.path && (e.status === 'detected' || e.operation));
  console.log(`File edit events: ${fileEdits.length}`);
  
  if (fileEdits.length > 0) {
    console.log('\nFile edits:');
    for (const edit of fileEdits) {
      console.log(`  - ${edit.path} (${edit.operation}) status=${edit.status} content=${(edit.content || '').slice(0, 30)}...`);
    }
  }
  
  // Also show tokens
  const tokens = allEvents.filter(e => e.content && !e.path);
  console.log(`\nToken content (first 500 chars):`);
  console.log(tokens.map(t => t.content).join('').slice(0, 500));
}

debugStream().catch(console.error);