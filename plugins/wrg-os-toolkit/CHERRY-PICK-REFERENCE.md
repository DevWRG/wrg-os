# Cherry-Pick Reference — ECC v2.1.0 → wrg-os-toolkit

Referensi buat nambah skill dari ECC. **Survei ulang 2026-08-06**: 281 skill di-clone fresh dan
frontmatter `description`-nya dibaca satu per satu (bukan tebak dari nama folder), lalu disaring
pakai rubrik di bagian bawah.

**Source repo:** https://github.com/affaan-m/ECC (MIT · Affaan Mustafa) · **Toolkit:** v0.2.0 · 22 skill

---

## ✅ Sudah masuk (22)

### v0.1.0 — 16 skill awal

| Kategori | Skill | Alasan |
|---|---|---|
| Framework | nextjs-turbopack | Next.js 16 App Router monorepo |
| Framework | react-patterns | Server/Client boundaries |
| Framework | postgres-patterns | `wrg_os_prod` optimization |
| API | api-design | REST design buat Hono |
| API | api-connector-builder | Accurate/gais/CRM integrations |
| QA | tdd-workflow | Magang double-QA gate |
| QA | verification-loop | Post-build verify |
| QA | browser-qa | Visual regression |
| Delivery | delivery-gate | Merge quality hook (bawa `hooks/quality-gate.py`) |
| Security | security-review | Pre-merge audit (bawa 1 md pendamping) |
| Agent | agent-architecture-audit | Audit cluster F118–F129 |
| Agent | prompt-optimizer | WA handler tuning |
| Agent | cost-aware-llm-pipeline | Digest Engine cost |
| Research | deep-research | Regulatory + competitive |
| Docs | code-tour | Onboarding magang |
| Docs | documentation-lookup | Framework docs via Context7 |

### v0.2.0 — 6 tambahan (Tier A)

| Skill | Alasan konkret |
|---|---|
| **database-migrations** | Menyebut PostgreSQL + **Drizzle** eksplisit. `infra/postgres/init/0xx_*.sql` di-apply manual ke dev+prod; migrasi pernah bikin prod down 4×. Celah paling mahal yang belum tertutup. |
| **regex-vs-llm-structured-text** | "Mulai regex, tambah LLM cuma buat edge case low-confidence." Persis kelas bug kita: parser WA (#SALES/#POIN), importer HS-S-1 & IRONMAN, parser desimal pricelist (`0.287` kebaca `287`). |
| **data-throughput-accelerator** | Ingestion/backfill/ETL/**table synchronization** cepat tanpa korbankan korektness → mirror Accurate (invoice/SO/DO recent-only), backfill `wa_message`, export CSV. |
| **error-handling** | Typed error, retry, circuit breaker di **TypeScript dan Python** — Hono + FastAPI. Relevan buat `chat_or_fallback` yang menelan error OpenRouter diam-diam. |
| **fastapi-patterns** | `services/ai` (8100) sudah bukan skrip kecil: struktur project, Pydantic v2, DI, async handler, transaksi. |
| **python-testing** | pytest/fixtures/parametrize/coverage. CI `services/ai` sekarang **cuma import check** — nol disiplin tes di sisi Python. |

---

## ⚠️ JANGAN disalin — skill ECC-internal

Kelihatan relevan dari namanya, tapi isinya melayani instalasi ECC sendiri. Kalau ikut masuk cuma
jadi beban token dan menyesatkan (skill-nya nyuruh baca file/log yang tak ada di mesin kita):

| Skill | Kenyataannya |
|---|---|
| `cost-tracking` | Baca "ECC cost-tracker metrics log" — log milik ECC, bukan biaya LLM produk kita |
| `finance-billing-ops` | "billing workflow **for ECC**", bukan AR/invoice Accurate |
| `security-scan` | Scan direktori `.claude/` pakai AgentShield — audit konfigurasi agent, bukan audit kode WRG-OS |
| `agent-sort`, `configure-ecc`, `ecc-guide`, `ecc-recipes`, `ecc-tools-cost-audit` | Meta-instalasi ECC |
| `token-budget-advisor` | Mengatur panjang jawaban chat, bukan biaya pipeline |

> Catatan koreksi: daftar lama menyebut `drizzle-patterns` "belum ada di ECC" — **benar**, dan
> penggantinya bukan skill lain melainkan `database-migrations` (sudah masuk v0.2.0).

---

## 🟡 Tier B — tunggu pemicunya

| Skill | Pemicu yang bikin layak masuk |
|---|---|
| `architecture-decision-records` | Kalau mau ADR di-capture otomatis dari sesi. Sekarang ADR-001→034 ditulis manual di Drive `04-Decision-Log` |
| `contract-first` | Kalau schema BFF web↔api mulai drift antar-consumer |
| `ai-regression-testing` | Kalau output LLM (Digest Engine, rekap/resume) butuh regression harness |
| `react-performance` | Kalau dashboard mulai berat (adaptasi React Best Practices Vercel, 70+ rule) |
| `design-system` | Kalau garap UI serius — nyambung standing rule "template & UI/UX profesional" |
| `e2e-testing` | Playwright Page Object Model, kalau E2E dashboard jalan |
| `github-ops` | Kalau otomasi rilis/issue triage diperdalam |
| `deployment-patterns`, `production-audit` | Kalau deploy pm2 native mau diformalkan / audit pra-rilis |
| `mcp-server-patterns` | Kalau bikin MCP server khusus WRG-OS |
| `python-patterns` | Kalau orchestrator A1–A12 benar-benar dibangun di Python |
| `redis-patterns`, `docker-patterns`, `kubernetes-patterns` | Kalau stack pindah dari pm2 native / butuh queue |
| `healthcare-emr-patterns`, `healthcare-cdss-patterns`, `hipaa-compliance` | Kalau ekspansi ke integrasi RS/EMR |
| `agent-eval`, `eval-harness`, `agent-harness-construction`, `agent-introspection-debugging` | Kalau agent A1–A12 butuh evaluasi formal |

**Risiko false-positive yang perlu diingat:** `accessibility` (WCAG/ARIA) gampang ter-trigger di
kerjaan RBAC kita yang penuh kata "akses" padahal konteksnya beda. Kalau dipasang, pasang barengan
`design-system` saat memang lagi garap UI.

---

## 📘 Tier C — domain, BACA saja, jangan dipasang

Isinya codified domain expertise, bukan pola koding. Berguna sebagai bahan desain fitur OPS yang
lagi dibangun (F13 PO Tracker, F38 ED Watch, F40 Relocation, F12 Delivery), **tapi** konteksnya
retail multi-lokasi & freight Amerika — belum tentu pas distributor alkes Indonesia. Baca sekali
saat desain, jangan jadikan skill aktif:

`inventory-demand-planning` (safety stock, replenishment) · `logistics-exception-management`
(freight exception, dispute carrier) · `returns-reverse-logistics` · `carrier-relationship-management`
· `production-scheduling` · `quality-nonconformance`

---

## 🚫 Skip permanen

- Stack lain: `swift-*`, `kotlin-*`, `dart-flutter-*`, `angular-*`, `nuxt4-*`, `vue-*`, `django-*`,
  `laravel-*`, `rust-*`, `golang-*`, `springboot-*`, `quarkus-*`, `perl-*`, `dotnet-*`, `nestjs-*`,
  `cpp-*`, `java-*`, `jpa-*`, `csharp-*`, `fsharp-*`, `tinystruct-*`, `react-native-*`, `compose-multiplatform-*`
- ORM/DB yang tak kita pakai: `prisma-patterns`, `mysql-patterns`, `clickhouse-io`
- Homelab/jaringan: `homelab-*`, `cisco-ios-patterns`, `netmiko-ssh-automation`, `network-*`
- Crypto/trading: `agent-payment-x402`, `defi-amm-security`, `llm-trading-agent-security`,
  `evm-token-decimals`, `nodejs-keccak256`, `ito-*`, `prediction-market-*`
- Media/3D: `blender-*`, `motion-*`, `remotion-video-creation`, `manim-video`, `video-editing`, `fal-ai-media`
- Off-topic: `energy-procurement`, `customs-trade-compliance`, `scientific-db-uspto-database`,
  `visa-doc-translate`, `investor-*`, `seo`, `social-*`

---

## Cara survei ulang sendiri

```bash
git clone --depth=1 https://github.com/affaan-m/ECC.git /tmp/ECC

# Nama + description semua skill (JANGAN nilai dari nama folder saja —
# beberapa skill "generik" ternyata ECC-internal)
cd /tmp/ECC/skills && for d in */; do
  printf "%-36s %s\n" "${d%/}" "$(sed -n 's/^description: //p' "$d/SKILL.md" | head -1 | cut -c1-140)"
done | sort
```

## Nambah skill ke toolkit

```bash
TOOLKIT="$HOME/Library/CloudStorage/GoogleDrive-development@wahanalifeline.co.id/My Drive/Cowork Workspace/Projects/WRG OS/14-Plugins/wrg-os-toolkit"
cp -R /tmp/ECC/skills/<SKILL_NAME> "$TOOLKIT/skills/"
grep -q "origin: ECC" "$TOOLKIT/skills/<SKILL_NAME>/SKILL.md" || echo "TAMBAHKAN metadata.origin: ECC"
find "$TOOLKIT/skills/<SKILL_NAME>" -type f ! -name '*.md'   # cek ada script/hook yang ikut?
```

Lalu wajib: bump `version` di `.claude-plugin/plugin.json` **dan** `../.claude-plugin/marketplace.json`
· update tabel + Riwayat di `README.md` · update file INI · update `08-State-Sync/warp-tooling.json`
(`version`, `skillCount`, `packagedFile`) · repack `.plugin` (INSTALL.md Opsi C).
Install symlink tak perlu diulang; verifikasi lewat `claude plugin details wrg-os-toolkit`.

## Rubrik: layak masuk atau tidak

1. **Stack fit?** — pakai framework/DB yang kita pakai (Next.js 16 · Hono · FastAPI · Drizzle · PostgreSQL · Better-Auth · Playwright)?
2. **Frekuensi?** — bakal ke-trigger minimal 1×/minggu? Kalau tidak, biarkan di Tier B.
3. **Risiko false-positive?** — keyword description-nya bakal nyala di konteks WRG-OS yang tak nyambung?
4. **Generik atau ECC-internal?** — baca `description` sampai habis. Kalau menyebut file/log/tooling milik ECC, skip.

Salah satu jawaban NO → jangan masukkan.
