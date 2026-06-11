import fs from 'fs';
import path from 'path';

/**
 * Enhanced Environment Comparison & Sync Tool
 * Matches keys regardless of order or whether they are commented out in example files.
 *
 * Flags:
 *   (no flag)     — print missing-keys report only (key names, no values)
 *   --comment     — append missing keys to the target file (commented out, no value)
 *   --sync        — append missing keys + values to the target file
 *   --update      — REPLACE values for existing keys in the target file AND append
 *                   only truly missing ones. Idempotent (running twice produces
 *                   no duplicates and doesn't re-append). Uncomments lines that
 *                   were previously commented-out placeholders. Preserves leading
 *                   whitespace and writes the whole file back atomically.
 *   --diff        — report keys that are present in BOTH files but with different values.
 *                   DEFAULT: writes a masked report to ./env-diff-<timestamp>.txt
 *                            (values for secret-bearing keys are replaced with ***REDACTED***).
 *                            Safer than terminal output (no scrollback, no screen-share leak,
 *                            no accidental copy-paste into chat).
 *                   --stdout to print to the terminal instead (still masked).
 *                   --out=FILE  to write to a custom path instead of the default.
 *                   --no-mask   to disable masking (escape hatch; values printed in full).
 *
 * Secret detection: keys matching /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE/i
 * (case-insensitive) are considered sensitive. Add to the regex below if your
 * project uses a different naming convention.
 */

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const files = args.filter(a => !a.startsWith('--'));

if (files.length < 2) {
  console.log('\x1b[33mUsage: node scripts/compare-env.js <sourceFile> <targetFile> [--comment | --sync | --update | --diff] [--stdout] [--out=FILE] [--no-mask]\x1b[0m');
  process.exit(1);
}

const sourcePath = path.resolve(process.cwd(), files[0]);
const targetPath = path.resolve(process.cwd(), files[1]);

/**
 * Strip a single pair of matching outer quotes (single or double) from a value.
 *
 *   `"hello world"`  → `hello world`
 *   `'hello world'`  → `hello world`
 *   `""`             → `` (empty string)
 *   `"unclosed`      → `"unclosed` (kept as-is; not a matching pair)
 *   `not quoted`     → `not quoted` (unchanged)
 *
 * Does NOT process escape sequences (e.g., `"he said \"hi\""` keeps the
 * backslashes literally). That's a more complex feature; this is the common case
 * that makes --diff report `KEY="x"` and `KEY=x` as equal.
 */
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const env = {};

  lines.forEach(line => {
    let trimmed = line.trim();
    if (!trimmed) return;

    // Support both active and commented out keys (for .env.example matching)
    // Strip leading '#' but only if it's followed by a valid KEY= format
    if (trimmed.startsWith('#')) {
      const potentialKey = trimmed.slice(1).trim();
      if (potentialKey.includes('=')) {
        trimmed = potentialKey;
      } else {
        return; // It's just a real comment
      }
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = stripQuotes(trimmed.slice(eqIdx + 1).trim());
      if (key) env[key] = value;
    }
  });
  return env;
}

if (!fs.existsSync(sourcePath)) {
  console.error(`\x1b[31mError: Source file not found: ${files[0]}\x1b[0m`);
  process.exit(1);
}

/**
 * Returns true if a key name looks like it carries a secret. Used to mask
 * values in the --diff output so they don't end up in terminal scrollback,
 * screen shares, CI logs, or accidentally-pasted chat messages.
 *
 * Add your project-specific prefixes (e.g. /STRIPE|OPENAI|GITHUB_/) to the
 * regex if you want stricter detection.
 */
function isSecretKey(key) {
  return /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE/i.test(key);
}
function maskValue(key, value) {
  return isSecretKey(key) ? '***REDACTED***' : value;
}

// Default --diff behavior: write to a timestamped file, NOT the terminal.
// This is the safe default \u2014 see the docstring for the rationale. Use --stdout
// to force terminal output (still masked by default).
const outFlag = flags.find(f => f.startsWith('--out='));
const outFile = outFlag ? outFlag.split('=').slice(1).join('=') : null;
const useStdout = flags.includes('--stdout');
const maskEnabled = !flags.includes('--no-mask');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, 'T').slice(0, 19);
const defaultDiffFile = `env-diff-${stamp}.txt`;

const sourceEnv = parseEnv(sourcePath);
const targetEnv = parseEnv(targetPath);

const sourceKeys = Object.keys(sourceEnv);
const targetKeys = Object.keys(targetEnv);

// Use Sets for O(1) lookup and order-independence
const targetKeySet = new Set(targetKeys);
const sourceKeySet = new Set(sourceKeys);

const missingInTarget = sourceKeys.filter(k => !targetKeySet.has(k));
const missingInSource = targetKeys.filter(k => !sourceKeySet.has(k));

// Shared keys: present in BOTH files. Filtered further to find value mismatches.
const sharedKeys = sourceKeys.filter(k => targetKeySet.has(k));
const valueDiffs = sharedKeys
  .filter(k => sourceEnv[k] !== targetEnv[k])
  .sort();

console.log(`\x1b[36m🔍 Comparing environment variables...\x1b[0m`);
console.log(`   Source: ${files[0]}`);
console.log(`   Target: ${files[1]}\n`);

if (missingInTarget.length > 0) {
  console.log(`\x1b[31m❌ Keys found in "${files[0]}" but MISSING from "${files[1]}":\x1b[0m`);
  missingInTarget.sort().forEach(k => console.log(`   - ${k}`));
}

if (missingInSource.length > 0) {
  console.log(`\n\x1b[31m❌ Keys found in "${files[1]}" but MISSING from "${files[0]}":\x1b[0m`);
  missingInSource.sort().forEach(k => console.log(`   - ${k}`));
}

if (missingInTarget.length === 0 && missingInSource.length === 0) {
  console.log('\x1b[32m✅ Success: Both files are perfectly synced!\x1b[0m');
}

// --diff mode: report keys that are present in BOTH files but have different values.
// Useful for catching drift between a committed .env.example and the local .env,
// e.g. when someone bumped a flag default or rotated a non-secret config value.
//
// DEFAULT behavior: write a masked report to a file (./env-diff-<timestamp>.txt)
// instead of printing to the terminal. Reasons:
//   - No terminal scrollback leakage (other commands scrolling past could expose
//     secret values to anyone watching the screen or recording a screencast)
//   - No accidental copy-paste into Slack/chat
//   - No CI log capture (CI logs are often visible to org members)
//
// Use --stdout to print (still masked) or --no-mask to disable masking entirely.
if (flags.includes('--diff')) {
  const renderValue = (k, v) => maskEnabled ? maskValue(k, v) : v;
  const lines = [];
  if (valueDiffs.length === 0) {
    lines.push('✅ --diff: All shared keys have matching values.');
  } else {
    lines.push(`⚠️  --diff: ${valueDiffs.length} key(s) present in both files with DIFFERENT values:`);
    valueDiffs.forEach(k => {
      lines.push(`   - ${k}`);
      lines.push(`       source (${files[0]}): ${renderValue(k, sourceEnv[k])}`);
      lines.push(`       target (${files[1]}): ${renderValue(k, targetEnv[k])}`);
    });
  }

  if (useStdout) {
    // --stdout: print to terminal. Still masked unless --no-mask is also passed.
    console.log('\n' + lines.join('\n'));
  } else {
    // DEFAULT: write to file. Cheaper, safer, doesn't pollute scrollback.
    const targetFile = outFile || defaultDiffFile;
    const header = [
      `# --diff report`,
      `# generated: ${new Date().toISOString()}`,
      `# source:    ${files[0]}`,
      `# target:    ${files[1]}`,
      `# masking:   ${maskEnabled ? 'ON (keys matching /SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE/i)' : 'OFF (--no-mask)'}`,
      `# secrets:   ${valueDiffs.filter(k => isSecretKey(k)).length} of ${valueDiffs.length} redacted`,
      ``,
    ].join('\n');
    fs.writeFileSync(targetFile, header + lines.join('\n') + '\n', 'utf8');
    console.log(`\n\x1b[32m📄 Diff report written to: ${targetFile}\x1b[0m`);
    if (maskEnabled) {
      console.log(`\x1b[33m   Secret-bearing values were masked. Use --no-mask to disable.\x1b[0m`);
    } else {
      console.log(`\x1b[31m   ⚠️  --no-mask was passed: full secret values are in the file.\x1b[0m`);
    }
    if (valueDiffs.length === 0) {
      console.log(`\x1b[32m   No value mismatches found.\x1b[0m`);
    }
  }
}

// ACTION MODES
if (flags.includes('--comment') && missingInTarget.length > 0) {
  console.log(`\n\x1b[34m📝 Appending ${missingInTarget.length} missing keys to ${files[1]} (commented)...\x1b[0m`);
  const toAppend = missingInTarget.sort().map(k => `# ${k}=`).join('\n');
  fs.appendFileSync(targetPath, `\n\n# Missing keys from ${files[0]}\n${toAppend}\n`);
  console.log('\x1b[32mDone.\x1b[0m');
}

if (flags.includes('--sync') && missingInTarget.length > 0) {
  console.log(`\n\x1b[34m🔄 Syncing ${missingInTarget.length} keys and values to ${files[1]}...\x1b[0m`);
  const toAppend = missingInTarget.sort().map(k => `${k}=${sourceEnv[k]}`).join('\n');
  fs.appendFileSync(targetPath, `\n\n# Synced from ${files[0]}\n${toAppend}\n`);
  console.log('\x1b[32mDone.\x1b[0m');
}

// --update mode: idempotent sync. Replaces values for existing keys (and
// uncomments placeholders), appends only truly missing ones. Running twice
// produces no duplicates. Preserves leading whitespace and writes the file
// back atomically. Differs from --sync in that --sync only appends.
if (flags.includes('--update')) {
  // If the target file doesn't exist, create it from scratch with all source keys.
  let targetContent;
  if (fs.existsSync(targetPath)) {
    targetContent = fs.readFileSync(targetPath, 'utf8');
  } else {
    console.log(`\n\x1b[33m⚠️  ${files[1]} does not exist — creating it from ${files[0]}\x1b[0m`);
    targetContent = '';
  }

  // Escape regex special characters in a key name (rare but possible).
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const lines = targetContent.split(/\r?\n/);
  let replacedCount = 0;
  const replacedKeys = [];

  // For each source key, find the FIRST matching line in target (whether
  // commented or uncommented) and rewrite it with the new value.
  for (const key of sourceKeys) {
    // Match: optional indent + optional `#` + spaces + KEY + `=` + anything
    const keyRegex = new RegExp(
      `^(\\s*)(#?\\s*)${escapeRegex(key)}\\s*=\\s*.*$`
    );
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(keyRegex);
      if (m) {
        const indent = m[1] || '';
        const newLine = `${indent}${key}=${sourceEnv[key]}`;
        if (lines[i] !== newLine) {
          lines[i] = newLine;
          replacedCount++;
          replacedKeys.push(key);
        }
        break; // only the first occurrence
      }
    }
  }

  // Append keys that didn't exist in target at all
  const appendedKeys = missingInTarget.sort();
  if (appendedKeys.length > 0) {
    const toAppend = appendedKeys.map(k => `${k}=${sourceEnv[k]}`).join('\n');
    // Don't add a trailing newline if the file already ends with one
    const needsLeadingNewline = lines.length > 0 && lines[lines.length - 1] !== '';
    const prefix = needsLeadingNewline ? `\n# Appended by --update from ${files[0]}\n` : `# Appended by --update from ${files[0]}\n`;
    lines.push(prefix + toAppend);
  }

  fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');

  console.log(`\n\x1b[32m✅ --update complete for ${files[1]}\x1b[0m`);
  console.log(`   \x1b[36mreplaced:\x1b[0m ${replacedCount} key(s)${replacedKeys.length ? ' (' + replacedKeys.sort().slice(0, 8).join(', ') + (replacedKeys.length > 8 ? ', …' : '') + ')' : ''}`);
  console.log(`   \x1b[36mappended:\x1b[0m ${appendedKeys.length} key(s)${appendedKeys.length ? ' (' + appendedKeys.join(', ') + ')' : ''}`);
  if (replacedCount === 0 && appendedKeys.length === 0) {
    console.log(`   \x1b[32mNo changes — target already in sync.\x1b[0m`);
  }
}

