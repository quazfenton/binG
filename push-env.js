import fs from 'fs';
import { execSync } from 'child_process';

const envPath = fs.existsSync('web/.env') ? 'web/.env' : '.env';
const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n');

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
    
    if (key && value) {
      console.log(`Setting ${key}...`);
      try {
        // We use printf to handle special characters in value
        // vercel env add <key> <environment>
        // We'll add to development, preview, and production
        const command = `printf "%s" "${value.replace(/"/g, '\\"')}" | vercel env add ${key} production --force`;
        execSync(command, { stdio: 'inherit' });
      } catch (e) {
        console.error(`Failed to set ${key}: ${e.message}`);
      }
    }
  }
}
