import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bereskanBerkasLampiran, hapusBerkasLampiran, lampiranTerbaca, tindakanBerkas, type FsBerkas } from "./kso-lampiran-berkas.js";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

test("tindakanBerkas: terbaca / pasti tak terpakai → hapus; gagal teknis → simpan", () => {
  assert.equal(tindakanBerkas({ ok: true }), "hapus");
  for (const g of ["pdf-rusak", "bukan-cprr", "cprr-tidak-terbaca"]) assert.equal(tindakanBerkas({ ok: false, galat: g }), "hapus", g);
  for (const g of ["ocr-tidak-tersedia", "render-tidak-tersedia", "ocr-timeout", "ocr-gagal", "ai-tak-terjangkau", "dry-run", "berkas-tidak-ada", "galat-baru"])
    assert.equal(tindakanBerkas({ ok: false, galat: g }), "simpan", g);
  assert.equal(tindakanBerkas({ ok: false }), "simpan");
  assert.equal(tindakanBerkas(null), "simpan");
  assert.equal(lampiranTerbaca({ ok: true }), true);
  assert.equal(lampiranTerbaca({ galat: "ocr-timeout" }), false);
});

async function rootUji() {
  const dasar = await mkdtemp(join(tmpdir(), "kso-lamp-"));
  const root = join(dasar, "media");
  await mkdir(join(root, "inbound"), { recursive: true });
  return { dasar, root, bersih: () => rm(dasar, { recursive: true, force: true }) };
}

test("hapusBerkasLampiran: PDF di dalam root dengan sha256 sama → dihapus; ENOENT → tidak-ada", async () => {
  const u = await rootUji();
  try {
    const p = join(u.root, "inbound", "contoh.pdf");
    await writeFile(p, "%PDF-1.4 fiktif");
    const h = await hapusBerkasLampiran(p, { root: u.root, sha256: sha("%PDF-1.4 fiktif") });
    assert.equal(h.status, "dihapus");
    assert.deepEqual(await readdir(join(u.root, "inbound")), []);
    assert.deepEqual(await hapusBerkasLampiran(p, { root: u.root }), { status: "tidak-ada" });
  } finally { await u.bersih(); }
});

test("hapusBerkasLampiran: di luar root, traversal, symlink, bukan .pdf, sha256 beda → ditolak, berkas utuh", async () => {
  const u = await rootUji();
  try {
    const luar = join(u.dasar, "rahasia.pdf");
    await writeFile(luar, "%PDF luar");
    assert.deepEqual(await hapusBerkasLampiran(luar, { root: u.root }), { status: "ditolak", alasan: "di-luar-root" });
    assert.deepEqual(await hapusBerkasLampiran(join(u.root, "inbound", "..", "..", "rahasia.pdf"), { root: u.root }),
                     { status: "ditolak", alasan: "di-luar-root" });
    // symlink di dalam root yang menunjuk ke luar
    const tautan = join(u.root, "inbound", "tautan.pdf");
    await symlink(luar, tautan);
    assert.deepEqual(await hapusBerkasLampiran(tautan, { root: u.root }), { status: "ditolak", alasan: "symlink" });
    // folder perantara symlink ke luar root
    await mkdir(join(u.dasar, "lain"));
    await writeFile(join(u.dasar, "lain", "x.pdf"), "%PDF x");
    await symlink(join(u.dasar, "lain"), join(u.root, "inbound", "dir"));
    assert.deepEqual(await hapusBerkasLampiran(join(u.root, "inbound", "dir", "x.pdf"), { root: u.root }), { status: "ditolak", alasan: "di-luar-root" });
    // bukan pdf
    const jpg = join(u.root, "inbound", "foto.jpg");
    await writeFile(jpg, "jpg");
    assert.deepEqual(await hapusBerkasLampiran(jpg, { root: u.root }), { status: "ditolak", alasan: "bukan-pdf" });
    // folder berakhiran .pdf
    await mkdir(join(u.root, "inbound", "folder.pdf"));
    assert.deepEqual(await hapusBerkasLampiran(join(u.root, "inbound", "folder.pdf"), { root: u.root }), { status: "ditolak", alasan: "bukan-berkas" });
    // isi berubah sesudah dibaca
    const p = join(u.root, "inbound", "baru.pdf");
    await writeFile(p, "%PDF isi lain");
    assert.deepEqual(await hapusBerkasLampiran(p, { root: u.root, sha256: sha("%PDF isi yang dibaca") }), { status: "ditolak", alasan: "sha256-beda" });
    assert.deepEqual(await hapusBerkasLampiran(null, { root: u.root }), { status: "ditolak", alasan: "path-kosong" });
    // semua berkas masih ada
    assert.deepEqual((await readdir(join(u.root, "inbound"))).sort(), ["baru.pdf", "dir", "folder.pdf", "foto.jpg", "tautan.pdf"]);
    assert.deepEqual(await readdir(u.dasar).then((x) => x.sort()), ["lain", "media", "rahasia.pdf"]);
  } finally { await u.bersih(); }
});

test("hapusBerkasLampiran: galat fs (izin) → gagal, tak melempar; ENOENT saat unlink → tidak-ada", async () => {
  const fsPalsu = (unlinkErr: string): FsBerkas => ({
    lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
    realpath: async (p) => p,
    readFile: async () => Buffer.from("x"),
    unlink: async () => { throw Object.assign(new Error(unlinkErr), { code: unlinkErr }); },
  });
  assert.deepEqual(await hapusBerkasLampiran("/m/inbound/a.pdf", { root: "/m", fs: fsPalsu("EACCES") }), { status: "gagal", alasan: "EACCES" });
  assert.deepEqual(await hapusBerkasLampiran("/m/inbound/a.pdf", { root: "/m", fs: fsPalsu("ENOENT") }), { status: "tidak-ada" });
  assert.deepEqual(await hapusBerkasLampiran("/m", { root: "/m", fs: fsPalsu("EACCES") }), { status: "ditolak", alasan: "bukan-pdf" });
});

test("bereskanBerkasLampiran: final → hapus + tandai; teknis → simpan tanpa tandai; ditolak/gagal tandai → tak melempar", async () => {
  const ditandai: number[] = [];
  const log: string[] = [];
  const alur = (status: "dihapus" | "tidak-ada" | "ditolak") => ({
    root: "/m",
    hapus: async () => (status === "ditolak" ? { status, alasan: "di-luar-root" as const } : status === "dihapus" ? { status, path: "/m/a.pdf" } : { status }),
    tandai: async (id: number) => { ditandai.push(id); },
    peringatan: (m: string) => log.push(m),
  });
  const l = (hasil: { ok?: boolean; galat?: string }) => ({ lampiranId: 7, media_path: "/m/a.pdf", sha256: "abc", hasil });

  assert.deepEqual(await bereskanBerkasLampiran(l({ ok: true }), alur("dihapus")), { aksi: "hapus", berkas: "dihapus", ditandai: true });
  assert.deepEqual(await bereskanBerkasLampiran(l({ galat: "bukan-cprr" }), alur("tidak-ada")), { aksi: "hapus", berkas: "tidak-ada", ditandai: true });
  assert.deepEqual(ditandai, [7, 7]);
  assert.deepEqual(await bereskanBerkasLampiran(l({ galat: "ocr-timeout" }), alur("dihapus")), { aksi: "simpan" });
  assert.deepEqual(await bereskanBerkasLampiran(l({ galat: "dry-run" }), alur("dihapus")), { aksi: "simpan" });
  assert.deepEqual(await bereskanBerkasLampiran({ ...l({ ok: true }), lampiranId: null }, alur("dihapus")), { aksi: "simpan" });
  assert.equal(ditandai.length, 2);

  const r = await bereskanBerkasLampiran(l({ ok: true }), alur("ditolak"));
  assert.deepEqual(r, { aksi: "hapus", berkas: "ditolak", ditandai: false, alasan: "di-luar-root" });
  assert.equal(ditandai.length, 2);
  const g = await bereskanBerkasLampiran(l({ ok: true }), { ...alur("dihapus"), tandai: async () => { throw new Error("db mati"); } });
  assert.deepEqual(g, { aksi: "hapus", berkas: "dihapus", ditandai: false, alasan: "tandai-gagal" });
  assert.equal(log.length, 2);
});
