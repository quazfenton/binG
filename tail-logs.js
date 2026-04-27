import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const tauriLog = path.join(os.tmpdir(), 'quaz-desktop.log');
const webLog = path.join(process.cwd(), 'web', 'logs', 'run.log');

console.log('--- Log Viewer ---');
console.log(`Tauri Log: ${tauriLog}`);
console.log(`Web Log: ${webLog}`);
console.log('------------------');

// Ensure files exist so tail doesn't fail
if (!fs.existsSync(tauriLog)) fs.writeFileSync(tauriLog, '');
if (!fs.existsSync(webLog)) {
    const dir = path.dirname(webLog);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(webLog, '');
}

function tailFile(filePath, label) {
    // On Windows, 'tail' might not be available, so we use a simple JS implementation
    console.log(`[*] Tailing ${label}...`);
    
    let lastSize = fs.statSync(filePath).size;
    
    fs.watch(filePath, (event) => {
        if (event === 'change') {
            const stats = fs.statSync(filePath);
            const newSize = stats.size;
            
            if (newSize < lastSize) {
                console.log(`\n--- ${label} Log reset ---\n`);
                lastSize = 0;
            }
            
            if (newSize > lastSize) {
                const stream = fs.createReadStream(filePath, { start: lastSize, end: newSize });
                stream.on('data', (chunk) => {
                    process.stdout.write(`[${label}] ${chunk}`);
                });
                lastSize = newSize;
            }
        }
    });
}

tailFile(tauriLog, 'TAURI');
tailFile(webLog, 'WEB');
