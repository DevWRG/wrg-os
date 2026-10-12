// Bypass gerbang identitas WA untuk SATU grup uji (mis. grup WhatsApp "Research").
// Dipicu eksplisit lewat env `WA_TEST_BYPASS_GROUP` (JID grup, boleh lebih dari
// satu dipisah koma) — TIDAK PERNAH aktif kecuali env itu di-set eksplisit di
// server yang bersangkutan. TIDAK BOLEH di-set di server produksi: begitu aktif,
// SIAPA PUN di grup itu otomatis dianggap "dikenal" oleh resolveSender/
// matchTeknisiByName untuk command baca/lapor (#STOK/#CEK/#PRICING/#SPH/
// #install/#servis/#training/#kalibrasi). #APPROVE/#REJECT SENGAJA tidak ikut
// bypass ini (lihat approval.ts) — approver tetap wajib terdaftar asli.
export function isWaTestBypassGroup(groupJid: string | null | undefined): boolean {
  const raw = process.env.WA_TEST_BYPASS_GROUP;
  if (!raw || !groupJid) return false;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(String(groupJid).trim());
}

// Penanda WAJIB untuk tiap baris roster yang lahir dari bypass ini.
//
// Kenapa bukan kolom flag: baris bypass masuk ke `master_user` dan
// `teknisi_capacity` — tabel yang SAMA dengan roster asli, dan dipakai puluhan
// query lain. `master_user` masih bisa disaring lewat `am_id LIKE 'WA-TEST-%'`,
// tapi `teknisi_capacity` di-key `nama` (pushname WA apa adanya) sehingga TAK
// ADA cara membedakannya dari teknisi sungguhan begitu dibuat. Nama yang
// ditandai ikut terbawa ke mana pun roster itu ditampilkan (Readiness Board,
// dropdown penugasan tiket, balasan WA), jadi salahnya kelihatan sebelum jadi
// masalah — bukan setelah.
//
// Ini juga yang membuat pembersihan mungkin: `LIKE '[UJI] %'`. Penting karena
// `service_ticket.assigned_teknisi_id` punya FK ke tabel itu (migrasi 175) —
// baris uji yang terlanjur dipakai menugasi tiket TIDAK bisa dihapus, dan tanpa
// penanda kita bahkan tak tahu baris mana yang perlu diselamatkan.
export const TANDA_UJI = "[UJI] ";

/** Nama roster untuk identitas hasil bypass — idempoten (tak menumpuk prefiks
 * kalau dipanggil ulang atas nama yang sudah bertanda). */
export function namaUji(pushname: string): string {
  const bersih = pushname.trim();
  return bersih.startsWith(TANDA_UJI) ? bersih : `${TANDA_UJI}${bersih}`;
}
