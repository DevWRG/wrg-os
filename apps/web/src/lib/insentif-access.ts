// Hak akses menu Insentif Tim (F67, migrasi 093/094). Dipakai sebagai `show` di nav.ts —
// dan karena layout dashboard men-gate rute dari katalog menu yang sama (findNavItem +
// navVisible → redirect), helper ini SEKALIGUS jadi gate halamannya. Jangan gate dengan
// render kondisional: page & layout dirender paralel, isi halaman tetap masuk RSC payload
// walau tak ditampilkan (PRD §E.2.10, akar bug PR #693).
//
// Hanya menu TIM yang punya helper di sini. "Insentif Saya" (/insentif, PR #814) sengaja
// TIDAK punya `show`: isinya selalu hanya diri pemanggil, jadi tak ada yang perlu
// dibedakan per identitas — aksesnya diatur murni lewat matriks Akses Grup.
//
// Pembatasan BARIS tetap milik server (repo/insentif.ts resolveAkses). Helper ini cuma
// menjawab "menu/halaman ini boleh dibuka atau tidak" — bukan "boleh lihat baris siapa".
// Ini fitur payroll: kalau dua lapis itu tercampur, yang jebol adalah slip gaji orang.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

const isDirekturish = (u: AccessUser): boolean =>
  norm(u.role) === "admin" || norm(u.role) === "direktur" || u.superuser === true;

const isHod = (u: AccessUser): boolean => !!u.hod_key || u.is_hod === true;

// Menu tim. Fallback identitas SENGAJA sempit: hanya Direktur/admin/superuser + HoD.
//
// Finance (Ika/Fafa) TIDAK dimasukkan ke fallback ini walau §E.1 memberi mereka akses,
// karena pemetaan role Finance belum diputus — `master_user` punya role 'Finance' (4 orang,
// terverifikasi di prod 2026-08-10) tapi `app_user` tidak, dan PRD §L Q12 masih terbuka soal
// grup RBAC 'finance' vs dititipkan ke superuser. Sampai itu diputus, akses Finance diberikan
// lewat matriks Akses Grup (fitur `insentif-tim`) — sadar dan tercatat per akun — bukan
// dengan menebak role di kode. Menebak di sini berarti membuka daftar penghasilan satu
// perusahaan berdasarkan tebakan.
export function canViewInsentifTim(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "insentif-tim", !!u && (isDirekturish(u) || isHod(u)));
}
