/**
 * Debug route stream by capturing server logs
 */
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIiwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwianRpIjoiNDBmZWI5NzliMTQ3M2UyNzc2ZjMwZmYzMjEzYWFhNjgiLCJpc3MiOiJiaW5nLWFwcCIsImF1ZCI6ImJpbmctdXNlcnMiLCJpYXQiOjE3NzU3NTczMDEsImV4cCI6MTc3NjM2MjEwMX0.vHdh3EKCD-Lo3Wegn1RP5Twkeweb_uZESjnIyls3jek';

async function test() {
  console.log('Testing complex prompt with route...');
  const controller = new AbortController();
  const timeout = setTimeout(() => { controller.abort(); console.log('TIMEOUT after 60s'); }, 60000);
  
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ 
      messages: [{ role: 'user', content: 'Write index.html with Hello World to project/test-debug/. Use write_file tool.' }], 
      provider: 'mistral', 
      model: 'mistral-small-latest', 
      stream: true,
    }),
    signal: controller.signal,
  });
  clearTimeout(timeout);
  console.log('Status:', res.status, 'Content-Type:', res.headers.get('content-type'));
  
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = ''; let fullContent = ''; let eventCount = 0;
  const startTime = Date.now();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) { console.log('Stream done after', ((Date.now() - startTime) / 1000).toFixed(1) + 's'); break; }
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const part of parts) {
      eventCount++;
      const lines = part.split('\n');
      let type = ''; let data = null;
      for (const line of lines) {
        if (line.startsWith('event: ')) type = line.slice(7).trim();
        else if (line.startsWith('data: ')) { try { data = JSON.parse(line.slice(6)); } catch(e) { console.log('Parse error:', e.message, 'line:', line.slice(0, 100)); } }
      }
      if (type === 'token') fullContent += data?.content || '';
      if (type === 'tool_call') console.log('TOOL CALL:', JSON.stringify(data).slice(0, 200));
      if (type === 'file_edit') console.log('FILE EDIT:', JSON.stringify(data).slice(0, 200));
      console.log('Event', eventCount, ':', type, JSON.stringify(data).slice(0, 150));
    }
  }
  
  console.log('Events:', eventCount, 'Content len:', fullContent.length);
  console.log('Content:', fullContent.slice(0, 300));
}

test().then(() => process.exit(0)).catch(e => { console.error('Error:', e.message); process.exit(1); });
