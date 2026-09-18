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
