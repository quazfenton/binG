import 'dotenv/config';

import { NextRequest } from 'next/server';

import { POST as authLoginPost } from '@/app/api/auth/login/route';
import { POST as chatPost } from '@/app/api/chat/route';

async function readResponseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `<<failed to read body: ${error instanceof Error ? error.message : String(error)}>>`;
  }
}

async function runAuthLogin() {
  const request = new NextRequest('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'test@test.com',
      password: 'Testing0',
    }),
  });

  const response = await authLoginPost(request);
  const body = await readResponseBody(response);

  console.log('\n=== auth/login ===');
  console.log('status:', response.status);
  console.log('body:', body);
}

async function runChat(label: string, payload: Record<string, unknown>) {
  const request = new NextRequest('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const response = await chatPost(request);
  const body = await readResponseBody(response);

  console.log(`\n=== chat: ${label} ===`);
  console.log('status:', response.status);
  console.log('content-type:', response.headers.get('content-type'));
  console.log('body:', body.slice(0, 4000));
}

async function main() {
  await runAuthLogin();

  await runChat('mistral-nonstream', {
    messages: [{ role: 'user', content: 'Say hi' }],
    provider: 'mistral',
    model: 'mistral-small-latest',
    stream: false,
    conversationId: 'diag-nonstream-001',
  });

  await runChat('mistral-stream', {
    messages: [{ role: 'user', content: 'Say hi' }],
    provider: 'mistral',
    model: 'mistral-small-latest',
    stream: true,
    conversationId: 'diag-stream-001',
  });
}

main().catch((error) => {
  console.error('\n=== diag-route-invoke fatal ===');
  console.error(error);
  process.exitCode = 1;
});
