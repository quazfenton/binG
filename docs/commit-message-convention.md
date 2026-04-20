---
id: commit-message-convention
title: Commit Message Convention
aliases:
  - CONVENTIONAL_COMMITS
  - CONVENTIONAL_COMMITS.md
  - commit-message-convention
  - commit-message-convention.md
tags: []
layer: core
summary: "# Commit Message Convention\r\n\r\nThis project follows [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages.\r\n\r\n## Format\r\n\r\n```\r\n<type>(<scope>): <description>\r\n\r\n[optional body]\r\n\r\n[optional footer(s)]\r\n```\r\n\r\n## Types\r\n\r\n- `feat`: A new feature\r\n- `fix`: A b"
anchors:
  - Format
  - Types
  - Scopes
  - Examples
  - Feature
  - Bug Fix
  - Documentation
  - Breaking Change
  - Pre-commit Hook
  - Installation
  - Manual Validation
  - Tools
  - Interactive Commit
  - Benefits
  - Resources
---
# Commit Message Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification for commit messages.

## Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

## Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Changes to build process or auxiliary tools
- `ci`: CI/CD configuration changes
- `build`: Build system or external dependencies
- `revert`: Reverting a previous commit

## Scopes

Common scopes (use what's most appropriate):

- `agent`: Agent-related changes
- `sandbox`: Sandbox provider changes
- `api`: API route changes
- `ui`: UI component changes
- `mcp`: MCP server changes
- `events`: Event system changes
- `orchestra`: Orchestration changes
- `deps`: Dependencies
- `config`: Configuration files
- `docs`: Documentation

## Examples

### Feature
```
feat(agent): add self-healing with retry logic

Implemented automatic retry with exponential backoff for failed agent steps.

Closes #123
```

### Bug Fix
```
fix(sandbox): resolve memory leak in warm pool

Fixed issue where sandbox handles weren't being properly released.

Fixes #456
```

### Documentation
```
docs: update MCP server setup instructions

Added detailed steps for Smithery and JFrog registration.
```

### Breaking Change
```
feat(api)!: change event schema structure

BREAKING CHANGE: Event payload structure has changed. Update clients to use new schema.

Migration guide: ...
```

## Pre-commit Hook

A pre-commit hook validates commit messages automatically.

### Installation

```bash
# Install husky
pnpm install -D husky
npx husky init

# Add commit message hook
echo "npx --no -- commitlint --edit $1" > .husky/commit-msg
chmod +x .husky/commit-msg
```

### Manual Validation

```bash
# Validate last commit message
npx commitlint --from=HEAD~1

# Validate range
npx commitlint --from=HEAD~5 --to=HEAD
```

## Tools

- [commitlint](https://commitlint.js.org/) - Lint commit messages
- [husky](https://typicode.github.io/husky/) - Git hooks
- [cz-conventional-changelog](https://github.com/commitizen/cz-conventional-changelog) - Interactive commit CLI

### Interactive Commit

```bash
# Install commitizen
pnpm install -D commitizen cz-conventional-changelog

# Configure package.json
{
  "config": {
    "commitizen": {
      "path": "cz-conventional-changelog"
    }
  }
}

# Use interactive commit
pnpm exec cz
```

## Benefits

- ✅ Automated changelog generation
- ✅ Semantic versioning support
- ✅ Better commit history readability
- ✅ Easier code review
- ✅ Clear intent in commit messages

## Resources

- [Conventional Commits Specification](https://www.conventionalcommits.org/)
- [Commitlint Rules](https://commitlint.js.org/)
- [Angular Commit Message Guidelines](https://github.com/angular/angular/blob/master/CONTRIBUTING.md#commit)
