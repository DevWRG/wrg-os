# WRG-OS Makefile — shortcut perintah dev & docker.
# Stack nyata: pnpm monorepo (apps/web, apps/api) + services/ai (FastAPI) +
# docker compose (postgres · ai · api · web). Jalankan `make` untuk daftar.
# Recipe pakai TAB (wajib Makefile).

PG_USER ?= wrg
PG_DB   ?= wrg_os
COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help setup install dev dev-web dev-api ai-install dev-ai build lint typecheck \
        up up-db down down-clean logs logs-web logs-api logs-ai ps psql tables health clean

help: ## Tampilkan daftar perintah
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ── Dev lokal (tanpa docker) ──────────────────────────────
setup: install ## Setup awal: copy .env + install deps JS
	@test -f .env && echo "ℹ️  .env sudah ada" || (cp .env.example .env && echo "✅ .env dibuat — isi PG_PASSWORD/JWT_SECRET/dll")

install: ## Install dependency pnpm (workspace)
	pnpm install

dev: ## Jalankan web + api (turbo, mode dev)
	pnpm dev

dev-web: ## apps/web saja (Next.js :3000)
	pnpm --filter @wrg/web dev

dev-api: ## apps/api saja (Hono :4000)
	pnpm --filter @wrg/api dev

ai-install: ## Buat venv + install deps services/ai
	cd services/ai && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

dev-ai: ## services/ai (FastAPI :8000) — perlu `make ai-install` dulu
	cd services/ai && .venv/bin/uvicorn app.main:app --reload --port 8000

build: ## Build semua (turbo: web + api)
	pnpm build

lint: ## Lint semua workspace
	pnpm lint

typecheck: ## Type-check semua workspace
	pnpm typecheck

# ── Docker (perlu Docker terpasang) ───────────────────────
up: ## Build & start seluruh stack (postgres · ai · api · web)
	$(COMPOSE) up -d --build

up-db: ## Start postgres saja (untuk dev app di host)
	$(COMPOSE) up -d postgres

down: ## Stop semua service
	$(COMPOSE) down

down-clean: ## Stop + HAPUS volume (DANGER: hapus data DB)
	$(COMPOSE) down -v

logs: ## Ikuti semua log
	$(COMPOSE) logs -f

logs-web: ## Log web
	$(COMPOSE) logs -f web

logs-api: ## Log api
	$(COMPOSE) logs -f api

logs-ai: ## Log ai
	$(COMPOSE) logs -f ai

ps: ## Status container
	$(COMPOSE) ps

psql: ## Buka psql di container postgres
	$(COMPOSE) exec postgres psql -U $(PG_USER) -d $(PG_DB)

tables: ## List tabel (verifikasi init schema)
	$(COMPOSE) exec postgres psql -U $(PG_USER) -d $(PG_DB) -c "\dt"

health: ## Cek health api/ai/web (stack harus jalan)
	@curl -fsS http://localhost:4000/health && echo "" || echo "api down"
	@curl -fsS http://localhost:8000/health && echo "" || echo "ai down"
	@curl -fsS -o /dev/null -w "web HTTP %{http_code}\n" http://localhost:3000 || echo "web down"

clean: ## Hapus node_modules/.next/dist/.turbo
	find . -name node_modules -type d -prune -exec rm -rf '{}' +
	find . -name .next -type d -prune -exec rm -rf '{}' +
	find . -name dist -type d -prune -exec rm -rf '{}' +
	find . -name .turbo -type d -prune -exec rm -rf '{}' +
	@echo "✅ Clean."
