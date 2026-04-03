/**
 * WebContainer Preview Page
 *
 * Isolated route with COEP/COOP headers required for SharedArrayBuffer.
 * WebContainer boots client-side in this isolated context to avoid
 * breaking third-party iframes on the main app page.
 *
 * Usage:
 * - Navigate to /webcontainer?files=<base64-encoded-json>&startCommand=...
 * - Or use the "Open in WebContainer" button from code-preview-panel
 */

'use client';

import { useEffect, useState, useRef } from 'react';

export default function WebContainerPreviewPage() {
  const [status, setStatus] = useState<{ text: string; type: 'booting' | 'running' | 'error' }>({ text: 'Initializing...', type: 'booting' });
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      const params = new URLSearchParams(window.location.search);
      const filesParam = params.get('files');
      const startCommand = params.get('startCommand') || undefined;

      if (!filesParam) {
        setStatus({ text: 'No files provided', type: 'error' });
        setLoading(false);
        return;
      }

      try {
        setStatus({ text: 'Loading files...', type: 'booting' });

        // Decode files from base64 JSON
        const files: Record<string, string> = JSON.parse(
          decodeURIComponent(atob(filesParam))
        );

        if (!files || Object.keys(files).length === 0) {
          throw new Error('No files in preview data');
        }

        setStatus({ text: 'Booting WebContainer...', type: 'booting' });

        // Dynamically import WebContainer API (browser-only)
        const { WebContainer } = await import('@webcontainer/api');

        // Boot WebContainer (requires COEP/COOP headers from proxy.ts)
        const wc = await WebContainer.boot();
        if (cancelled) return;

        setStatus({ text: 'Writing files...', type: 'booting' });

        // Write all files
        for (const [filePath, content] of Object.entries(files)) {
          const dir = filePath.substring(0, filePath.lastIndexOf('/'));
          if (dir) {
            await wc.fs.mkdir(dir, { recursive: true });
          }
          await wc.fs.writeFile(filePath, content);
        }

        if (cancelled) return;

        setStatus({ text: 'Installing dependencies...', type: 'booting' });
        setLoading(false);

        // Install dependencies if package.json exists
        if (files['package.json']) {
          const installProcess = await wc.spawn('npm', ['install']);
          installProcess.output.pipeTo(new WritableStream({
            write(data) {
              setOutput(prev => prev + data);
            }
          }));
          await installProcess.exit;
        }

        if (cancelled) return;

        // Determine start command
        let cmd = startCommand || 'npm start';
        if (!startCommand && files['package.json']) {
          try {
            const pkg = JSON.parse(files['package.json']);
            if (pkg.scripts?.dev) cmd = 'npm run dev';
            else if (pkg.scripts?.start) cmd = 'npm start';
          } catch { /* ignore parse errors */ }
        }

        setStatus({ text: 'Starting server...', type: 'booting' });
        setOutput(prev => prev + `\n> ${cmd}\n\n`);

        // Start the dev server
        const serverProcess = await wc.spawn('sh', ['-c', cmd]);
        serverProcess.output.pipeTo(new WritableStream({
          write(data) {
            setOutput(prev => prev + data);
          }
        }));

        // Wait for server-ready event
        const url = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Server did not start within 30 seconds'));
          }, 30000);

          wc.on('server-ready', (port, url) => {
            clearTimeout(timeout);
            resolve(url);
          });

          serverProcess.exit.then((code) => {
            if (code !== 0) {
              clearTimeout(timeout);
              reject(new Error(`Server exited with code ${code}`));
            }
          });
        });

        if (cancelled) return;

        setStatus({ text: 'Running', type: 'running' });
        setPreviewUrl(url);

      } catch (error: any) {
        if (cancelled) return;
        console.error('WebContainer boot failed:', error);
        setStatus({ text: `Error: ${error.message}`, type: 'error' });
        setLoading(false);
      }
    };

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[#0a0a0a] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#111] border-b border-[#333]">
        <h1 className="text-sm font-medium text-[#888]">WebContainer Preview</h1>
        <span className={`text-xs px-2 py-1 rounded bg-[#222] ${
          status.type === 'running' ? 'text-green-500' :
          status.type === 'error' ? 'text-red-500' :
          'text-yellow-400'
        }`}>
          {status.text}
        </span>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <div className="w-8 h-8 border-[3px] border-[#333] border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-[#888]">Booting WebContainer...</p>
        </div>
      )}

      {/* Preview iframe */}
      {previewUrl && (
        <iframe
          src={previewUrl}
          className="flex-1 border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}

      {/* Output panel (shown during install/start) */}
      {!loading && output && !previewUrl && (
        <div
          ref={outputRef}
          className="h-48 bg-[#111] border-t border-[#333] p-3 font-mono text-xs overflow-y-auto whitespace-pre-wrap text-[#ccc]"
        >
          {output}
        </div>
      )}

      {/* Error state */}
      {status.type === 'error' && !previewUrl && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-red-500 text-sm">{status.text}</p>
        </div>
      )}
    </div>
  );
}
