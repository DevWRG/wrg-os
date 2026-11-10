// F170 (305) — PDF lampiran Simulator KSO TIDAK disimpan di server (keputusan product owner 10 Nov 2026).
//
// Bridge openclaw menulis PDF WhatsApp ke MEDIA_ROOT (~/.openclaw/media/inbound/…). Sesudah PDF dibaca /kso/ocr-cprr
// dan hasilnya tercatat (kso.app_bot_catat_lampiran), berkasnya dihapus bila bacaannya FINAL; gagal teknis → disimpan
// supaya bisa dibaca ulang. Penghapusan dijaga ketat (lihat hapusBerkasLampiran) dan TIDAK PERNAH melempar.

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, unlink } from "node:fs/promises";
import { extname } from "node:path";
import { isInsideRoot } from "../media-akses.js";

/** Galat /kso/ocr-cprr yang berarti dokumennya PASTI tak terpakai (kirim ulang PDF lain) — cermin kso.lampiran_terbaca (305). */
export const GALAT_FINAL: ReadonlySet<string> = new Set(["pdf-rusak", "bukan-cprr", "cprr-tidak-terbaca"]);

export type TindakanBerkas = "hapus" | "simpan";

/**
 * Sesudah PDF dibaca: "hapus" bila terbaca (ok) atau pasti tak terpakai; selain itu "simpan" — gagal teknis
 * (ocr-tidak-tersedia, render-tidak-tersedia, ocr-timeout, ocr-gagal, ai-tak-terjangkau, dry-run, berkas-tidak-ada) dan
 * galat yang tak dikenal (arah aman: berkas tetap ada).
 */
export function tindakanBerkas(h: { ok?: boolean | null; galat?: string | null } | null | undefined): TindakanBerkas {
  if (!h) return "simpan";
  if (h.ok === true) return "hapus";
  return h.galat && GALAT_FINAL.has(h.galat) ? "hapus" : "simpan";
}

/** Lampiran sudah diunggah & dibaca (= dibaca_at terisi di DB). */
export const lampiranTerbaca = (h: { ok?: boolean | null; galat?: string | null } | null | undefined): boolean => tindakanBerkas(h) === "hapus";

export interface FsBerkas {
  lstat(p: string): Promise<{ isFile(): boolean; isSymbolicLink(): boolean }>;
  realpath(p: string): Promise<string>;
  readFile(p: string): Promise<Buffer>;
  unlink(p: string): Promise<void>;
}
const fsAsli: FsBerkas = { lstat, realpath: (p) => realpath(p), readFile: (p) => readFile(p), unlink };

export type HasilHapus =
  | { status: "dihapus"; path: string }
  | { status: "tidak-ada" }
  | { status: "ditolak"; alasan: "path-kosong" | "bukan-pdf" | "symlink" | "bukan-berkas" | "di-luar-root" | "sha256-beda" }
  | { status: "gagal"; alasan: string };

const kodeGalat = (e: unknown): string | undefined => (e as NodeJS.ErrnoException)?.code;

/**
 * Hapus SATU berkas PDF lampiran yang baru dibaca. Syarat (semua wajib, kalau tidak berkas dibiarkan):
 *   - ekstensi .pdf (path asli dan path hasil realpath);
 *   - bukan symlink dan berkas biasa (lstat);
 *   - realpath berada di dalam realpath(root) — root = MEDIA_ROOT, sama dengan rute baca lampiran;
 *   - bila sha256 diberikan: isi berkas sekarang = isi yang barusan dibaca (bukan berkas lain yang menimpa path itu).
 * ENOENT = "tidak-ada" (sudah terhapus). Tidak pernah melempar.
 */
export async function hapusBerkasLampiran(
  path: string | null | undefined, o: { root: string; sha256?: string | null; fs?: FsBerkas },
): Promise<HasilHapus> {
  const fs = o.fs ?? fsAsli;
  if (!path || !path.trim()) return { status: "ditolak", alasan: "path-kosong" };
  if (extname(path).toLowerCase() !== ".pdf") return { status: "ditolak", alasan: "bukan-pdf" };
  try {
    let st: Awaited<ReturnType<FsBerkas["lstat"]>>;
    try {
      st = await fs.lstat(path);
    } catch (e) {
      if (kodeGalat(e) === "ENOENT") return { status: "tidak-ada" };
      throw e;
    }
    if (st.isSymbolicLink()) return { status: "ditolak", alasan: "symlink" };
    if (!st.isFile()) return { status: "ditolak", alasan: "bukan-berkas" };
    const asli = await fs.realpath(path);
    const root = await fs.realpath(o.root);
    if (!isInsideRoot(asli, root) || asli === root) return { status: "ditolak", alasan: "di-luar-root" };
    if (extname(asli).toLowerCase() !== ".pdf") return { status: "ditolak", alasan: "bukan-pdf" };
    if (o.sha256) {
      const sha = createHash("sha256").update(await fs.readFile(asli)).digest("hex");
      if (sha !== o.sha256) return { status: "ditolak", alasan: "sha256-beda" };
    }
    try {
      await fs.unlink(asli);
    } catch (e) {
      if (kodeGalat(e) === "ENOENT") return { status: "tidak-ada" };
      throw e;
    }
    return { status: "dihapus", path: asli };
  } catch (e) {
    if (kodeGalat(e) === "ENOENT") return { status: "tidak-ada" };
    return { status: "gagal", alasan: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** Langkah penandaan sesudah hapus — disuntik supaya alurnya bisa diuji tanpa DB. */
export interface AlurBersih {
  root: string;
  hapus?: typeof hapusBerkasLampiran;
  /** kso.app_bot_tandai_berkas_dihapus(lampiranId, am) */
  tandai: (lampiranId: number) => Promise<unknown>;
  peringatan?: (pesan: string) => void;
}
export type HasilBersih =
  | { aksi: "simpan" }
  | { aksi: "hapus"; berkas: HasilHapus["status"]; ditandai: boolean; alasan?: string };

/**
 * Sesudah lampiran tercatat (transaksi sudah commit): hapus berkasnya bila bacaannya final, lalu tandai di DB.
 * Berkas dihapus/tak ada → ditandai. Ditolak/gagal → berkas dibiarkan, tidak ditandai, peringatan di log.
 * Tidak pernah melempar ke alur balasan WA.
 */
export async function bereskanBerkasLampiran(
  l: { lampiranId: number | null; media_path: string | null; sha256: string | null; hasil: { ok?: boolean | null; galat?: string | null } },
  a: AlurBersih,
): Promise<HasilBersih> {
  const warn = a.peringatan ?? ((m: string) => console.warn(m));
  if (tindakanBerkas(l.hasil) !== "hapus" || l.lampiranId == null) return { aksi: "simpan" };
  const h = await (a.hapus ?? hapusBerkasLampiran)(l.media_path, { root: a.root, sha256: l.sha256 });
  if (h.status === "ditolak" || h.status === "gagal") {
    warn(`[kso-lampiran] berkas lampiran ${l.lampiranId} tidak dihapus (${h.status}: ${h.alasan})`);
    return { aksi: "hapus", berkas: h.status, ditandai: false, alasan: h.alasan };
  }
  try {
    await a.tandai(l.lampiranId);
    return { aksi: "hapus", berkas: h.status, ditandai: true };
  } catch (e) {
    warn(`[kso-lampiran] berkas lampiran ${l.lampiranId} terhapus tapi gagal ditandai: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    return { aksi: "hapus", berkas: h.status, ditandai: false, alasan: "tandai-gagal" };
  }
}
