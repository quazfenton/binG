const BASE_URL = 'http://localhost:3000';

async function main() {
  const loginRes = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'Testing0' }),
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  console.log('Login OK');

  const diffRes = await fetch(BASE_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Cookie': cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Apply this diff to project/honest-diff-test.txt:\n```diff\n--- a/project/honest-diff-test.txt\n+++ b/project/honest-diff-test.txt\n@@ -1,3 +1,3 @@\n Line 1\n-Line 2\n+Line TWO\n Line 3\n```' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
    }),
  });
  const data = await diffRes.json();
  console.log('=== FULL LLM RESPONSE ===');
  console.log(data.content || 'NO CONTENT');
  console.log('=== END ===');
}

main().catch(console.error);
