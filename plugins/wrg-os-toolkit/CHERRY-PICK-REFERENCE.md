# Cherry-Pick Reference — ECC v2.1.0 → wrg-os-toolkit

Referensi buat nambah skill dari ECC ke depan. Full listing 281 skill dikategorikan. Yang udah masuk toolkit ditandai ✅.

**Source repo:** https://github.com/affaan-m/ECC (MIT · Affaan Mustafa)
**Last surveyed:** 2026-08-06 (v2.1.0)

---

## 🎯 Skills yang UDAH masuk (v0.1.0)

| Kategori | Skill | Alasan |
|---|---|---|
| Framework | ✅ nextjs-turbopack | Next.js 16 App Router monorepo |
| Framework | ✅ react-patterns | Server/Client boundaries |
| Framework | ✅ postgres-patterns | wrg_os_prod optimization |
| API | ✅ api-design | REST design buat Hono |
| API | ✅ api-connector-builder | Accurate/gais/CRM integrations |
| QA | ✅ tdd-workflow | Magang double-QA gate |
| QA | ✅ verification-loop | Post-build verify |
| QA | ✅ browser-qa | Visual regression |
| Delivery | ✅ delivery-gate | Merge quality hook |
| Security | ✅ security-review | Pre-merge audit |
| Agent | ✅ agent-architecture-audit | F118-F129 CLUSTER audit |
| Agent | ✅ prompt-optimizer | WA handler tuning |
| Agent | ✅ cost-aware-llm-pipeline | Digest Engine cost |
| Research | ✅ deep-research | Regulatory + competitive |
| Docs | ✅ code-tour | Magang onboarding |
| Docs | ✅ documentation-lookup | Framework docs via Context7 |

---

## 🟡 Kandidat NEXT (kalau kebutuhan muncul)

### Framework — kalau lo touch stack ini
- `fastapi-patterns` — kalau AI service (port 8100) berkembang
- `python-patterns` — buat orchestrator agent A1-A12
- `drizzle-patterns` — **belum ada di ECC**, cari alternative
- `docker-patterns` — kalau move dari native pm2 ke containers
- `vite-patterns` — kalau ada micro-frontend
- `mysql-patterns` — kalau ada legacy MySQL integration
- `prisma-patterns` — alternative to Drizzle
- `redis-patterns` — kalau Bull/BullMQ jobs
- `kubernetes-patterns` — kalau scaling ke k8s
- `mcp-server-patterns` — kalau bikin custom MCP server buat WRG-OS

### QA lanjutan
- `e2e-testing` — Playwright/Cypress framework agnostic
- `springboot-tdd` / `laravel-tdd` — cross-ref TDD pattern (skip, stack beda)

### Security lanjutan — kalau AKL/regulatory serius
- `hipaa-compliance` — patient data patterns (kalau ekspansi ke RS)
- `healthcare-phi-compliance` — same
- `security-scan` — automated vulnerability scanning
- `security-bounty-hunter` — pen-test mindset
- `automation-audit-ops` — audit trail patterns

### Agent lanjutan — kalau A1-A12 orchestrator built
- `agent-eval` — evaluation harness
- `agent-harness-construction` — how to build the harness
- `agent-introspection-debugging` — debug tools
- `agent-self-evaluation` — meta-eval
- `autonomous-loops` — self-improving loops
- `autonomous-agent-harness` — full agent runtime
- `eval-harness` — general eval framework

### Ops lanjutan
- `github-ops` — GHActions patterns (relevan buat on-release workflow)
- `deployment-patterns` — deploy strategy
- `docker-patterns` — containerization when needed

### Research lanjutan
- `article-writing` — blog/content buat brand
- `scientific-thinking-literature-review` — literature review discipline
- `scientific-db-pubmed-database` — kalau riset medical device landscape

### Domain-specific — mungkin useful
- `healthcare-cdss-patterns` — clinical decision support (RS integration)
- `healthcare-emr-patterns` — EMR patterns (RS integration)
- `customs-trade-compliance` — kalau impor alkes serius (KPPBC/DJBC)

### Delivery/DX lanjutan
- `frontend-slides` — presentation web
- `remotion-video-creation` — buat video product demo
- `manim-video` — math/technical animation
- `brand-voice` — content standardization

---

## 🚫 Skills yang SKIP (irrelevant WRG-OS)

- Semua `homelab-*` (network setup) — bukan stack kita
- `swift-*`, `kotlin-*`, `dart-flutter-*`, `angular-*`, `nuxt4-*`, `vue-*` — stack beda
- `django-*`, `laravel-*`, `rust-*`, `golang-*`, `springboot-*`, `perl-*`, `quarkus-*` — stack beda
- `dotnet-*`, `nestjs-*` — bukan kita pakai
- `agent-payment-x402`, `defi-amm-security`, `llm-trading-agent-security` — crypto/trading domain
- `blender-*`, `motion-*`, `remotion-*` (unless brand video need) — 3D/animation
- `energy-procurement`, `customs-trade-compliance` (kecuali AKL kompleks) — off-topic
- `prediction-market-*` — off-topic
- `ito-*` (trading) — off-topic
- `scientific-db-uspto-*` — patent search, off-topic

---

## Full alphabetical list of 281 skills (survey 2026-08-06)

Lo bisa cek langsung:
```bash
git clone --depth=1 https://github.com/affaan-m/ECC.git /tmp/ECC
ls /tmp/ECC/skills/ | sort > /tmp/ecc-skills-list.txt
wc -l /tmp/ecc-skills-list.txt
```

Filter per keyword:
```bash
# All patterns
ls /tmp/ECC/skills/ | grep 'patterns$'

# All testing
ls /tmp/ECC/skills/ | grep -iE '(test|tdd|qa|verification)'

# All security
ls /tmp/ECC/skills/ | grep -iE '(security|compliance|audit)'
```

## Nambah skill baru ke toolkit ini

```bash
# 1. Clone ECC fresh
cd /tmp && rm -rf ECC && git clone --depth=1 https://github.com/affaan-m/ECC.git

# 2. Copy skill target
TOOLKIT="$HOME/Library/CloudStorage/GoogleDrive-development@wahanalifeline.co.id/My Drive/Cowork Workspace/Projects/WRG OS/14-Plugins/wrg-os-toolkit"
cp -r /tmp/ECC/skills/<SKILL_NAME> "$TOOLKIT/skills/"

# 3. Update plugin.json version (0.1.0 → 0.1.1)
# 4. Update README.md tabel
# 5. Update CHERRY-PICK-REFERENCE.md — pindahkan dari 🟡 ke ✅

# 6. If installed via symlink, no reinstall needed
```

## Cara evaluasi apakah skill layak masuk

Ajukan 3 pertanyaan ke diri sendiri:
1. **Stack fit?** — apakah pakai library/framework yang WRG-OS pakai (Next.js 16 · Hono · FastAPI · Drizzle · PG · Better-Auth · Playwright)?
2. **Frequency?** — apakah bakal trigger min. 1x/minggu? Kalau enggak, skip.
3. **False-positive risk?** — apakah keyword description bakal trigger di konteks WRG-OS yang gak related? (Contoh: `swift-development` bakal false-trigger di "SPH" karena keyword "swift")

Kalau salah satu jawaban NO → skip. Kalau semua YA → add.
