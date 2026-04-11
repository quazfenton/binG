#!/usr/bin/env node
/**
 * Test specific file edit formats to debug parser
 */

async function testFormat(format, prompt) {
  console.log(`\n🔬 Testing format: ${format}`);
  console.log(`   Prompt: ${prompt.slice(0, 80)}...`);
  
  const events = [];
  
  try {
    const res = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        provider: 'mistral',
        model: 'mistral-small-latest',
        enableFilesystemEdits: true,
      }),
    });

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No reader');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const line of buffer.split('\n')) {
        if (line.startsWith('data: ')) {
          try { events.push(JSON.parse(line.slice(5))); } catch {}
        }
      }
    }

    const fileEdits = events.filter(e => e.type === 'file_edit');
    const tokens = events.filter(e => e.type === 'token' || e.content);
    const toolInv = events.filter(e => e.type === 'tool_invocation');
    
    console.log(`   Events: ${events.length}, Tokens: ${tokens.length}, FileEdits: ${fileEdits.length}, Tools: ${toolInv.length}`);
    
    if (fileEdits.length > 0) {
      console.log(`   ✅ File edits detected:`);
      for (const edit of fileEdits) {
        console.log(`      - ${edit.path} (${edit.operation})`);
      }
    } else {
      // Check raw content
      const rawContent = tokens.map(t => t.content || t).join('');
      console.log(`   Raw content: ${rawContent.slice(0, 200)}...`);
    }
    
    return { passed: fileEdits.length > 0, events, fileEdits };
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    return { passed: false, error: err.message };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('FORMAT PARSING TESTS');
  console.log('='.repeat(60));
  
  // Test 1: Explicit file tag format
  await testFormat('explicit_file_tag', 
    'Create a file "test1.js" with content: console.log("test1"); using <file_write path="test1.js">console.log("test1");</file_write>'
  );

  // Test 2: JSON format
  await testFormat('json',
    'Write a file "test2.js": {"path": "test2.js", "content": "console.log(2);"}'
  );

  // Test 3: Fenced code block  
  await testFormat('fenced_code',
    'Create a file "test3.js": ```javascript\nconsole.log("test3");\n```'
  );

  // Test 4: write_file function
  await testFormat('write_file',
    'Use write_file("test4.js", "console.log(4);") to create a file'
  );

  // Test 5: Plain text
  await testFormat('plain_text',
    'Create test5.js with the content: console.log("5");'
  );

  // Test 6: Tool call format
  await testFormat('tool_call',
    'Call write_file with arguments path: "test6.js", content: "console.log(6);"'
  );

  // Test 7: Diff format
  await testFormat('diff',
    'Apply diff to config.js: --- a/config.js\n+++ b/config.js\n@@ -1 +1,2 @@\n+// new line\nmodule.exports = {}'
  );

  // Test 8: batch_write
  await testFormat('batch_write',
    'Use batch_write to create files: [{"path": "a.js", "content": "a"}, {"path": "b.js", "content": "b"}]'
  );
}

runTests().catch(console.error);