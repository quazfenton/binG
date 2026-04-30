---
id: 1-folder-structure-single-repo-no-duplication
title: "\U0001F9F1 1. Folder structure (single repo, no duplication)"
aliases:
  - desktopScouts
  - desktopScouts.md
tags: []
layer: core
summary: "Alright—here’s a **real, minimal but production-grade pattern** you can drop into your Next.js + Tauri setup to avoid duplication and cleanly support both web + desktop.\r\n\r\n---\r\n\r\n# \U0001F9F1 1. Folder structure (single repo, no duplication)\r\n\r\n```\r\n/src\r\n  /lib\r\n    /platform\r\n      /storage\r\n        inde"
anchors:
  - index.ts (shared entry)
  - web.ts
  - desktop.ts (Tauri FS)
  - index.ts
  - web.ts
  - desktop.ts
  - 'Run web:'
  - 'Run desktop:'
  - "\U0001F510 1. Secrets / API keys"
  - Problem
  - Solution
  - "\U0001F9F5 2. Background jobs (VERY useful for LLM apps)"
  - 'Use cases:'
  - 'Desktop advantage:'
  - 'Simple abstraction:'
  - "\U0001F514 3. Notifications"
  - "\U0001FA9F 4. Window control (desktop-only UX boost)"
  - "\U0001F310 5. Network layer (important for local models)"
  - "\U0001F9E0 6. Clipboard + drag/drop"
  - 'Additional abstractions:'
---
Alright—here’s a **real, minimal but production-grade pattern** you can drop into your Next.js + Tauri setup to avoid duplication and cleanly support both web + desktop.

---

# 🧱 1. Folder structure (single repo, no duplication)

```
/src
  /lib
    /platform
      /storage
        index.ts
        web.ts
        desktop.ts
      /fs
        index.ts
        web.ts
        desktop.ts
      env.ts

/src-tauri
  tauri.conf.json
  main.rs

/desktop
  (optional overrides if needed)

/next.config.js
/package.json
```

---

# 🌍 2. Environment detection (core switch)

```ts
// src/lib/platform/env.ts
export const isDesktop =
  typeof window !== "undefined" &&
  "__TAURI__" in window;

export const isWeb = !isDesktop;
```

---

# 💾 3. Storage abstraction (localStorage → filesystem)

## index.ts (shared entry)

```ts
// src/lib/platform/storage/index.ts
import { isDesktop } from "../env";

import * as web from "./web";
import * as desktop from "./desktop";

export const storage = isDesktop ? desktop : web;
```

---

## web.ts

```ts
// src/lib/platform/storage/web.ts
export const get = (key: string) => {
  const value = localStorage.getItem(key);
  return value ? JSON.parse(value) : null;
};

export const set = (key: string, value: any) => {
  localStorage.setItem(key, JSON.stringify(value));
};

export const remove = (key: string) => {
  localStorage.removeItem(key);
};
```

---

## desktop.ts (Tauri FS)

```ts
// src/lib/platform/storage/desktop.ts
import { writeTextFile, readTextFile, exists, BaseDirectory } from "@tauri-apps/api/fs";

const baseDir = BaseDirectory.AppData;

const pathForKey = (key: string) => `${key}.json`;

export const get = async (key: string) => {
  const path = pathForKey(key);

  const fileExists = await exists(path, { dir: baseDir });
  if (!fileExists) return null;

  const content = await readTextFile(path, { dir: baseDir });
  return JSON.parse(content);
};

export const set = async (key: string, value: any) => {
  const path = pathForKey(key);

  await writeTextFile(path, JSON.stringify(value), {
    dir: baseDir,
  });
};

export const remove = async (key: string) => {
  const path = pathForKey(key);
  // optional: implement delete
};
```

---

# 📁 4. File system abstraction

## index.ts

```ts
// src/lib/platform/fs/index.ts
import { isDesktop } from "../env";

import * as web from "./web";
import * as desktop from "./desktop";

export const fs = isDesktop ? desktop : web;
```

---

## web.ts

```ts
// src/lib/platform/fs/web.ts
export const readFile = async (file: File) => {
  return await file.text();
};
```

---

## desktop.ts

```ts
// src/lib/platform/fs/desktop.ts
import { readTextFile } from "@tauri-apps/api/fs";

export const readFile = async (path: string) => {
  return await readTextFile(path);
};
```

---

# 🔌 5. Example usage (same code everywhere)

```ts
import { storage } from "@/lib/platform/storage";

export async function saveChat(history: any[]) {
  await storage.set("chat-history", history);
}

export async function loadChat() {
  return await storage.get("chat-history");
}
```

👉 This works in:

* browser (localStorage)
* desktop (real files)

---

# 🌐 6. API client abstraction (important for LLM apps)

```ts
// src/lib/platform/apiClient.ts
import { isDesktop } from "./env";

export const apiFetch = async (url: string, options?: RequestInit) => {
  if (isDesktop) {
    // Tauri fetch works, but you can customize here
    return fetch(url, options);
  }

  return fetch(url, options);
};
```

---

# 🧠 7. Streaming (LLM responses)

Works mostly the same, but guard it:

```ts
export async function streamCompletion(res: Response) {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No stream");

  const decoder = new TextDecoder();

  let result = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    result += decoder.decode(value);
    console.log(result);
  }

  return result;
}
```

---

# ⚙️ 8. Tauri config (minimal)

```json
// src-tauri/tauri.conf.json
{
  "build": {
    "devUrl": "http://localhost:3000",
    "frontendDist": "../out"
  },
  "tauri": {
    "allowlist": {
      "fs": {
        "all": true
      }
    }
  }
}
```

---

# 📦 9. Next.js build config

```js
// next.config.js
module.exports = {
  output: "export", // for static build
};
```

---

# 🚀 10. Dev workflow

### Run web:

```
npm run dev
```

### Run desktop:

```
npm run build
npx tauri dev
```

---

# 🔁 11. Optional: Desktop-only overrides

If needed:

```
/desktop/storage.ts
```

Then:

```ts
const storage = isDesktop
  ? require("../../../desktop/storage")
  : require("./web");
```

(Use sparingly—prefer shared abstractions.)

---

# 🧩 12. What you just achieved

* ✅ One codebase
* ✅ No duplication
* ✅ Clean platform switching
* ✅ Desktop-only power (filesystem, etc.)
* ✅ Web still works unchanged

---
* 📂 drag-and-drop file context system
* 🧠 persistent vector memory using local files

Those are examples of where Tauri really starts outperforming web.

Good instincts—once you’ve done storage + fs, you’re ~60% of the way there. The remaining abstractions are what make an LLM app feel *native* on desktop instead of “a web app in a shell.”

I’ll break this into two parts:

---

# 🧱 Part 1 — Other abstractions you’ll likely need

These are the ones that actually matter in real LLM apps (beyond storage/fs).

---

## 🔐 1. Secrets / API keys

### Problem

* Web: `localStorage` / env vars (unsafe)
* Desktop: you can store securely

### Solution

Use Tauri’s secure store (or OS keychain)

```ts
// src/lib/platform/secrets/index.ts
import { isDesktop } from "../env";

export const secrets = {
  async get(key: string) {
    if (isDesktop) {
      const { getPassword } = await import("@tauri-apps/api/tauri");
      return getPassword(key); // or plugin
    }
    return localStorage.getItem(`secret:${key}`);
  },

  async set(key: string, value: string) {
    if (isDesktop) {
      const { setPassword } = await import("@tauri-apps/api/tauri");
      return setPassword(key, value);
    }
    localStorage.setItem(`secret:${key}`, value);
  },
};
```

---

## 🧵 2. Background jobs (VERY useful for LLM apps)

### Use cases:

* embedding documents
* indexing files
* long-running completions

### Desktop advantage:

You can offload to Rust (true parallelism)

### Simple abstraction:

```ts
// src/lib/platform/jobs.ts
export const runJob = async (name: string, payload: any) => {
  if (isDesktop) {
    const { invoke } = await import("@tauri-apps/api/tauri");
    return invoke(name, payload);
  }

  // fallback: run in JS
  return await jobs[name](payload);
};
```

---

## 🔔 3. Notifications

```ts
export const notify = async (title: string, body: string) => {
  if (isDesktop) {
    const { sendNotification } = await import("@tauri-apps/api/notification");
    return sendNotification({ title, body });
  }

  new Notification(title, { body });
};
```

---

## 🪟 4. Window control (desktop-only UX boost)

* split chat + editor windows
* floating panels

```ts
export const windowControl = async () => {
  if (!isDesktop) return;

  const { appWindow } = await import("@tauri-apps/api/window");
  appWindow.setTitle("LLM Studio");
};
```

---

## 🌐 5. Network layer (important for local models)

Abstract this so you can switch between:

* OpenAI
* local server (`localhost:11434`, etc.)
* Rust-side inference

---

## 🧠 6. Clipboard + drag/drop

Huge for coding apps:

```ts
export const clipboard = {
  async read() {
    if (isDesktop) {
      const { readText } = await import("@tauri-apps/api/clipboard");
      return readText();
    }
    return navigator.clipboard.readText();
  },
};
```

---

# ✅ TL;DR

### Additional abstractions:

* secrets (API keys)
* jobs (background work)
* notifications
* clipboard
* window control
* network layer

---

