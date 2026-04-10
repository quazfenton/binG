/**
 * Direct streamText debug
 */
import { streamText } from 'ai';
import { createMistral } from '@ai-sdk/mistral';

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
if (!MISTRAL_API_KEY) {
  console.error('MISTRAL_API_KEY not set');
  process.exit(1);
}

async function test() {
  console.log('Creating Mistral model...');
  const mistral = createMistral({ apiKey: MISTRAL_API_KEY });
  const model = mistral('mistral-small-latest');
  console.log('Model created:', model);
  console.log('Model supports FC:', model?.supports?.functionCalling);
  
  console.log('Calling streamText...');
  const startTime = Date.now();
  const result = streamText({
    model,
    messages: [
      { role: 'user', content: 'Create a simple HTML file with Hello World in project/test-debug/index.html. Use write_file tool.' }
    ],
    temperature: 0.7,
    maxOutputTokens: 4096,
    maxRetries: 0,
    maxSteps: 5,
    toolCallStreaming: true,
  });
  console.log('streamText returned in', Date.now() - startTime, 'ms');
  
  let eventCount = 0;
  let contentLength = 0;
  
  console.log('Iterating fullStream...');
  for await (const chunk of result.fullStream) {
    eventCount++;
    console.log('Event', eventCount, ':', chunk.type, JSON.stringify(chunk).slice(0, 200));
    if (chunk.type === 'text-delta') contentLength += chunk.text?.length || 0;
  }
  
  console.log('Events:', eventCount, 'Content length:', contentLength);
  
  const usage = await result.usage;
  const finish = await result.finishReason;
  console.log('Usage:', usage);
  console.log('Finish:', finish);
}

test().then(() => process.exit(0)).catch(e => { console.error('Error:', e.message); console.error(e.stack); process.exit(1); });
