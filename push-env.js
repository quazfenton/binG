import fs from 'fs';
import { spawnSync } from 'child_process';

const envPath = fs.existsSync('web/.env') ? 'web/.env' : '.env';
const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n');

const environments = ['development', 'preview', 'production'];

for (let line of lines) {
  line = line.trim();
  if (!line || line.startsWith('#')) continue;

  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    let value = match[2].trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.substring(1, value.length - 1);
    }

    if (key && value && value.trim() !== '') {
      // Validate key format
      if (!/^[A-Z0-9_]+$/.test(key)) {
        console.error(`Invalid environment variable key: ${key}`);
        continue;
      }
      for (const env of environments) {
        console.log(`Setting ${key} in ${env}...`);
        try {
          // Use spawnSync with argument array to avoid shell injection
          const result = spawnSync('vercel', ['env', 'add', key, env, '--force'], {
            input: value,
            stdio: 'inherit',
          });
          if (result.error) {
            console.error(`Failed to set ${key} in ${env}: ${result.error.message}`);
          }
        } catch (e) {
          console.error(`Failed to set ${key} in ${env}:`, e);
        }
      }
    }
  }
}
