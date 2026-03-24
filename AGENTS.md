# binG Agent Guidelines

This file provides coding standards, build/test/lint commands, and development practices for agents working in the binG codebase.

## Table of Contents
1. [Development Commands](#development-commands)
2. [Code Style Guidelines](#code-style-guidelines)
3. [Testing Guidelines](#testing-guidelines)
4. [Linting & Formatting](#linting--formatting)
5. [TypeScript Guidelines](#typescript-guidelines)
6. [Error Handling Patterns](#error-handling-patterns)
7. [Import Conventions](#import-conventions)
8. [Naming Conventions](#naming-conventions)
9. [React/Specific Guidelines](#reactspecific-guidelines)
10. [File Organization](#file-organization)

## Development Commands

All commands are run with `pnpm` (package manager).

### Core Scripts
```bash
# Development
pnpm dev              # Start Next.js dev server (localhost:3000)
pnpm dev:ws           # Start WebSocket dev server (tsx server.ts)
pnpm dev:standard     # Standard dev mode
pnpm dev:opencode     # OpenCode dev mode

# Production
pnpm build            # Build for production (next build)
pnpm start            # Start production server
pnpm start:ws         # Start WebSocket server in production

# Maintenance
pnpm lint             # Run ESLint on all files
pnpm test             # Run all tests (vitest run)
pnpm test:watch       # Run tests in watch mode
pnpm test:ui          # Run tests with Vitest UI
pnpm test:coverage    # Run tests with coverage report
pnpm migrate          # Run database migrations
pnpm backup           # Backup database
```

### Test-Specific Commands
```bash
# Run specific test suites
pnpm test:e2e         # E2E tests (Playwright)
pnpm test:sandbox     # Sandbox provider tests
pnpm test:webcontainer # WebContainer integration tests
pnpm test:stateful-agent # Stateful agent tests
pnpm test:fast-agent  # Fast agent integration tests

# Run a single test file
npx vitest run path/to/test-file.test.ts

# Run a single test in watch mode
npx vitest path/to/test-file.test.ts
```

## Code Style Guidelines

### TypeScript Configuration (`tsconfig.json`)
- **Target**: ES2020
- **Module**: ESNext with bundler resolution
- **Strict Mode**: Disabled (`strict: false`)
- **JSX**: react-jsx
- **Path Alias**: `@/*` maps to `./` (use `@/lib/utils` style imports)
- **Lib**: dom, dom.iterable, esnext
- **Allow JS**: true
- **Skip Lib Check**: true
- **No Emit**: true (Next.js handles transpilation)
- **Incremental**: true

### Import Conventions
- Use `@/` alias for absolute imports: `import { foo } from '@/lib/utils'`
- Named imports preferred: `import { clsx, type ClassValue } from "clsx"`
- Default exports only for React components
- Order imports: 
  1. External libraries (react, next, etc.)
  2. Internal modules (@/ prefixed)
  3. Local files (relative paths)
  4. Types only imports (with `type` keyword)

### Formatting
- **Prettier** configured via `eslint-config-prettier`
- **Trailing commas**: ES5 style
- **Semicolons**: Required
- **Quotes**: Single quotes for strings
- **Line length**: No strict limit, but aim for readability
- **Indentation**: 2 spaces

## Testing Guidelines

### Test Framework
- **Vitest** for unit/integration tests
- **Playwright** for E2E tests
- **Test Environment**: Node.js (jsdom-like globals via `globals: true`)

### Test File Patterns
- **Pattern**: `*.test.ts` (NOT `*.spec.ts`)
- **Locations**:
  - `__tests__/**/*.test.ts` (primary location)
  - `test/**/*.test.ts`
  - `tests/e2e/**/*.test.ts` (E2E/Playwright)
  - `lib/**/*.test.ts`

### Test Setup (`test/setup.ts`)
Automatically imported for all tests provides:
- **Mocks**: 
  - `mockFetchSuccess()`, `mockFetchError()`, `mockFetchNetworkError()`
  - Fake timers (`advanceTime(ms)`, `runAllTimers()`)
  - LocalStorage/SessionStorage mocks
  - Browser APIs: matchMedia, ResizeObserver, IntersectionObserver
- **Fixtures**: 
  - `fixtures.user`, `fixtures.files`, `fixtures.sandbox`
  - `fixtures.apiKey`, `fixtures.workspace`
- **Utilities**:
  - `waitFor(condition, timeout)` - wait for async conditions
  - `nextTick()` - promise-based setTimeout
  - `suppressConsole()` - quiet test output
  - Custom matchers: `toBeValidDate()`, `toBeWithinRange()`
- **Configuration**: Set `TEST_QUIET=true` to suppress console logs

### Running Tests
```bash
# All tests
pnpm test

# Watch mode (development)
pnpm test:watch

# With coverage
pnpm test:coverage

# Specific suite
pnpm test:e2e

# Single file
npx vitest run __tests__/example.test.ts

# Single file watch
npx vitest __tests__/example.test.ts
```

### Test Organization
- **Unit Tests**: `__tests__/` with feature subdirectories (`auth/`, `sandbox/`, etc.)
- **Integration Tests**: `test/` directory
- **E2E Tests**: `tests/e2e/` (Playwright-based)
- **Test Coverage**: Configured to 50% minimum for stateful-agent lib

## Linting & Formatting

### ESLint Configuration (`eslint.config.js`)
- **Flat Config Format** (ESLint v9+)
- **Plugins**:
  - `@eslint/js` (recommended)
  - `typescript-eslint` (recommended)
  - `eslint-plugin-react` (recommended)
  - `eslint-plugin-react-hooks`
  - `@vitest/eslint-plugin` (for test files)
- **Ignores**: 
  - `node_modules`, `dist`, `.next`, `coverage`
  - Config files (`*.config.{js,mjs,ts}`)
- **Rules**:
  - `react-hooks/rules-of-hooks`: error
  - `react-hooks/exhaustive-deps`: warn
  - `@typescript-eslint/no-unused-vars`: warn (allows `^_` prefix)
  - `typescript-eslint/no-explicit-any`: warn
  - `typescript-eslint/prefer-nullish-coalescing`: warn
  - `react/react-in-jsx-scope`: off
  - `react/prop-types`: off
  - `react/jsx-no-target-blank`: off
  - Vitest plugin: recommended rules for test files

### Additional Config Files
- **Tailwind CSS** (`tailwind.config.ts`): Custom colors, animations, breakpoints
- **PostCSS** (`postcss.config.mjs`): Tailwind CSS plugin
- **Next.js** (`next.config.mjs`): Custom image loader, security headers, Turbopack
- **Jest Config** (`jsconfig.json`): Path aliases

## TypeScript Guidelines

### Type Usage
- **Prefer** explicit types over inference for public APIs
- **Use** `interface` for object shapes, `type` for unions/maps/complex types
- **Avoid** `any`; use `unknown` when type is uncertain
- **Never** suppress type errors with `@ts-ignore` or `as any` without comment
- **Enable** strict null checks in new code when possible

### React Specific
- **Component Props**: Define with `interface` or `type`
- **Event Handlers**: Use React's synthetic event types (`React.MouseEvent`, etc.)
- **Children**: Use `React.ReactNode` for flexible children
- **Context**: Provide default values or use discriminators for undefined checks
- **Hooks**: Custom hooks should start with `use`

### Async/Await
- **Prefer** `async/await` over `.then()` chains
- **Always** await promises or handle rejections
- **Use** try/catch for error handling in async functions
- **Avoid** fire-and-forget without error logging

## Error Handling Patterns

### General Principles
1. **Never** swallow errors without logging
2. **Provide** context in error messages (what failed, why, relevant data)
3. **Use** descriptive error messages for debugging
4. **Handle** errors at the appropriate level (don't let them bubble unnecessarily)
5. **Return** meaningful error responses to users/clients

### Common Patterns Seen in Codebase

#### Try/Catch with Fallback
```typescript
try {
  // Operation that might fail
  const result = await riskyOperation();
  return result;
} catch (error) {
  // Log with context
  console.error('[ServiceName] Operation failed:', {
    message: error.message,
    // Include relevant context
    userId, requestId, timestamp
  });
  
  // Graceful fallback or re-throw
  return fallbackValue; // or throw new Error('Custom message');
}
```

#### Async Error Handling
```typescript
try {
  const data = await fetchData();
  return { success: true, data };
} catch (error: any) {
  // Type assertion for error properties
  console.error('[API] Fetch failed:', error.message);
  
  // Return structured error
  return {
    success: false,
    error: error.message || 'Unknown error',
    // Optionally include error code for client handling
    code: error.code ?? 'FETCH_ERROR'
  };
}
```

#### Validation Errors
```typescript
if (!isValidInput(input)) {
  throw new Error(`Invalid input: ${input}. Must be a valid email address.`);
}
```

#### Browser API Safety
```typescript
// Always check for browser API availability
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    // Handle quota exceeded or security errors
    console.warn('LocalStorage unavailable:', e.message);
    return null;
  }
}
return null; // SSR safety
```

## Import Conventions

### Path Aliases
- **Configured**: `@/*` → `./` (in `tsconfig.json` and `jsconfig.json`)
- **Usage**: 
  - `@/lib/utils` → `lib/utils.ts`
  - `@/components/Button` → `components/Button.tsx`
  - `@/hooks/useAuth` → `hooks/useAuth.ts`
  - `@/types` → `types/`

### Import Order
1. **External Dependencies** (react, next, lodash, etc.)
   ```typescript
   import React from 'react';
   import { useState } from 'react';
   import next from 'next';
   ```
2. **Internal Absolute Imports** (@/ prefixed)
   ```typescript
   import { getUser } from '@/lib/auth';
   import { Button } from '@/components/ui';
   ```
3. **Relative Imports** (for adjacent files)
   ```typescript
   import { helper } from './utils';
   import { constants } from '../constants';
   ```
4. **Type-Only Imports** (when only importing types)
   ```typescript
   import type { UserProps } from './types';
   import type { APIResponse } from '@/lib/api';
   ```

### What to Avoid
- **Barrel exports** (`import { utils } from '@/lib'`) - prefer explicit paths
- **Relative paths** jumping many levels (`../../../utils`) - use `@/` alias
- **Default imports** for named exports (unless it's a React component)

## Naming Conventions

### Files & Directories
- **kebab-case** for directories and non-component files: `utils/`, `api-routes/`
- **PascalCase** for components and pages: `UserProfile.tsx`, `dashboard.tsx`
- **camelCase** for hooks and utilities: `useAuth.ts`, `formatDate.ts`

### Variables & Functions
- **camelCase** for variables, functions, parameters: `userCount`, `calculateTotal()`
- **UPPER_SNAKE_CASE** for constants: `MAX_RETRIES`, `API_TIMEOUT_MS`
- **Prefix booleans** with `is`, `has`, `should`: `isVisible`, `hasLoaded`, `shouldValidate`

### Components
- **PascalCase** matching filename: `Button.tsx` exports `Button` component
- **Descriptive names**: `AuthModal`, `DataTable`, `LoadingSpinner`
- **Avoid** generic names like `Container`, `Wrapper` without context

### Types & Interfaces
- **PascalCase** matching filename: `User.ts` exports `interface User`
- **Descriptive names**: `UserCredentials`, `APIResponse`, `FormState`
- **Suffix** with `Props` for component props: `ButtonProps`, `FormProps`
- **Suffix** with `State` for state objects: `FormState`, `UIState`

### Tests
- **Filename**: `[name].test.ts` (e.g., `auth-utils.test.ts`)
- **Test blocks**: `describe()`, `it()` with clear descriptions
- **Mocks**: Prefix with `mock`: `mockFetch`, `mockUser`

## React/Specific Guidelines

### Component Structure
- **Function Components** only (no class components)
- **Arrow function** or regular function syntax acceptable
- **Early returns** for conditional rendering:
  ```typescript
  if (!user) return <SignInPrompt />;
  if (loading) return <Spinner />;
  return <UserDashboard user={user} />;
  ```
- **Fragment usage** `<>...</>` for wrappers without extra DOM nodes
- **Key props** on list items: `items.map(item => (<div key={item.id}>...</div>))`

### Hooks Rules
- **Only call hooks** at top level (never in loops, conditions, or nested functions)
- **Only call hooks** from React functions or custom hooks
- **Custom hooks** start with `use`: `useFetch`, `useFormState`
- **Return arrays** stateful hooks: `[state, setState]` (follow useState convention)
- **Return objects** for complex hooks: `{ data, loading, error }`

### Styling
- **Tailwind CSS** primary styling method
- **CSS Modules** for component-scoped styles when needed
- **Inline styles** only for dynamic values calculated at runtime
- **Variants** using `clsx` or `tailwind-merge`:
  ```typescript
  import { twMerge } from 'tailwind-merge';
  
  const btnVariants = twMerge(
    'base-button',
    isPrimary && 'btn-primary',
    isDisabled && 'btn-disabled',
    size === 'large' && 'btn-large'
  );
  ```

### Accessibility
- **Alt text** on all meaningful images: `<img alt="Description" src={url} />`
- **Labels** for form inputs: `<label htmlFor="email">Email</label>`
- **Semantic HTML**: use `button`, `nav`, `main`, `section` appropriately
- **Focus management** for modals and traps
- **ARIA attributes** when native HTML insufficient

## File Organization

### Top-Level Directories
```
/app                 # Next.js app router (pages, layouts, components)
/components          # Reusable UI components
/context             # React context providers
/hooks               # Custom React hooks
/lib                 # Utility functions, services, API helpers
/middleware          # Next.js middleware
/public              # Static assets
/scripts             # Node.js scripts (migrations, backups, etc.)
/styles              # Global CSS, Tailwind configuration
/test                # Test setup and integration tests
/tests               # E2E tests (Playwright)
/__tests__           # Unit and integration tests (Vitest)
/types               # TypeScript type definitions
/utils               # Utility functions (alias for lib in some contexts)
/config              # Configuration files (feature flags, etc.)
/docs                # Documentation
```

### Key Files
- **package.json** - Project metadata, scripts, dependencies
- **tsconfig.json** - TypeScript compiler configuration
- **next.config.mjs** - Next.js specific configuration
- **tailwind.config.ts** - Tailwind CSS configuration
- **eslint.config.js** - ESLint configuration
- **vitest.config.ts** - Vitest test configuration
- **middleware.ts** - Next.js middleware (auth, headers, etc.)
- **server.ts** - WebSocket/server logic
- **env.example** - Environment variable template

## Agent-Specific Guidelines

### When Modifying Existing Code
1. **Match existing patterns** in the file you're modifying
2. **Follow established conventions** for imports, error handling, naming
3. **Don't introduce** new patterns without consensus
4. **Update tests** when modifying logic
5. **Run linting** before considering work complete

### When Creating New Files
1. **Place in appropriate directory** following existing structure
2. **Use correct file extension** (.ts for logic, .tsx for JSX/React)
3. **Follow naming conventions** for the file type
4. **Include appropriate imports** using @/ alias
5. **Add corresponding tests** in the relevant test directory

### Code Review Checklist for Agents
- [ ] Code follows existing style and conventions
- [ ] No TypeScript errors (check with `pnpm lint` includes type checking)
- [ ] Tests pass for modified functionality (`pnpm test` or specific test)
- [ ] Error handling follows established patterns
- [ ] Imports use @/ alias appropriately
- [ ] Component names match file names (PascalCase)
- [ ] No console.log statements left in production code
- [ ] Sensitive data not logged (tokens, passwords, etc.)
- [ ] Environment variables accessed through proper config
- [ ] Edge cases handled (null, undefined, empty arrays)

## Additional Notes

### Environment Variables
- Copy `env.example` to `.env.local` for development
- Never commit actual `.env` files
- Required variables: at least one LLM provider key (OpenRouter, Google, Anthropic, etc.)
- Sandbox provider: Daytona (default), Blaxel, Runloop, or Sprites

### Debugging
- Use `console.debug()` or conditional logging based on environment
- In development: verbose logging helpful
- In production: limit to warnings and errors
- Consider using a logging library for complex applications

### Performance
- Use `React.memo()` for components with stable props
- Use `useMemo()` and `useCallback()` for expensive computations
- Lazy load routes and heavy components with `next/dynamic`
- Optimize images with Next.js Image component
- Leverage Next.js caching and ISR where appropriate

---

*This guide is based on analysis of the binG codebase as of March 2024. 
When in doubt, examine existing similar code in the repository.*