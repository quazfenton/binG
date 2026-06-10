/**
 * Generic client-side stub for server-only npm packages.
 *
 * Replaces packages like mcporter, modal, tar, node-fetch, @daytonaio/sdk
 * that leak into client bundles via transitive imports. These packages
 * require Node.js built-ins (fs, net, child_process) that don't exist
 * in browser contexts.
 *
 * Returns a no-op proxy that silently accepts any property access or
 * function call, preventing runtime crashes when server-only code is
 * inadvertently imported by client components.
 */
const stub = new Proxy(function () { return stub; } as any, {
  get(_target: any, _prop: string | symbol) {
    return stub;
  },
  apply(_target: any, _thisArg: any, _args: any[]) {
    return stub;
  },
  construct(_target: any, _args: any[]) {
    return stub;
  },
});

export default stub;
