const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), 'tests', 'e2e-live-logs');

fs.mkdirSync(OUT_DIR, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cookieHeader(cookieJar) {
  return Object.entries(cookieJar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

function updateCookies(cookieJar, response) {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return;

  for (const part of setCookie.split(/,(?=\s*[\w-]+=)/)) {
    const [pair] = part.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    cookieJar[name] = value;
  }
}

async function requestJson({
  url,
  method = 'GET',
  headers = {},
  body,
  cookieJar,
  requestLabel,
  ipSuffix,
}) {
  const reqHeaders = {
    ...headers,
    'x-forwarded-for': `127.0.0.${ipSuffix || Math.floor(Math.random() * 200 + 1)}`,
  };
  if (cookieJar && Object.keys(cookieJar).length > 0) {
    reqHeaders.cookie = cookieHeader(cookieJar);
  }

  const response = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  updateCookies(cookieJar || {}, response);

  const text = await response.text();
  const json = safeJsonParse(text);

  if (requestLabel) {
    fs.writeFileSync(
      path.join(OUT_DIR, `${requestLabel}.json`),
      JSON.stringify(
        {
          timestamp: nowIso(),
          url,
          method,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body,
          responseText: text,
          responseJson: json,
          cookies: cookieJar,
        },
        null,
        2,
      ),
    );
  }

  return { response, text, json };
}

function parseSse(raw) {
  const events = [];
  let currentEvent = 'message';
  let dataLines = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      if (dataLines.length > 0) {
        const dataText = dataLines.join('\n');
        events.push({
          event: currentEvent,
          rawData: dataText,
          data: safeJsonParse(dataText) || dataText,
        });
      }
      currentEvent = 'message';
      dataLines = [];
      continue;
    }

    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  return events;
}

async function requestSse({
  body,
  cookieJar,
  requestLabel,
  ipSuffix,
}) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `127.0.0.${ipSuffix || Math.floor(Math.random() * 200 + 1)}`,
      ...(cookieJar && Object.keys(cookieJar).length > 0 ? { cookie: cookieHeader(cookieJar) } : {}),
    },
    body: JSON.stringify(body),
  });

  updateCookies(cookieJar || {}, response);

  const raw = await response.text();
  const events = parseSse(raw);
  const tokens = events.filter((e) => e.event === 'token').map((e) => e.data?.content || '').join('');
  const toolEvents = events.filter((e) => e.event === 'tool_invocation');
  const fileEvents = events.filter((e) => e.event === 'file_edit');
  const done = events.find((e) => e.event === 'done');

  fs.writeFileSync(
    path.join(OUT_DIR, `${requestLabel}.json`),
    JSON.stringify(
      {
        timestamp: nowIso(),
        body,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        raw,
        eventCount: events.length,
        tokenText: tokens,
        toolEvents,
        fileEvents,
        done,
        cookies: cookieJar,
      },
      null,
      2,
    ),
  );

  return { response, raw, events, tokens, toolEvents, fileEvents, done };
}

async function listFiles(sessionCookieJar, sessionPath, label) {
  return requestJson({
    url: `${BASE_URL}/api/filesystem/list?path=${encodeURIComponent(sessionPath)}`,
    method: 'GET',
    cookieJar: sessionCookieJar,
    requestLabel: label,
  });
}

async function readFile(sessionCookieJar, filePath, label) {
  return requestJson({
    url: `${BASE_URL}/api/filesystem/read`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { path: filePath },
    cookieJar: sessionCookieJar,
    requestLabel: label,
  });
}

function summarizeScenario(name, details) {
  return {
    name,
    ...details,
  };
}

async function main() {
  const summary = [];

  const authProbe = await requestJson({
    url: `${BASE_URL}/api/auth/login`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { email: 'test@test.com', password: 'Testing0' },
    cookieJar: {},
    requestLabel: '01-auth-login-probe',
    ipSuffix: 11,
  });

  summary.push(
    summarizeScenario('auth_login_probe', {
      passed: authProbe.response.ok,
      status: authProbe.response.status,
      failurePoint: authProbe.response.ok ? null : 'auth/login returned non-2xx',
      responseSnippet: authProbe.text.slice(0, 300),
    }),
  );

  const nonStreamProbe = await requestJson({
    url: `${BASE_URL}/api/chat`,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
      messages: [{ role: 'user', content: 'Say hi in one sentence.' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: false,
      conversationId: 'e2e-nonstream-probe',
    },
    cookieJar: {},
    requestLabel: '02-chat-nonstream-probe',
    ipSuffix: 12,
  });

  summary.push(
    summarizeScenario('chat_nonstream_probe', {
      passed: nonStreamProbe.response.ok,
      status: nonStreamProbe.response.status,
      failurePoint: nonStreamProbe.response.ok ? null : 'chat non-stream path returned non-2xx',
      responseSnippet: nonStreamProbe.text.slice(0, 300),
    }),
  );

  const baselineJar = {};
  const baselineStream = await requestSse({
    body: {
      messages: [{ role: 'user', content: 'Say hi in one sentence.' }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
      conversationId: 'e2e-stream-baseline',
    },
    cookieJar: baselineJar,
    requestLabel: '03-chat-stream-baseline',
    ipSuffix: 13,
  });

  summary.push(
    summarizeScenario('chat_stream_baseline', {
      passed: baselineStream.response.ok && !!baselineStream.done && baselineStream.tokens.trim().length > 0,
      status: baselineStream.response.status,
      tokenLength: baselineStream.tokens.length,
      doneEvent: !!baselineStream.done,
      toolEventCount: baselineStream.toolEvents.length,
      fileEventCount: baselineStream.fileEvents.length,
    }),
  );

  const mistralJar = {};
  const mistralConversation = 'e2e-mistral-app';
  const mistralSessionPath = `project/sessions/${mistralConversation}`;

  const mistralApp = await requestSse({
    body: {
      messages: [{
        role: 'user',
        content: [
          'Build a tiny working counter web app in the current workspace.',
          'Create exactly these files in the session root: index.html, style.css, app.js.',
          'The UI needs increment, decrement, and reset buttons.',
          'Do not create a top-level folder.',
          'After creating the files, briefly explain what you changed.',
        ].join(' '),
      }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
      conversationId: mistralConversation,
    },
    cookieJar: mistralJar,
    requestLabel: '04-mistral-app-create',
    ipSuffix: 14,
  });

  const mistralList = await listFiles(mistralJar, mistralSessionPath, '04-mistral-app-list');
  const mistralIndex = await readFile(mistralJar, `${mistralSessionPath}/index.html`, '04-mistral-index');
  const mistralStyle = await readFile(mistralJar, `${mistralSessionPath}/style.css`, '04-mistral-style');
  const mistralAppJs = await readFile(mistralJar, `${mistralSessionPath}/app.js`, '04-mistral-appjs');

  const mistralNodes = mistralList.json?.data?.nodes || [];
  const mistralFilesExist =
    mistralIndex.response.ok &&
    mistralStyle.response.ok &&
    mistralAppJs.response.ok;

  summary.push(
    summarizeScenario('mistral_app_generation', {
      passed: mistralApp.response.ok && mistralFilesExist,
      status: mistralApp.response.status,
      doneEvent: !!mistralApp.done,
      toolEventCount: mistralApp.toolEvents.length,
      fileEventCount: mistralApp.fileEvents.length,
      filesInSession: mistralNodes.map((node) => node.name),
      indexHasButton: /increment|decrement|reset/i.test(mistralIndex.text),
      appHasCounterLogic: /count|counter|addEventListener/i.test(mistralAppJs.text),
      failurePoint: mistralFilesExist ? null : 'stream finished without persisting expected files',
    }),
  );

  const appVersionBefore = mistralAppJs.json?.data?.version || null;
  const mistralEdit = await requestSse({
    body: {
      messages: [
        { role: 'user', content: 'Build a tiny counter web app in index.html, style.css, app.js.' },
        { role: 'assistant', content: mistralApp.tokens.slice(0, 1500) || 'Counter app created.' },
        { role: 'user', content: 'Update the existing app so the counter starts at 5 and add a reset button if it is missing. Modify existing files instead of recreating the project.' },
      ],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
      conversationId: mistralConversation,
    },
    cookieJar: mistralJar,
    requestLabel: '05-mistral-repeat-edit',
    ipSuffix: 15,
  });

  const mistralAppJsAfter = await readFile(mistralJar, `${mistralSessionPath}/app.js`, '05-mistral-appjs-after');
  const appVersionAfter = mistralAppJsAfter.json?.data?.version || null;

  summary.push(
    summarizeScenario('mistral_repeat_edit_existing', {
      passed: mistralEdit.response.ok && mistralAppJsAfter.response.ok && appVersionAfter !== appVersionBefore,
      status: mistralEdit.response.status,
      doneEvent: !!mistralEdit.done,
      toolEventCount: mistralEdit.toolEvents.length,
      fileEventCount: mistralEdit.fileEvents.length,
      versionBefore: appVersionBefore,
      versionAfter: appVersionAfter,
      appContainsStartAt5: /5/.test(mistralAppJsAfter.text),
      appContainsReset: /reset/i.test(mistralAppJsAfter.text) || /reset/i.test(mistralIndex.text),
      failurePoint: appVersionAfter === appVersionBefore ? 'repeat edit did not change target file version' : null,
    }),
  );

  const terminalConversation = 'e2e-terminal-run';
  const terminalSessionPath = `project/sessions/${terminalConversation}`;
  const terminalJar = {};
  const terminalRun = await requestSse({
    body: {
      messages: [{
        role: 'user',
        content: 'Create hello.py that prints exactly hello terminal e2e, then run it using the terminal or shell tool and show the command output.',
      }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
      conversationId: terminalConversation,
    },
    cookieJar: terminalJar,
    requestLabel: '06-mistral-terminal-run',
    ipSuffix: 16,
  });

  const terminalFile = await readFile(terminalJar, `${terminalSessionPath}/hello.py`, '06-terminal-hello-py');
  const terminalOutputSeen = /hello terminal e2e/i.test(terminalRun.raw) || /hello terminal e2e/i.test(terminalRun.tokens);
  const terminalToolSeen = terminalRun.toolEvents.some((event) => {
    const name = event.data?.toolName || '';
    return /sandbox|terminal|shell|execute/i.test(name);
  });

  summary.push(
    summarizeScenario('mistral_terminal_run', {
      passed: terminalRun.response.ok && terminalFile.response.ok && terminalToolSeen,
      status: terminalRun.response.status,
      toolEventCount: terminalRun.toolEvents.length,
      fileEventCount: terminalRun.fileEvents.length,
      terminalToolSeen,
      terminalOutputSeen,
      failurePoint: terminalToolSeen ? null : 'natural-language run request did not produce a terminal/shell tool invocation event',
    }),
  );

  const googleJar = {};
  const googleConversation = 'e2e-google-app';
  const googleSessionPath = `project/sessions/${googleConversation}`;
  const googleApp = await requestSse({
    body: {
      messages: [{
        role: 'user',
        content: 'Create index.html, style.css, and app.js for a simple todo list app in the current session root. Do not create a wrapper folder.',
      }],
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      stream: true,
      conversationId: googleConversation,
    },
    cookieJar: googleJar,
    requestLabel: '07-google-app-create',
    ipSuffix: 17,
  });

  const googleIndex = await readFile(googleJar, `${googleSessionPath}/index.html`, '07-google-index');
  const googleAppJs = await readFile(googleJar, `${googleSessionPath}/app.js`, '07-google-appjs');

  summary.push(
    summarizeScenario('google_app_generation', {
      passed: googleApp.response.ok && googleIndex.response.ok && googleAppJs.response.ok,
      status: googleApp.response.status,
      doneEvent: !!googleApp.done,
      toolEventCount: googleApp.toolEvents.length,
      fileEventCount: googleApp.fileEvents.length,
      indexReadStatus: googleIndex.response.status,
      appReadStatus: googleAppJs.response.status,
      failurePoint: googleIndex.response.ok && googleAppJs.response.ok ? null : 'google stream completed without expected workspace files',
    }),
  );

  const ambiguousJar = {};
  const ambiguousConversation = 'e2e-ambiguous-target';
  const ambiguousSessionPath = `project/sessions/${ambiguousConversation}`;

  await requestSse({
    body: {
      messages: [{
        role: 'user',
        content: [
          'Create these files in the current session root with complete contents:',
          'src/main.js containing const TARGET = "frontend-original";',
          'server/main.js containing const TARGET = "server-original";',
          'Keep them as separate files in those two folders.',
        ].join(' '),
      }],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
      conversationId: ambiguousConversation,
    },
    cookieJar: ambiguousJar,
    requestLabel: '08-ambiguous-setup',
    ipSuffix: 18,
  });

  const ambiguousEdit = await requestSse({
    body: {
      messages: [
        { role: 'user', content: 'Create src/main.js with frontend-original and server/main.js with server-original.' },
        { role: 'assistant', content: 'The files were created.' },
        { role: 'user', content: 'Update main.js in the frontend one so TARGET becomes frontend-updated. Do not touch the server file.' },
      ],
      provider: 'mistral',
      model: 'mistral-small-latest',
      stream: true,
      conversationId: ambiguousConversation,
    },
    cookieJar: ambiguousJar,
    requestLabel: '08-ambiguous-edit',
    ipSuffix: 19,
  });

  const frontendMain = await readFile(ambiguousJar, `${ambiguousSessionPath}/src/main.js`, '08-frontend-main');
  const serverMain = await readFile(ambiguousJar, `${ambiguousSessionPath}/server/main.js`, '08-server-main');

  summary.push(
    summarizeScenario('ambiguous_file_selection', {
      passed:
        ambiguousEdit.response.ok &&
        frontendMain.response.ok &&
        serverMain.response.ok &&
        /frontend-updated/.test(frontendMain.text) &&
        /server-original/.test(serverMain.text),
      status: ambiguousEdit.response.status,
      toolEventCount: ambiguousEdit.toolEvents.length,
      fileEventCount: ambiguousEdit.fileEvents.length,
      frontendContent: frontendMain.text.slice(0, 120),
      serverContent: serverMain.text.slice(0, 120),
      failurePoint:
        /frontend-updated/.test(frontendMain.text) && /server-original/.test(serverMain.text)
          ? null
          : 'wrong file selected or both files changed during ambiguous-target update',
    }),
  );

  const report = {
    timestamp: nowIso(),
    baseUrl: BASE_URL,
    scenarios: summary,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));

  const failed = summary.filter((item) => !item.passed);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
  const fatal = {
    timestamp: nowIso(),
    fatal: true,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'fatal.json'), JSON.stringify(fatal, null, 2));
  console.error(JSON.stringify(fatal, null, 2));
  process.exit(1);
});
