import { open } from "node:fs/promises";
import { unlink } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const PID_FILE = join(tmpdir(), "bing-backend.lock");

let _releaseLock: (() => void) | null = null;

export async function acquireSingletonLock(): Promise<boolean> {
  const MAX_WAIT_MS = 5000;
  const POLL_INTERVAL_MS = 100;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const fd = await open(PID_FILE, "wx");
      await fd.writeFile(String(process.pid), { encoding: "utf8" });
      await fd.close();

      _releaseLock = () => {
        unlink(PID_FILE).catch(() => {});
        _releaseLock = null;
      };

      return true;
    } catch (err: any) {
      if (err.code !== "EEXIST") throw err;

      try {
        const content = await readFile(PID_FILE, "utf8");
        const oldPid = parseInt(content.trim(), 10);

        if (oldPid && oldPid !== process.pid) {
          try {
            process.kill(oldPid, 0);
          } catch {
            await unlink(PID_FILE).catch(() => {});
            continue;
          }
        }
      } catch {
        await unlink(PID_FILE).catch(() => {});
        continue;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  return false;
}

export function releaseSingletonLock(): void {
  if (_releaseLock) {
    _releaseLock();
  }
}

process.on("SIGTERM", () => {
  releaseSingletonLock();
  process.exit(0);
});
process.on("SIGINT", () => {
  releaseSingletonLock();
  process.exit(0);
});
process.on("exit", () => {
  releaseSingletonLock();
});