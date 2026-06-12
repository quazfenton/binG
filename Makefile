# bing Makefile
# Convenience targets for repo maintenance. Project build/test commands
# live in package.json — this file is for dev tooling that wraps git/npm.

.PHONY: install-hooks hooks help

help:
	@echo "bing make targets:"
	@echo "  install-hooks  Install git hooks (pre-commit, pre-push, post-merge)"
	@echo "                 as symlinks to canonical sources under scripts/."
	@echo "                 Idempotent — safe to run repeatedly. The"
	@echo "                 post-merge hook auto-reinstalls on every pull."

# Install git hooks (pre-commit, pre-push, post-merge) via symlink.
# Idempotent — safe to run multiple times. The post-merge hook will
# auto-reinstall hooks on every `git pull` so they never drift apart
# from the canonical sources in scripts/.
install-hooks:
	@bash scripts/install-hooks.sh

# Alias for muscle memory.
hooks: install-hooks
