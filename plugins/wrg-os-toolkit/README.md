# wrg-os-toolkit

Plugin custom Cowork/Claude Code buat build velocity WRG-OS. Isinya 16 skill hasil cherry-pick dari **[affaan-m/ECC v2.1.0](https://github.com/affaan-m/ECC)** (MIT license) — 281 skill total di sana, gue ambil yang paling relevan sama stack + workflow kita.

**Owner:** Husni Mubarrak · **Version:** 0.1.1 · **Created:** 2026-08-06

---

## Kenapa cherry-pick, bukan install full ECC

ECC punya 281 skill. Kalau semua di-load, skill listing bakal cluttered dan trigger matching sering false-positive (misal `swift-development` nyala pas lo bahas Sales Contract, karena keyword "contract"). Cherry-pick = signal-to-noise ratio bagus, cost trigger rendah, bisa nambah kapan aja.

## Isi

| # | Skill | Kegunaan buat WRG-OS |
|---|---|---|
| 1 | **postgres-patterns** | Query optimization, indexing, RLS untuk `wrg_os_prod` (schema jebakan sales_plan.am_id TEXT dsb) |
| 2 | **nextjs-turbopack** | Next.js 16 App Router — Turbopack vs webpack decisions, FS caching |
| 3 | **react-patterns** | Server/Client component boundaries, Suspense, form actions, hooks discipline |
| 4 | **api-design** | REST patterns: naming, status codes, pagination, error responses, versioning — buat Hono API + webhook endpoints |
| 5 | **api-connector-builder** | Bikin integrator baru (Accurate/gais/CRM Fase 1) yang match existing pattern, no arch drift |
| 6 | **tdd-workflow** | Enforced TDD 80%+ coverage — buat magang double-QA gate |
| 7 | **verification-loop** | Comprehensive verification post-build |
| 8 | **browser-qa** | Automated visual regression buat dashboard + web UI |
| 9 | **delivery-gate** | Stop-hook block delivery sampai quality check lulus (rationalization detector) |
| 10 | **security-review** | Auth, input handling, secrets, endpoint audit — pre-merge dev→main |
| 11 | **agent-architecture-audit** | 12-layer agent stack diagnostic — audit F118-F129 CLUSTER SPINE + Digest Engine |
| 12 | **deep-research** | Multi-source cited research (firecrawl+exa MCP) — buat regulatory (AKL/PMK), competitive intel |
| 13 | **prompt-optimizer** | Polish WA handler prompts (#SALES, #POIN, #NPK, #SPH) |
| 14 | **cost-aware-llm-pipeline** | Model routing + prompt caching — buat Digest Engine (57% total LLM cost) |
| 15 | **code-tour** | `.tour` files buat onboarding magang ke `wrg-os` monorepo |
| 16 | **documentation-lookup** | Context7 MCP — dokumentasi framework up-to-date (Drizzle, Better-Auth, Hono, Next.js 16) |

Total ~180 KB. Semua pure markdown (kecuali `delivery-gate` dan `security-review` yang bawa 1 helper script).

## Install

Lihat [`INSTALL.md`](./INSTALL.md).

TL;DR:

```bash
bash scripts/install-warp.sh install    # → ~/.claude/skills/wrg-os-toolkit
bash scripts/install-warp.sh verify
claude plugin list                      # wrg-os-toolkit@skills-dir
```

Sesi `claude` berikutnya, 16 skill muncul di `<available_skills>` dengan prefix
`wrg-os-toolkit:<skill-name>`.

> ⚠️ **Jangan** pakai cara lama (symlink ke `~/.claude/plugins/` atau
> `~/Library/Application Support/Claude/plugins/`). Claude Code menemukan plugin lewat
> registry marketplace, bukan folder bebas di `~/.claude/plugins/` — symlink di sana
> tidak mengaktifkan apa pun. Detail + mode marketplace ada di `INSTALL.md`.

## Nambah skill lain kapan-kapan

Skill lain di ECC yang mungkin bakal berguna nanti — full list ada di [`CHERRY-PICK-REFERENCE.md`](./CHERRY-PICK-REFERENCE.md). Cara nambah:

```bash
cd /tmp && rm -rf ECC && git clone --depth=1 https://github.com/affaan-m/ECC.git
cp -r ECC/skills/<skill-name> "/path/to/WRG OS/14-Plugins/wrg-os-toolkit/skills/"
# Update version di plugin.json + ../.claude-plugin/marketplace.json → bump patch
# Update README.md tabel + CHERRY-PICK-REFERENCE.md
# Update 08-State-Sync/warp-tooling.json (version, skillCount, packagedFile)
# Repack .plugin (lihat INSTALL.md Opsi C)
```

## Attribution

Semua skill retain YAML frontmatter `metadata.origin: ECC` untuk audit trail. License MIT dari ECC berlaku — LICENSE file terlampir.

## Riwayat

- **v0.1.1** (2026-08-06) — perbaikan installer: metode install lama (symlink ke
  `~/.claude/plugins/`) tidak pernah mendaftarkan plugin. Diganti `~/.claude/skills/`
  (auto-load) + opsi local marketplace. `push-to-github.sh` diperbaiki juga: path repo
  auto-detect, dry-run default, dan berhenti menimpa `state/dashboard-state.json`
  (file itu auto-generated `sync-state.sh` — snapshot Drive-nya 19 hari lebih tua).
  Isi skill tidak berubah.
- **v0.1.0** (2026-08-06) — rilis awal, 16 skill cherry-pick dari ECC v2.1.0.

## Ke depan

- tambah `hipaa-compliance` skill kalau AKL regulation research jalan
- tambah `hooks/` folder buat main-merge-gate custom
- patch `scripts/ops/sync-state.sh` biar `tooling.*` di `dashboard-state.json` tak
  kehapus regenerasi cron 07:00 (sumber: `state/warp-tooling.json`)
