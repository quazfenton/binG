#!/usr/bin/env node
/**
 * Test prompting strategies to get LLM to output recognized formats
 */

async function testPromptStrategy(strategy, prompt) {
  console.log(`\n${strategy}: "${prompt.slice(0, 50)}..."`);
  
  const events = [];
  
  try {
    const res = await fetch('http://localhost:3000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ 
          role: 'system', 
          content: 'You are a file writing assistant. Write files using EXACTLY this format:\n```file: filename.js\nfile content here\n```\nDo not repeat the filename on separate lines.' 
        }, { 
          role: 'user', 
          content: prompt 
        }],
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
    
    console.log(`   Events: ${events.length}, FileEdits: ${fileEdits.length}`);
    if (fileEdits.length > 0) {
      console.log(`   ✅ Files: ${fileEdits.map(e => e.path).join(', ')}`);
    }
    
    return { passed: fileEdits.length > 0, events, fileEdits };
  } catch (err) {
    console.log(`   Error: ${err.message}`);
    return { passed: false, error: err.message };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('PROMPT STRATEGY TESTS');
  console.log('='.repeat(60));
  
  await testPromptStrategy('Simple', 'Write file hello.js with content console.log("hello")');
  
  await testPromptStrategy('Explicit format', 'Write a file "hello.js" using format ```file: hello.js\nconsole.log("hello")\n```');
  
  await testPromptStrategy('With instruction', 'Create hello.js with content: console.log("hello"); Use format: ```file: hello.js\\nconsole.log("hello");\\n```');
}

runTests().catch(console.error);