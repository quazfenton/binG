/**
 * Simple SSE debug script
 */
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIiwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwianRpIjoiNDBmZWI5NzliMTQ3M2UyNzc2ZjMwZmYzMjEzYWFhNjgiLCJpc3MiOiJiaW5nLWFwcCIsImF1ZCI6ImJpbmctdXNlcnMiLCJpYXQiOjE3NzU3NTczMDEsImV4cCI6MTc3NjM2MjEwMX0.vHdh3EKCD-Lo3Wegn1RP5Twkeweb_uZESjnIyls3jek';

async function test() {
  console.log('Starting...');
  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Say hello' }], provider: 'mistral', model: 'mistral-small-latest', stream: true }),
  });
  console.log('Status:', res.status);
  console.log('Content-Type:', res.headers.get('content-type'));
  
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let tokenCount = 0;
  let fullText = '';
  
  while (true) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) { console.log('Stream done, breaking'); break; }
    
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    
    for (const part of parts) {
      const lines = part.split('\n');
      let eventType = '';
      let eventData = null;
      
      for (const line of lines) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) {
          try { eventData = JSON.parse(line.slice(6).trim()); } 
          catch(e) { console.log('Parse error:', e.message); }
        }
      }
      
      if (eventType === 'token') {
        tokenCount++;
        fullText += eventData?.content || '';
      } else if (eventType === 'done') {
        console.log('DONE event');
        return { tokenCount, fullText };
      }
    }
  }
  
  console.log('Final - Tokens:', tokenCount, 'Text:', JSON.stringify(fullText));
  return { tokenCount, fullText };
}

test().then(r => { console.log('RESULT:', JSON.stringify(r)); process.exit(0); })
     .catch(e => { console.error('ERROR:', e); process.exit(1); });
