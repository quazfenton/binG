import fs from 'fs';
import path from 'path';

/**
 * Enhanced Environment Comparison & Sync Tool
 * Matches keys regardless of order or whether they are commented out in example files.
 */

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const files = args.filter(a => !a.startsWith('--'));

if (files.length < 2) {
  console.log('\x1b[33mUsage: node scripts/compare-env.js <sourceFile> <targetFile> [--comment | --sync]\x1b[0m');
  process.exit(1);
}

const sourcePath = path.resolve(process.cwd(), files[0]);
const targetPath = path.resolve(process.cwd(), files[1]);

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
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key) env[key] = value;
    }
  });
  return env;
}

if (!fs.existsSync(sourcePath)) {
  console.error(`\x1b[31mError: Source file not found: ${files[0]}\x1b[0m`);
  process.exit(1);
}

const sourceEnv = parseEnv(sourcePath);
const targetEnv = parseEnv(targetPath);

const sourceKeys = Object.keys(sourceEnv);
const targetKeys = Object.keys(targetEnv);

// Use Sets for O(1) lookup and order-independence
const targetKeySet = new Set(targetKeys);
const sourceKeySet = new Set(sourceKeys);

const missingInTarget = sourceKeys.filter(k => !targetKeySet.has(k));
const missingInSource = targetKeys.filter(k => !sourceKeySet.has(k));

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
