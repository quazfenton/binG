/**
 * Backend Adapters
 * Flask, Django, and Node.js adapters for mounting applications
 * Based on ephemeral/ architecture
 */

import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'node:events';

// ===========================================
// Flask Adapter (WSGI)
// ===========================================

export interface FlaskApp {
  (environ: Record<string, any>, startResponse: (status: string, headers: [string, string][]) => void): any;
}

export class FlaskAdapter extends EventEmitter {
  constructor(private flaskApp: FlaskApp) {
    super();
  }

  async handleRequest(req: Request, res: Response): Promise<void> {
    const environ = this.buildEnviron(req);
    
    let status = '200 OK';
    let headers: [string, string][] = [];
    
    const startResponse = (newStatus: string, newHeaders: [string, string][]) => {
      status = newStatus;
      headers = newHeaders;
    };

    try {
      const result = this.flaskApp(environ, startResponse);
      
      res.status(parseInt(status.split(' ')[0]));
      headers.forEach(([key, value]) => res.setHeader(key, value));
      
      if (result && typeof result === 'object' && Symbol.iterator in result) {
        for (const chunk of result) {
          res.write(chunk);
        }
      }
      
      res.end();
      this.emit('request_handled', { status, headers });
    } catch (error: any) {
      res.status(500).send(`Flask error: ${error.message}`);
      this.emit('error', error);
    }
  }

  private buildEnviron(req: Request): Record<string, any> {
    return {
      'REQUEST_METHOD': req.method,
      'PATH_INFO': req.path,
      'QUERY_STRING': req.url.split('?')[1] || '',
      'CONTENT_TYPE': req.headers['content-type'] || '',
      'CONTENT_LENGTH': req.headers['content-length'] || '0',
      'SERVER_NAME': req.hostname,
      'SERVER_PORT': req.socket.localPort?.toString() || '80',
      'wsgi.url_scheme': req.protocol,
      'wsgi.input': req,
      'wsgi.errors': console.error,
      'wsgi.multithread': false,
      'wsgi.multiprocess': true,
      'wsgi.run_once': false,
    };
  }
}

// ===========================================
// Django Adapter (ASGI)
// ===========================================

export interface DjangoASGIApp {
  (scope: Record<string, any>, receive: () => Promise<any>, send: (message: any) => Promise<void>): Promise<void>;
}

export class DjangoAdapter extends EventEmitter {
  constructor(private djangoApp: DjangoASGIApp) {
    super();
  }

  async handleRequest(req: Request, res: Response): Promise<void> {
    const scope = this.buildScope(req);
    
    const receiveQueue: any[] = [];
    const receive = async () => {
      if (receiveQueue.length > 0) {
        return receiveQueue.shift();
      }
      
      // Build http.request message
      const body = await this.readRequestBody(req);
      return {
        type: 'http.request',
        body: body,
        more_body: false,
      };
    };

    const sendQueue: any[] = [];
    const send = async (message: any) => {
      sendQueue.push(message);
      
      if (message.type === 'http.response.start') {
        res.status(message.status);
        message.headers?.forEach(([key, value]: [string, string]) => {
          res.setHeader(key.toString(), value.toString());
        });
      } else if (message.type === 'http.response.body') {
        if (message.body) {
          res.write(message.body);
        }
        if (!message.more_body) {
          res.end();
        }
      }
    };

    try {
      await this.djangoApp(scope, receive, send);
      this.emit('request_handled', { scope });
    } catch (error: any) {
      res.status(500).send(`Django error: ${error.message}`);
      this.emit('error', error);
    }
  }

  private buildScope(req: Request): Record<string, any> {
    return {
      type: 'http',
      method: req.method,
      path: req.path,
      query_string: req.url.split('?')[1] || '',
      headers: Object.entries(req.headers).map(([k, v]) => [k, v]),
      server: [req.hostname, req.socket.localPort?.toString() || '80'],
      client: [req.ip, req.socket.remotePort?.toString() || '0'],
      scheme: req.protocol,
      root_path: '',
    };
  }

  private async readRequestBody(req: Request): Promise<Buffer> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}

// ===========================================
// Node WASM Runtime (QuickJS)
// ===========================================

export interface QuickJSRuntime {
  eval(code: string): any;
  executeFile(path: string): Promise<any>;
  setGlobal(name: string, value: any): void;
  getGlobal(name: string): any;
}

export class NodeWasmAdapter extends EventEmitter {
  private runtime: QuickJSRuntime | null = null;
  private isLoaded = false;

  constructor() {
    super();
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;

    try {
      // Dynamic import of QuickJS WASM (optional dependency)
      let getQuickJS: any;
      try {
        const quickjsModule = await import('quickjs-emscripten');
        getQuickJS = quickjsModule.getQuickJS;
      } catch (importError: any) {
        // Check if this is actually a "module not found" error
        const isModuleNotFound = 
          importError?.code === 'MODULE_NOT_FOUND' ||
          importError?.message?.includes('Cannot find module') ||
          importError?.message?.includes('quickjs-emscripten');
        
        if (isModuleNotFound) {
          // Module genuinely not installed - skip gracefully
          console.warn('quickjs-emscripten not installed, skipping WASM runtime');
          this.emit('load_error', new Error('quickjs-emscripten not installed'));
          return;
        }
        
        // Real error - rethrow so it's not masked
        console.error('Failed to load quickjs-emscripten:', importError);
        this.emit('load_error', importError);
        throw importError;
      }

      if (!getQuickJS) {
        throw new Error('getQuickJS not available');
      }

      const quickjsModule = await getQuickJS();
      const quickjs = await quickjsModule.createQuickJS();

      this.runtime = {
        eval: (code: string) => quickjs.evalCode(code),
        executeFile: async (path: string) => {
          const fs = await import('fs/promises');
          const code = await fs.readFile(path, 'utf8');
          return quickjs.evalCode(code);
        },
        setGlobal: (name: string, value: any) => {
          quickjs.setProp(quickjs.global, name, value);
        },
        getGlobal: (name: string) => {
          return quickjs.getProp(quickjs.global, name);
        },
      };

      this.isLoaded = true;
      this.emit('loaded');
    } catch (error: any) {
      this.emit('load_error', error);
      throw new Error(`Failed to load QuickJS WASM: ${error.message}`);
    }
  }

  async execute(code: string, context?: Record<string, any>): Promise<any> {
    if (!this.runtime) {
      await this.load();
    }

    if (!this.runtime) {
      throw new Error('Runtime not initialized');
    }

    // Set context variables
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        this.runtime.setGlobal(key, value);
      }
    }

    const startTime = Date.now();
    try {
      const result = this.runtime.eval(code);
      const duration = Date.now() - startTime;
      this.emit('executed', { duration, result });
      return result;
    } catch (error: any) {
      this.emit('execution_error', error);
      throw error;
    }
  }

  async executeFile(path: string, context?: Record<string, any>): Promise<any> {
    if (!this.runtime) {
      await this.load();
    }

    if (!this.runtime) {
      throw new Error('Runtime not initialized');
    }

    // Set context variables
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        this.runtime.setGlobal(key, value);
      }
    }

    const startTime = Date.now();
    try {
      const result = await this.runtime.executeFile(path);
      const duration = Date.now() - startTime;
      this.emit('executed', { duration, result, path });
      return result;
    } catch (error: any) {
      this.emit('execution_error', error);
      throw error;
    }
  }

  async unload(): Promise<void> {
    this.runtime = null;
    this.isLoaded = false;
    this.emit('unloaded');
  }
}

// ===========================================
// Preview Router Integration
// ===========================================

export interface PreviewMount {
  sandboxId: string;
  port: number;
  path: string;
  adapter: 'flask' | 'django' | 'node' | 'static';
  app?: any;
}

export class PreviewMountManager extends EventEmitter {
  private mounts: Map<string, PreviewMount> = new Map<string, PreviewMount>();

  async mount(config: PreviewMount): Promise<void> {
    const key = `${config.sandboxId}:${config.port}`;
    this.mounts.set(key, config);
    this.emit('mounted', config);
  }

  async unmount(sandboxId: string, port: number): Promise<void> {
    const key = `${sandboxId}:${port}`;
    this.mounts.delete(key);
    this.emit('unmounted', { sandboxId, port });
  }

  getMount(sandboxId: string, port: number): PreviewMount | null {
    const key = `${sandboxId}:${port}`;
    return this.mounts.get(key) || null;
  }

  listMounts(): PreviewMount[] {
    return Array.from(this.mounts.values());
  }
}

// ===========================================
// Factory Functions
// ===========================================

export function createFlaskAdapter(flaskApp: FlaskApp): FlaskAdapter {
  return new FlaskAdapter(flaskApp);
}

export function createDjangoAdapter(djangoApp: DjangoASGIApp): DjangoAdapter {
  return new DjangoAdapter(djangoApp);
}

export function createNodeWasmAdapter(): NodeWasmAdapter {
  return new NodeWasmAdapter();
}

export function createPreviewMountManager(): PreviewMountManager {
  return new PreviewMountManager();
}
