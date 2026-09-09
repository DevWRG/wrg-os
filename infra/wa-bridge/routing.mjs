// Routing pesan masuk per GRUP: grup uji → API dev, sisanya → API prod.
//
// Kenapa per grup, bukan akun WhatsApp kedua: bridge cuma satu dan terikat satu
// sesi WhatsApp. Menambah akun kedua berarti nomor baru, sesi baru, dan grup
// harus mengundangnya. Memilih tujuan berdasarkan `group_jid` mencapai hal yang
// sama tanpa itu semua — pesan dari grup Research diproses kode dev terhadap
// database dev, sisanya tetap ke prod.
//
// DIPISAH KE MODUL SENDIRI supaya bisa diuji tanpa menyalakan bridge —
// bridge.mjs memasang setInterval dan server HTTP saat di-import.

/** Baca daftar group_jid dev dari env. Koma-pisah, spasi diabaikan. */
export function parseDevGroups(raw) {
  return new Set(
    String(raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Tentukan ke mana satu rekaman diteruskan.
 *
 * Mengembalikan { url, secret, keDev } — atau MELEMPAR kalau grup terdaftar
 * sebagai dev tapi tujuannya belum dikonfigurasi.
 *
 * ⚠️ SENGAJA TIDAK ADA FALLBACK KE PROD. Kalau tujuan dev tak tersedia, pesan
 * uji harus TERTAHAN dan terlihat, bukan diam-diam mendarat di database prod.
 * Fallback yang "membantu" di sini justru menghapus seluruh gunanya pemisahan:
 * satu salah konfigurasi dan lalu lintas uji masuk prod tanpa ada yang tahu.
 * Pemanggil (pollFile) tidak memajukan offset saat melempar, jadi pesannya
 * dicoba lagi tiap poll — dan karena file capture dipisah per grup, yang
 * tertahan hanya grup itu, bukan lalu lintas prod.
 */
export function pilihTujuan(rec, cfg) {
  const grup = String(rec?.group_jid || "");
  const keDev = grup !== "" && cfg.devGroups.has(grup);

  if (!keDev) return { url: cfg.prodUrl, secret: cfg.prodSecret, keDev: false };

  if (!cfg.devUrl) {
    throw new Error(
      `grup ${grup} terdaftar di WA_DEV_GROUPS tapi WRG_WEBHOOK_URL_DEV kosong — ` +
        "pesan DITAHAN (tidak dialihkan ke prod). Isi WRG_WEBHOOK_URL_DEV di .env.prod.",
    );
  }
  return { url: cfg.devUrl, secret: cfg.devSecret, keDev: true };
}

/** Ringkasan konfigurasi untuk dicetak saat bridge menyala. */
export function ringkasRouting(cfg) {
  if (cfg.devGroups.size === 0) return "routing dev: MATI (WA_DEV_GROUPS kosong) — semua ke prod";
  const daftar = [...cfg.devGroups].join(", ");
  return cfg.devUrl
    ? `routing dev: ${cfg.devGroups.size} grup → ${cfg.devUrl} (${daftar})`
    : `routing dev: ${cfg.devGroups.size} grup terdaftar TAPI WRG_WEBHOOK_URL_DEV KOSONG — pesan grup itu akan TERTAHAN (${daftar})`;
}
