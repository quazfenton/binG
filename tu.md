// terminaluse-sdk.ts
import { z } from 'zod'; // optional: for runtime validation (install zod if desired)

const BASE_URL = 'https://api.terminaluse.com';
const DEFAULT_ENV = process.env.TERMINALUSE_BASE_URL ?? BASE_URL;

export interface TerminalUseConfig {
  environment?: string;
  bearerAuth: { token: string };
}

export type AgentName = `${string}/${string}`;

// Core types from API reference
export interface Project {
  id: string;
  name: string;
  namespace_id: string;
}

export interface Filesystem {
  id: string;
  name: string;
  project_id: string;
  // ... other fields omitted for brevity
}

export interface Task {
  id: string;
  agent_name?: string;
  filesystem_id: string;
  status: 'IDLE' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'TERMINATED' | 'TIMED_OUT' | 'DELETED';
  params: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // ... full response fields from /tasks create
}

export type EventContent =
  | { type: 'text'; text: string }
  | { type: 'data'; data: Record<string, unknown> };

export interface TaskEvent {
  id: string;
  task_id: string;
  agent_id: string;
  sequence_id: number;
  content: EventContent;
  created_at: string;
}

// SDK Client
export class TerminalUseClient {
  private baseUrl: string;
  private headers: HeadersInit;

  constructor(config: TerminalUseConfig) {
    this.baseUrl = config.environment ?? DEFAULT_ENV;
    this.headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.bearerAuth.token}`,
    };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...(options.headers ?? {}) },
    });

    if (!res.ok) {
      const error = await res.text().catch(() => 'Unknown error');
      throw new Error(`TerminalUse API error (${res.status}): ${error}`);
    }

    return res.json() as Promise<T>;
  }

  // === Projects ===
  async createProject(body: { namespace_id: string; name: string }): Promise<Project> {
    return this.request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // === Filesystems (advanced: persistent workspace) ===
  async createFilesystem(body: { project_id: string; name: string }): Promise<Filesystem> {
    return this.request<Filesystem>('/filesystems', { method: 'POST', body: JSON.stringify(body) });
  }

  async listFiles(params: { filesystem_id: string; recursive?: boolean; path?: string }): Promise<any[]> {
    const query = new URLSearchParams({ recursive: String(params.recursive ?? true), ...(params.path && { path: params.path }) });
    return this.request<any[]>(`/filesystems/${params.filesystem_id}/files?${query}`);
  }

  async getFile(params: { filesystem_id: string; file_path: string; include_content?: boolean }): Promise<{ content?: string; metadata: any }> {
    const query = new URLSearchParams({ include_content: String(params.include_content ?? true) });
    return this.request(`/filesystems/${params.filesystem_id}/files/${encodeURIComponent(params.file_path)}?${query}`);
  }

  async downloadFile(params: { filesystem_id: string; path: string }): Promise<Response> {
    return fetch(`${this.baseUrl}/filesystems/${params.filesystem_id}/download/${encodeURIComponent(params.path)}`, {
      headers: { Authorization: this.headers.Authorization as string },
    });
  }

  // Whole-archive URLs (advanced bulk sync)
  async getUploadUrl(filesystemId: string): Promise<{ url: string; expires_at: string }> {
    return this.request(`/filesystems/${filesystemId}/upload-url`);
  }

  async getDownloadUrl(filesystemId: string): Promise<{ url: string; expires_at: string }> {
    return this.request(`/filesystems/${filesystemId}/download-url`);
  }

  // === Tasks (core offloading for agents) ===
  async createTask(body: {
    agent_name?: AgentName;
    agent_id?: string;
    filesystem_id?: string;
    project_id?: string; // auto-creates FS if provided
    branch?: string;
    name?: string;
    params?: Record<string, unknown>;
  }): Promise<Task> {
    return this.request<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) });
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/tasks/${taskId}`);
  }

  async listTasks(params?: { limit?: number; page_number?: number; status?: string }): Promise<Task[]> {
    const query = new URLSearchParams({ ...(params?.limit && { limit: String(params.limit) }), ...(params?.page_number && { page_number: String(params.page_number) }) });
    return this.request<Task[]>(`/tasks?${query}`);
  }

  // === Events & Streaming (advanced real-time offload) ===
  async sendEvent(taskId: string, content: EventContent, opts: { idempotency_key?: string; persist_message?: boolean } = {}): Promise<TaskEvent> {
    return this.request<TaskEvent>(`/tasks/${taskId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        content,
        idempotency_key: opts.idempotency_key,
        persist_message: opts.persist_message ?? true,
      }),
    });
  }

  // Raw events for tool calls / reasoning (advanced agent steering)
  async sendRawEvent(taskId: string, rawEvent: unknown): Promise<any> {
    return this.request(`/tasks/${taskId}/raw-events`, {
      method: 'POST',
      body: JSON.stringify(rawEvent),
    });
  }

  // Stream task events (SSE / server-sent events – matches frontend patterns)
  async *streamTask(taskId: string, signal?: AbortSignal): AsyncGenerator<any> {
    const url = `${this.baseUrl}/tasks/${taskId}/stream`;
    const res = await fetch(url, {
      headers: { Authorization: this.headers.Authorization as string, Accept: 'text/event-stream' },
      signal,
    });

    if (!res.ok || !res.body) throw new Error('Stream failed');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // Parse SSE (data: {...}\n\n)
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              yield JSON.parse(line.slice(6));
            } catch (e) {
              yield line.slice(6); // raw fallback
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Cancel / migrate / update (advanced lifecycle)
  async cancelTask(taskId: string): Promise<void> {
    await this.request(`/tasks/${taskId}/cancel`, { method: 'POST' });
  }

  // Message history (for resuming chats in your Next.js agent)
  async getTaskMessages(taskId: string): Promise<any[]> {
    return this.request(`/tasks/${taskId}/messages`);
  }
}







############
const client = new TerminalUseClient({
  bearerAuth: { token: process.env.TERMINALUSE_API_KEY! },
});

// 1. Advanced: Create project + FS + task (multi-tenant offload)
const project = await client.createProject({ namespace_id: 'ns_xxx', name: 'customer-abc' });
const fs = await client.createFilesystem({ project_id: project.id, name: 'workspace-123' });
const task = await client.createTask({
  agent_name: 'my-namespace/my-agent',
  filesystem_id: fs.id,
  params: { goal: 'process user data' },
});

// 2. Send event + stream response (real-time agent interaction)
await client.sendEvent(task.id, { type: 'text', text: 'Start analysis on /workspace/data.csv' });

const stream = client.streamTask(task.id);
for await (const event of stream) {
  console.log('Agent event:', event); // text, reasoning, tool calls, etc.
  // Update UI / logs / state in your Next.js app
}

// 3. Inspect persistent filesystem (post-task)
const files = await client.listFiles({ filesystem_id: fs.id, recursive: true });
const report = await client.getFile({ filesystem_id: fs.id, file_path: 'output/report.md', include_content: true });
