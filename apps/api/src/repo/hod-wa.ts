import { db } from "../db.js";

// Nomor WA seorang HoD untuk DM otomatis (rekap kesehatan KSO F73, pengingat lead
// F65). Urutan: akun login (app_user.hod_key) ber-WA → cadangan master_user
// ber-peran HOD yang panggilannya = master_hod.panggilan.
//
// Kenapa perlu cadangan: di prod (13 Okt 2026) akun login Rocky & Yogi TIDAK
// punya hod_key, jadi jalur lama selalu buntu ("belum ada akun ber-nomor WA") dan
// pengingat ke HoD tak pernah terkirim. hod_key di app_user TIDAK diisi sebagai
// gantinya: kolom itu juga menentukan cakupan data (resolveScope) — mengisinya
// diam-diam mengubah apa yang dilihat HoD di semua menu.
//
// Kunci masukan dinormalkan dulu ke master_hod.hod_key (huruf kecil). Pemanggil
// tak selalu memegang hod_key: deal.pic_hod / lead.pic_hod berisi bentuk kanonik
// norm_hod() = "Rocky"/"Yogi" (huruf besar di depan), sehingga pencocokan persis
// selalu meleset dan pengingat ke HoD tak pernah terkirim (ketahuan 3 Nov 2026 di
// job deal-dormant: "HoD Rocky: nomor WA tak ditemukan"). Cocokkan hod_key,
// panggilan, atau alias tanpa peduli huruf besar-kecil; tak ketemu → masukan apa adanya.
export async function waHod(masukan: string): Promise<{ nama: string; wa: string } | null> {
  const sql = db();
  const m = masukan.trim().toLowerCase();
  const [k] = await sql`
    SELECT hod_key FROM master_hod
    WHERE lower(hod_key) = ${m} OR lower(btrim(panggilan)) = ${m} OR ${m} = ANY(alias)
    ORDER BY (lower(hod_key) = ${m}) DESC LIMIT 1`;
  const hodKey = k ? String(k.hod_key) : masukan;
  const [u] = await sql`
    SELECT name, wa_number FROM app_user
    WHERE hod_key = ${hodKey} AND active = true AND NULLIF(btrim(wa_number), '') IS NOT NULL
    LIMIT 1`;
  if (u) return { nama: String(u.name ?? hodKey), wa: String(u.wa_number) };
  const ms = await sql`
    SELECT mu.nama, mu.wa_number
    FROM master_hod h
    JOIN master_user mu ON upper(btrim(mu.panggilan)) = upper(btrim(h.panggilan))
                       AND upper(mu.role) = 'HOD' AND mu.aktif
    WHERE h.hod_key = ${hodKey} AND h.aktif AND NULLIF(btrim(mu.wa_number), '') IS NOT NULL
    LIMIT 2`;
  // Lebih dari satu kecocokan = ambigu → jangan menebak penerima.
  if (ms.length !== 1) return null;
  return { nama: String(ms[0].nama ?? hodKey), wa: String(ms[0].wa_number) };
}
