// Allow-list folder untuk GET /media (foto kunjungan WA + berkas Aset GA).
//
// Dua root, dua sumber: MEDIA_ROOT = media MASUK dari WhatsApp (capture openclaw,
// dibaca saja), GA_UPLOAD_ROOT = berkas yang diunggah admin GA (foto/dokumen aset,
// berita acara relokasi). Izin menu diperiksa di BFF (apps/web/src/app/api/media),
// lalu BFF mengirim root mana yang boleh dibuka lewat header `x-media-scope`
// ("wa", "ga", dipisah koma). Service token mem-bypass JWT di API, jadi tanpa
// header ini /media dulu melayani SEMUA path di kedua root untuk user login mana pun.

import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export type ScopeMedia = "wa" | "ga";

/** MEDIA_ROOT: media MASUK WhatsApp (capture openclaw). Satu sumber untuk GET /media, rute lampiran KSO, dan hapus lampiran (305). */
export function mediaRootWa(): string {
  return resolve(process.env.MEDIA_ROOT ?? `${homedir()}/.openclaw/media`);
}

/** `abs` di dalam `root`? path.relative aman lintas-platform (startsWith gagal di backslash). */
export function isInsideRoot(abs: string, root: string): boolean {
  const rel = relative(root, abs);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Root yang boleh dibuka untuk nilai header `x-media-scope`. Header kosong/tak dikenal = tak ada root. */
export function rootDariScope(header: string | null | undefined, roots: Record<ScopeMedia, string>): string[] {
  const minta = new Set((header ?? "").split(",").map((s) => s.trim().toLowerCase()));
  return (Object.keys(roots) as ScopeMedia[]).filter((k) => minta.has(k)).map((k) => roots[k]);
}
