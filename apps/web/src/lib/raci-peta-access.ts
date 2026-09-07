import { can } from "./perms";
import { sessionUser, type SessionUserSrv } from "./admin-guard";

// Hak MENETAPKAN pemetaan posisi↔karyawan (tautan sumber='manual', F157).
//
// Gate-nya izin `edit` pada fitur `people-raci` di matriks Akses Grup —
// dipilih user 2026-09-07. Konsekuensinya kebijakan siapa-boleh diatur lewat
// UI Akses Grup yang sudah ada, tanpa perubahan kode.
//
// SENGAJA DIPISAH DARI HAK LIHAT. Menu /people/raci terbuka untuk semua yang
// login (sama seperti sebelum F157), tapi MENULIS pemetaan orang ke posisi
// bukan hal yang boleh dilakukan siapa saja: hasilnya dipakai membaca beban
// proses per orang, dan salah tetap tersimpan sebagai keputusan bernama.
//
// Ini gate `can(..., "edit")` PERTAMA di sisi server pada repo ini — sebelumnya
// semua guard bertingkat identitas (requireAdmin / requireDirekturOrAdmin /
// requireHodOrAdmin). Kalau nanti ada fitur lain yang butuh pola sama,
// generalisasikan dari sini, jangan salin-tempel.

export function canEditRaciPeta(u?: SessionUserSrv | null): boolean {
  // can() fail-open saat izin TAK TERSEDIA (auth mati / DB off) — itu perilaku
  // yang disengaja di lib/perms untuk hak LIHAT. Untuk hak TULIS kita tidak
  // ikut fail-open: tanpa sesi, tolak.
  if (!u) return false;
  return can(u, "people-raci", "edit");
}

/** Guard route: balikan {ok, me} atau Response 401/403 siap-return. */
export async function requireRaciEdit(): Promise<
  { ok: true; me: SessionUserSrv } | { ok: false; res: Response }
> {
  const u = await sessionUser();
  if (!u) return { ok: false, res: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  if (!canEditRaciPeta(u)) {
    return {
      ok: false,
      res: Response.json(
        { error: "forbidden — butuh izin edit pada fitur 'people-raci' di Akses Grup" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, me: u };
}
