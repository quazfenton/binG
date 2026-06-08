```markdown
# binG Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides guidance on contributing to the `binG` TypeScript codebase. It covers coding conventions, file organization, import/export styles, and the primary workflow for managing dependencies across multiple packages. The repository does not use a major framework and follows clear, consistent patterns for maintainability.

## Coding Conventions

### File Naming
- Use **kebab-case** for all file names.
  - Example:  
    ```
    my-feature-file.ts
    another-helper.test.ts
    ```

### Import Style
- Use **relative imports** throughout the codebase.
  - Example:  
    ```typescript
    import { myFunction } from './utils';
    ```

### Export Style
- Use **named exports** rather than default exports.
  - Example:  
    ```typescript
    // In utils.ts
    export function myFunction() { ... }

    // In another file
    import { myFunction } from './utils';
    ```

## Workflows

### Multi-Package Dependency Upgrade
**Trigger:** When you need to update one or more npm dependencies across all packages/directories in the monorepo to keep them up to date.  
**Command:** `/upgrade-dependencies`

**Step-by-step instructions:**
1. **Identify outdated dependencies** in each package.
   - Use tools like `npm outdated` or `pnpm outdated` within each package directory.
2. **Update the version** in `package.json` for each affected package.
   - Manually edit or use `npm install <package>@latest` or `pnpm up <package>` in each directory.
3. **Regenerate lock files** for each updated package.
   - Run `npm install` or `pnpm install` to update `package-lock.json` or `pnpm-lock.yaml`.
4. **Commit all updated files together**.
   - Stage and commit all changed `package.json` and lock files in a single commit.

**Files involved:**
- `*/package.json`
- `*/package-lock.json`
- `*/pnpm-lock.yaml`
- `package.json`
- `package-lock.json`
- `pnpm-lock.yaml`

**Frequency:** ~2-4 times per month

**Example commit message:**
```
chore: upgrade dependencies across all packages
```

## Testing Patterns

- Test files use the pattern `*.test.*` (e.g., `my-feature.test.ts`).
- The specific testing framework is not detected, but tests are colocated with source files or in dedicated test files.
- Example test file:
  ```typescript
  // math-utils.test.ts
  import { add } from './math-utils';

  test('adds numbers', () => {
    expect(add(2, 3)).toBe(5);
  });
  ```

## Commands

| Command               | Purpose                                                         |
|-----------------------|-----------------------------------------------------------------|
| /upgrade-dependencies | Upgrade npm dependencies across all packages in the monorepo    |
```
