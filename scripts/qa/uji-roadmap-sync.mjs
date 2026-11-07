#!/usr/bin/env node
// Tes logika `roadmap-project-sync.yml` TANPA menjalankan GitHub Actions.
//   node scripts/qa/uji-roadmap-sync.mjs     (exit 0 = lulus)
//
// Blok `script:` di workflow itu tak pernah bisa diuji lewat CI biasa — ia cuma
// jalan sebagai reaksi atas event PR sungguhan, dan salah logika di situ
// gejalanya adalah papan roadmap yang melenceng diam-diam berbulan-bulan
// (#1075, #1104). Skrip ini mengekstrak blok itu, membungkusnya jadi fungsi,
// lalu menjalankannya dengan `github`/`context`/`core` palsu supaya keputusan
// yang diambilnya bisa diperiksa.
//
// Yang dipalsukan hanya API GitHub. Logikanya sendiri kode asli dari YAML —
// jadi kalau tes ini lulus tapi workflow-nya berubah, tes ikut berubah.
//
// ⚠️ Dua jebakan ekstraksi yang pernah menghasilkan false pass:
//   1. Tanpa pembungkus `module.exports = async (...) => {}`, `node --check`
//      gagal dengan "await is only valid in async functions" — kelihatan
//      seperti kode salah padahal cuma cara ujinya.
//   2. Kalau ekstraksinya menghasilkan file KOSONG, `node --check` lolos begitu
//      saja. Karena itu ukurannya diperiksa eksplisit di bawah.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const YML = new URL("../../.github/workflows/roadmap-project-sync.yml", import.meta.url).pathname;

function ekstrakScript(path) {
  const baris = readFileSync(path, "utf8").split("\n");
  const mulai = baris.findIndex((l) => l.trim() === "script: |");
  if (mulai < 0) throw new Error("blok `script: |` tak ditemukan di workflow");
  const indent = baris[mulai + 1].length - baris[mulai + 1].trimStart().length;
  const isi = [];
  for (const l of baris.slice(mulai + 1)) {
    if (l.trim() && l.length - l.trimStart().length < indent) break;
    isi.push(l.length >= indent ? l.slice(indent) : l);
  }
  if (isi.join("").trim().length < 200) throw new Error(`ekstraksi terlalu pendek (${isi.length} baris) — pola indentasi berubah?`);
  return `module.exports = async ({github, context, core}) => {\n${isi.join("\n")}\n};\n`;
}

const tmp = join(mkdtempSync(join(tmpdir(), "roadmap-sync-")), "script.cjs");
writeFileSync(tmp, ekstrakScript(YML));
const jalankan = createRequire(import.meta.url)(tmp);

const OPT_NAMA = { "47fc9ee4": "In Progress", "4d5bc88f": "Checking", "98236657": "Done" };

// Menjalankan skrip asli terhadap satu skenario PR, mengembalikan keputusan
// yang diambilnya: kartu mana di-set ke status apa, kartu baru apa yang dibuat.
function harness({ action, baseRef, headRef, title, commits = [], cards }) {
  const log = [], updates = [], created = [], warnings = [];
  const items = cards.map((t, i) => ({ id: `IT${i}`, content: { title: t } }));
  const github = {
    graphql: async (q, v) => {
      if (q.includes("ProjectV2 { number title }")) return { node: { number: 2, title: "WRG-OS Roadmap" } };
      if (q.includes("items(first:100")) return { node: { items: { pageInfo: { hasNextPage: false }, nodes: items } } };
      if (q.includes("addProjectV2DraftIssue")) {
        created.push(v.t);
        const it = { id: `NEW${created.length}`, content: { title: v.t } };
        items.push(it);
        return { addProjectV2DraftIssue: { projectItem: it } };
      }
      if (q.includes("updateProjectV2ItemFieldValue")) {
        updates.push({ item: items.find((x) => x.id === v.i)?.content?.title, status: OPT_NAMA[v.o] });
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: v.i } } };
      }
      throw new Error(`query tak dikenal: ${q.slice(0, 60)}`);
    },
    paginate: async () => commits.map((m) => ({ commit: { message: m } })),
    rest: { pulls: { listCommits: () => {} } },
  };
  const context = {
    repo: { owner: "DevWRG", repo: "wrg-os" },
    payload: {
      action,
      pull_request: { number: 999, merged: action === "closed", base: { ref: baseRef }, head: { ref: headRef }, title },
    },
  };
  const core = { info: (m) => log.push(m), warning: (m) => warnings.push(m), setFailed: (m) => log.push(`FAILED: ${m}`) };
  return jalankan({ github, context, core }).then(() => ({ log, updates, created, warnings }));
}

let gagal = 0;
const cek = (nama, aktual, harap) => {
  const ok = JSON.stringify(aktual) === JSON.stringify(harap);
  console.log(`${ok ? "✅" : "❌"} ${nama}${ok ? "" : `\n     dapat ${JSON.stringify(aktual)}\n     harap ${JSON.stringify(harap)}`}`);
  if (!ok) gagal++;
};

// ── #1104 gap 1 — PR promosi dev → main tak punya F-number di branch/judul ──
// Sebelum diperbaiki hasilnya [] : cabang Done tak pernah tereksekusi, kartu
// mengendap di Checking selamanya. Bukti nyatanya F66 (di main sejak PR #614,
// kartunya Checking sampai disetel tangan 29 Agu).
let r = await harness({
  action: "closed", baseRef: "main", headRef: "dev",
  title: "Promote dev → main: batch magang + QA",
  commits: [
    "feat(F127): Sales Analytics tab Pipeline (#585)",
    "fix(F66): skala NPK pro-rata (#614)",
    "chore(state): auto-sync dashboard state",
  ],
  cards: ["[CRM] F127 Sales Analytics", "[NPK] F66 NPK Engine", "[SPT] F1 Sales Pipeline Tracker"],
});
cek("promosi: F-number dibaca dari commit → Done", r.updates, [
  { item: "[CRM] F127 Sales Analytics", status: "Done" },
  { item: "[NPK] F66 NPK Engine", status: "Done" },
]);
cek("promosi: nol kartu palsu dibuat", r.created, []);

// REGRESI — badan commit yang MENYEBUT F-number lain tak boleh dihitung.
// Kasus nyata: commit #1182 subjeknya soal roadmap-sync, tapi badannya mengutip
// F127 dan F66 sebagai contoh. Kalau yang dibaca `c.commit.message` utuh,
// promosi yang mengangkut commit itu akan menandai F127 & F66 `Done` tanpa
// membawa pekerjaan keduanya sama sekali — `Done` yang tak dibayar apa pun,
// persis kebalikan dari tujuan #1104.
r = await harness({
  action: "closed", baseRef: "main", headRef: "dev", title: "Promote dev → main",
  commits: [
    "fix(roadmap-sync): status Done bisa tercapai + F1-F9 tak lagi dikecualikan\n\n" +
      "Bukti: F66 sudah di main sejak PR #614 tapi kartunya Checking.\n" +
      "Contoh lain yang terpengaruh: F127 Sales Analytics.",
    "fix(F19): nearest_ed_date tampil sbg Date.toString() JS mentah",
  ],
  cards: ["[NPK] F66 NPK Engine", "[CRM] F127 Sales Analytics", "[PO] F19 Forecast"],
});
cek("promosi: F-number di BADAN commit diabaikan", r.updates, [
  { item: "[PO] F19 Forecast", status: "Done" },
]);

// ── #1104 gap 2 — F1–F9 dikecualikan regex lama `F\d{2,3}` ─────────────────
r = await harness({
  action: "closed", baseRef: "dev", headRef: "feat/f1-spt-kanban",
  title: "feat(F1): kanban SPT",
  cards: ["[SPT] F1 Sales Pipeline Tracker", "[CRM] F127 Sales Analytics"],
});
cek("F1 satu digit terdeteksi → Checking", r.updates, [{ item: "[SPT] F1 Sales Pipeline Tracker", status: "Checking" }]);

// Pelonggaran ke satu digit TIDAK boleh melebar: F1 bukan F10/F127, dan bukan
// potongan kata (PROF1) — batas non-alfanumerik di kedua sisi yang menahannya.
r = await harness({
  action: "closed", baseRef: "dev", headRef: "feat/f1-spt", title: "feat(F1): x",
  cards: ["[X] F127 Analytics", "[Y] F10 Sesuatu", "[Z] PROF1 Palsu", "[SPT] F1 Asli"],
});
cek("F1 tidak bocor ke F10/F127/PROF1", r.updates, [{ item: "[SPT] F1 Asli", status: "Checking" }]);

// ── Rentang "F1–F9" = deskripsi, bukan dua fitur ───────────────────────────
// Kena pada judul PR #1182 sendiri. Kalau F-number dalam rentang belum punya
// kartu, workflow akan MEMBUAT kartu draft palsu.
r = await harness({
  action: "closed", baseRef: "dev", headRef: "fix/roadmap-sync-rentang",
  title: "fix(roadmap-sync): status Done bisa tercapai + F1–F9 tak lagi dikecualikan",
  cards: ["[SPT] F1 Sales Pipeline Tracker", "[OPS] F9 Master Data Hygiene"],
});
cek("rentang en-dash di JUDUL tidak dibaca sebagai fitur", r.updates, []);
cek("rentang: nol kartu palsu dibuat", r.created, []);

// Bentuk `fN-fM` di NAMA BRANCH tetap ambigu dan sengaja dibiarkan cocok —
// `feat/f49-f54-…` sah berarti dua fitur. Yang dijamin desain ini: salah-baca
// dari nama branch hanya bisa MEMPERBARUI kartu yang sudah ada (bisa
// dibatalkan), TIDAK PERNAH membuat kartu palsu (tak bisa dibatalkan).
// Branch PR #1182 sendiri, `fix/roadmap-sync-f1-f9`, adalah bentuk itu.
r = await harness({
  action: "closed", baseRef: "dev", headRef: "fix/roadmap-sync-f1-f9",
  title: "fix(roadmap-sync): perbaikan tanpa F-number di judul",
  cards: ["[SPT] F1 Sales Pipeline Tracker"], // F9 sengaja TIDAK punya kartu
});
cek("branch ambigu: kartu yang ada boleh diperbarui", r.updates, [
  { item: "[SPT] F1 Sales Pipeline Tracker", status: "Checking" },
]);
cek("branch ambigu: kartu palsu TIDAK dibuat", r.created, []);

r = await harness({
  action: "closed", baseRef: "dev", headRef: "feat/x", title: "feat: rapikan F1 - F9",
  cards: ["[SPT] F1 A", "[OPS] F9 B"],
});
cek("rentang hyphen berspasi juga diabaikan", r.updates, []);

// TAPI hyphen RAPAT di nama branch adalah bentuk sah dua fitur di repo ini —
// `feat/f49-f54-…`. Ini tidak boleh ikut terbuang.
r = await harness({
  action: "closed", baseRef: "dev", headRef: "feat/f49-f54-satu-pr-dua-fitur",
  title: "feat: dua fitur sekaligus",
  cards: ["[A] F49 Satu", "[B] F54 Dua"],
});
cek("branch f49-f54 tetap dua fitur", r.updates, [
  { item: "[A] F49 Satu", status: "Checking" },
  { item: "[B] F54 Dua", status: "Checking" },
]);

// ── Jalur yang TIDAK boleh berubah perilakunya ─────────────────────────────
r = await harness({
  action: "opened", baseRef: "dev", headRef: "docs/tanpa-nomor", title: "docs: rapikan",
  commits: ["feat(F99): jangan terbaca — PR non-promosi tak membaca commit"],
  cards: ["[X] F99 Kartu"],
});
cek("PR tanpa F-number → nol update", r.updates, []);

r = await harness({
  action: "closed", baseRef: "release/x", headRef: "feat/f66-x", title: "feat(F66): x",
  cards: ["[NPK] F66 NPK Engine"],
});
cek("base di luar dev/main → di-skip", r.updates, []);

// ── Batas API 250 commit harus BERBUNYI, bukan memotong diam-diam ──────────
// Promosi besar nyata: #1139 membawa 191 commit. Kalau suatu hari tembus 250,
// fitur yang commit-nya kena potong diam-diam tak pernah jadi Done.
r = await harness({
  action: "closed", baseRef: "main", headRef: "dev", title: "Promote dev → main",
  commits: Array.from({ length: 250 }, (_, i) => `fix(F${(i % 90) + 10}): commit ${i}`),
  cards: ["[X] F10 Kartu"],
});
cek("250 commit → peringatan dibunyikan", r.warnings.length > 0, true);
cek("peringatan menyebut batas 250", /batas API 250/.test(r.warnings[0] ?? ""), true);

console.log(gagal === 0 ? "\nSEMUA LULUS" : `\n${gagal} GAGAL`);
process.exit(gagal ? 1 : 0);
