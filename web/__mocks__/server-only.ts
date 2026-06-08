/**
 * Mock for Next.js `server-only` module.
 *
 * The real `server-only` module throws when imported outside of a Server
 * Component context (e.g., in vitest).  This mock allows code with
 * `import 'server-only'` to be tested without modification.
 */
export default {};
