#!/usr/bin/env node

const { spawn } = require('child_process');

const mode = (process.argv[2] || 'standard').toLowerCase();
const allowedModes = new Set(['standard', 'opencode']);

if (!allowedModes.has(mode)) {
  console.error(`[run-dev-mode] Invalid mode "${mode}". Use "standard" or "opencode".`);
  process.exit(1);
}

const modeEnv = mode === 'opencode'
  ? {
      LLM_PROVIDER: 'opencode',
      OPENCODE_CONTAINERIZED: 'true',
      ENABLE_CODE_EXECUTION: 'true',
    }
  : {
      LLM_PROVIDER: 'gemini',
      OPENCODE_CONTAINERIZED: 'false',
      ENABLE_CODE_EXECUTION: 'true',
    };

console.log(`[run-dev-mode] Starting in ${mode} mode`);
Object.entries(modeEnv).forEach(([k, v]) => {
  console.log(`[run-dev-mode] ${k}=${v}`);
});

const child = spawn('pnpm', ['dev'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    ...modeEnv,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

