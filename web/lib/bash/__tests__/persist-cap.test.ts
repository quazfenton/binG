/**
 * Unit tests for shouldPersistBashOutput (Bash:Tool).
 *
 * Bug #28: cap persist:true bash_execute at maxPersistMs and never
 * persist long-running daemons. A single `npm run dev &` or a multi-hour
 * `find /` would silently fill the VFS.
 */
import { describe, it, expect } from 'vitest';
import { shouldPersistBashOutput } from '../bash-tool';

describe('shouldPersistBashOutput', () => {
  const cfg = { maxPersistMs: 30000 };

  describe('daemon detection (always refused, regardless of duration)', () => {
    it('refuses nohup commands', () => {
      const r = shouldPersistBashOutput('nohup npm run dev', { duration: 100, success: true }, cfg);
      expect(r.persist).toBe(false);
      expect(r.reason).toBe('daemon_detected');
    });

    it('refuses trailing-background `&`', () => {
      expect(shouldPersistBashOutput('npm run dev &', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('python server.py &', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses mid-pipeline `& |`', () => {
      const r = shouldPersistBashOutput('node server.js & | tee log.txt', { duration: 100, success: true }, cfg);
      expect(r.persist).toBe(false);
      expect(r.reason).toBe('daemon_detected');
    });

    it('refuses disown', () => {
      const r = shouldPersistBashOutput('npm test & disown', { duration: 100, success: true }, cfg);
      expect(r.persist).toBe(false);
    });

    it('refuses pm2 start/restart/reload', () => {
      expect(shouldPersistBashOutput('pm2 start app.js', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('pm2 restart app', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses systemctl start/restart/enable', () => {
      expect(shouldPersistBashOutput('systemctl start nginx', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('systemctl restart nginx', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses service <name> start/restart', () => {
      expect(shouldPersistBashOutput('service nginx start', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('service sshd restart', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses flask/django/uvicorn/gunicorn/fastapi run', () => {
      for (const cmd of ['flask run', 'django runserver', 'uvicorn app:app', 'gunicorn app:app', 'fastapi run']) {
        const r = shouldPersistBashOutput(cmd, { duration: 100, success: true }, cfg);
        expect(r.persist).toBe(false);
        expect(r.reason).toBe('daemon_detected');
      }
    });

    it('refuses npm/pnpm/yarn run dev|start|serve|watch', () => {
      for (const cmd of [
        'npm run dev',
        'npm start',
        'pnpm run dev',
        'pnpm serve',
        'yarn watch',
      ]) {
        expect(shouldPersistBashOutput(cmd, { duration: 100, success: true }, cfg).persist).toBe(false);
      }
    });

    it('refuses next/vite/nuxt/remix dev|start', () => {
      for (const cmd of ['next dev', 'vite', 'nuxt dev', 'remix dev', 'svelte-kit dev']) {
        expect(shouldPersistBashOutput(cmd, { duration: 100, success: true }, cfg).persist).toBe(false);
      }
    });

    it('refuses docker/podman run with --detach / -d', () => {
      expect(shouldPersistBashOutput('docker run --detach nginx', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('docker run -d nginx', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('podman run --detach nginx', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('podman run -d nginx', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses tail -f (foreground or combined flags)', () => {
      expect(shouldPersistBashOutput('tail -f /var/log/app.log', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('tail -Fn 100 file.log', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses `watch` and `while true` infinite loops', () => {
      expect(shouldPersistBashOutput('watch -n1 ls', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('while true; do echo x; done', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses long sleep (3+ digits) and infinite-sleep', () => {
      expect(shouldPersistBashOutput('sleep 600', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('sleep infinity', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('refuses `ping` without an explicit -c count (runs until interrupted)', () => {
      expect(shouldPersistBashOutput('ping google.com', { duration: 100, success: true }, cfg).persist).toBe(false);
      expect(shouldPersistBashOutput('ping 8.8.8.8', { duration: 100, success: true }, cfg).persist).toBe(false);
    });

    it('does NOT refuse `ping` when -c is provided (bounded run)', () => {
      expect(shouldPersistBashOutput('ping -c 3 localhost', { duration: 200, success: true }, cfg).persist).toBe(true);
      expect(shouldPersistBashOutput('ping -c1 8.8.8.8', { duration: 200, success: true }, cfg).persist).toBe(true);
    });

    it('does NOT refuse short sleeps (count <3 digits)', () => {
      expect(shouldPersistBashOutput('sleep 5', { duration: 200, success: true }, cfg).persist).toBe(true);
      expect(shouldPersistBashOutput('sleep 60', { duration: 200, success: true }, cfg).persist).toBe(true);
    });
  });

  describe('duration cap (maxPersistMs)', () => {
    it('persists when duration is within cap', () => {
      const r = shouldPersistBashOutput('ls -la', { duration: 100, success: true }, cfg);
      expect(r.persist).toBe(true);
      expect(r.reason).toBeUndefined();
    });

    it('persists when duration is exactly at the cap', () => {
      const r = shouldPersistBashOutput('ls -la', { duration: 30000, success: true }, cfg);
      expect(r.persist).toBe(true);
    });

    it('refuses when duration exceeds cap', () => {
      const r = shouldPersistBashOutput('ls -la', { duration: 30001, success: true }, cfg);
      expect(r.persist).toBe(false);
      expect(r.reason).toBe('duration_exceeded_cap');
    });

    it('uses default cap of 30000ms when config.maxPersistMs is undefined', () => {
      const r = shouldPersistBashOutput('ls -la', { duration: 100, success: true }, {});
      expect(r.persist).toBe(true);
      const r2 = shouldPersistBashOutput('ls -la', { duration: 100000, success: true }, {});
      expect(r2.persist).toBe(false);
      expect(r2.reason).toBe('duration_exceeded_cap');
    });

    it('honors a custom cap', () => {
      const custom = { maxPersistMs: 5000 };
      expect(shouldPersistBashOutput('ls -la', { duration: 100, success: true }, custom).persist).toBe(true);
      expect(shouldPersistBashOutput('ls -la', { duration: 5001, success: true }, custom).persist).toBe(false);
    });

    it('persists on failed (non-zero exit) commands within the cap', () => {
      // Persistence is about output size, not exit code.
      const r = shouldPersistBashOutput('ls /nonexistent', { duration: 50, success: false }, cfg);
      expect(r.persist).toBe(true);
    });
  });

  describe('precedence: daemon beats duration', () => {
    it('refuses a daemon that finishes within the cap', () => {
      const r = shouldPersistBashOutput('nohup echo done', { duration: 10, success: true }, cfg);
      expect(r.persist).toBe(false);
      expect(r.reason).toBe('daemon_detected');
    });
  });

  describe('edge cases', () => {
    it('handles an empty command without throwing', () => {
      const r = shouldPersistBashOutput('', { duration: 100, success: true }, cfg);
      expect(r.persist).toBe(true);
    });

    it('does not refuse a command merely containing `&` inside a quoted string', () => {
      // `echo "a & b"` is a literal echo, not a backgrounding — our regex requires
      // `&` followed by `|`, `&`, or EOL, so this should pass.
      const r = shouldPersistBashOutput('echo "a & b"', { duration: 100, success: true }, cfg);
      expect(r.persist).toBe(true);
    });

    it('handles newline-separated command lists (multi-line scripts)', () => {
      const r = shouldPersistBashOutput('npm install\nnpm test', { duration: 100, success: true }, cfg);
      // No daemon patterns — should persist.
      expect(r.persist).toBe(true);
    });
  });
});
