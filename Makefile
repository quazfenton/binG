# bing Makefile
# Convenience targets for repo maintenance. Project build/test commands
# live in package.json — this file is for dev tooling that wraps git/npm.

.PHONY: install-hooks hooks help

help:
	@echo "bing make targets:"
	@echo "  install-hooks  Install git hooks (pre-commit, pre-push, post-merge,"
	@echo "                 pre-checkout) as symlinks to canonical sources under"
	@echo "                 scripts/. Idempotent — safe to run repeatedly. The"
	@echo "                 post-merge and pre-checkout hooks auto-reinstall on"
	@echo "                 every pull and branch switch, respectively."

# Install git hooks (pre-commit, pre-push, post-merge, pre-checkout) via symlink.
# Idempotent — safe to run multiple times. The post-merge hook auto-reinstalls
# hooks on every `git pull` and the pre-checkout hook does the same before
# branch switches, so they never drift apart from the canonical sources in
# scripts/.
install-hooks:
	@bash scripts/install-hooks.sh

# Alias for muscle memory.
hooks: install-hooks
