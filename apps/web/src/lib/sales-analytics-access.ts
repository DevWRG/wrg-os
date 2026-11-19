// Gerbang proxy /api/sales-analytics/[...path] per sub-path. BFF ini dipakai
// TIGA menu (Sales Analytics, Kinerja Saya, Sales Alerts), jadi gerbang tunggal
// /sales-analytics akan mematikan dua menu lain bagi yang tak memegangnya.
//
// Alert (alerts, alert-targets) HANYA menu Sales Alerts. Dulu pemegang Sales
// Analytics (termasuk AM) ikut lolos: bisa membuat alert yang mengirim metrik
// TANPA row-scope AM ke JID WA mana pun, dan membaca daftar semua grup WA +
// nomor user lewat alert-targets. alerts/evaluate memicu kirim WA → admin saja
// (null). Aksi sengaja "view" untuk semua method: matriks create/edit/delete
// sales-alerts di prod belum konsisten (19 Nov 2026), aksi tulis menyusul
// setelah ditinjau supaya pemakai sah tidak terpotong.

export function salesAnalyticsMenus(sub: string): readonly string[] | null {
  const sub0 = sub.split("/")[0] ?? "";
  if (sub === "alerts/evaluate") return null;
  if (sub0 === "alerts" || sub0 === "alert-targets") return ["/sales-alerts"];
  if (sub0 === "overview" || sub0 === "per-customer" || sub0 === "my-ar") return ["/sales-analytics", "/me"];
  return ["/sales-analytics"];
}
