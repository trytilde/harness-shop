# Harness — experiment runner
#
# Common entry points for setting up the project and the cocoindex-code
# binary that drives codebase indexing.

SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

UV_BIN ?= $(HOME)/.local/bin/uv
CCC_BIN ?= $(HOME)/.local/bin/ccc
PNPM ?= pnpm

.PHONY: help
help:
	@echo "Harness targets:"
	@echo "  make setup          — pnpm install + cocoindex-code"
	@echo "  make install        — pnpm install only"
	@echo "  make setup-ccc      — install/upgrade cocoindex-code via uv"
	@echo "  make ccc-doctor     — run \`ccc doctor\` to verify the install"
	@echo "  make ccc-version    — print the cocoindex-code version"
	@echo "  make dev            — run the dev server (port 3100)"
	@echo "  make build          — production build"
	@echo "  make typecheck      — tsc --noEmit"
	@echo "  make clean          — remove node_modules, data/, .cocoindex_code"

.PHONY: setup
setup: install setup-ccc setup-rg setup-env
	@echo ""
	@echo "Setup complete. Start the dev server with: make dev"
	@echo "Then open http://localhost:3100 and walk through the gear icon → Settings."

# Generate `.env.local` with a fresh HARNESS_TOKEN_ENCRYPTION_KEY if it
# doesn't already exist. Anything stored in SQLite (GitHub OAuth secret,
# OpenAI API key, ChatGPT JWT) is encrypted with this key.
.PHONY: setup-env
setup-env:
	@if [ ! -f .env.local ]; then \
		KEY=$$(openssl rand -base64 32); \
		printf "HARNESS_TOKEN_ENCRYPTION_KEY=%s\n" "$$KEY" > .env.local; \
		echo "Generated .env.local with a fresh encryption key."; \
	else \
		echo ".env.local already exists — leaving it alone."; \
	fi

# Codex agent shells out to `rg` constantly when grounding answers in source.
# Without it, it falls back to find/grep which is much slower.
.PHONY: setup-rg
setup-rg:
	@if command -v rg >/dev/null 2>&1; then \
		echo "ripgrep already installed: $$(rg --version | head -1)"; \
	else \
		echo "Installing ripgrep via apt..."; \
		sudo apt-get install -y ripgrep || apt-get install -y ripgrep; \
	fi

.PHONY: install
install:
	$(PNPM) install

# Install uv if it isn't on PATH yet; uv ships static binaries so this is fast.
.PHONY: install-uv
install-uv:
	@if ! command -v uv >/dev/null 2>&1 && [ ! -x "$(UV_BIN)" ]; then \
		echo "Installing uv (Python package manager)..."; \
		curl -LsSf https://astral.sh/uv/install.sh | sh; \
	else \
		echo "uv already installed: $$(command -v uv || echo $(UV_BIN))"; \
	fi

# Install or upgrade the cocoindex-code CLI ('ccc') via uv.
# The [full] extra pulls sentence-transformers so local embeddings work
# without an API key — required by our default flow.
.PHONY: setup-ccc
setup-ccc: install-uv
	@PATH="$(HOME)/.local/bin:$$PATH"; \
	uv tool install --upgrade 'cocoindex-code[full]' --force
	@PATH="$(HOME)/.local/bin:$$PATH"; \
	echo "Installed: $$(ccc --help >/dev/null 2>&1 && echo OK || echo MISSING) at $(CCC_BIN)"

.PHONY: ccc-doctor
ccc-doctor:
	@PATH="$(HOME)/.local/bin:$$PATH"; \
	ccc doctor

.PHONY: ccc-version
ccc-version:
	@PATH="$(HOME)/.local/bin:$$PATH"; \
	if command -v ccc >/dev/null 2>&1; then \
		echo "ccc installed at: $$(command -v ccc)"; \
	else \
		echo "ccc not installed — run: make setup-ccc"; exit 1; \
	fi

.PHONY: dev
dev:
	$(PNPM) dev

.PHONY: build
build:
	$(PNPM) build

.PHONY: typecheck
typecheck:
	$(PNPM) exec tsc --noEmit

.PHONY: clean
clean:
	rm -rf node_modules data .cocoindex_code
