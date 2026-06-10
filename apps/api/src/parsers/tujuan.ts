// Normalisasi tujuan kunjungan ke whitelist (port legacy/crm skills/wrg-plan/SKILL.md).
// Tidak cocok → kembalikan as-is (jangan reject).

const TUJUAN_MAP: Record<string, string> = {};
const register = (canonical: string, ...aliases: string[]) => {
  for (const a of aliases) TUJUAN_MAP[a.toLowerCase()] = canonical;
};

register("Kunjungan Fisik", "kunjungan fisik", "visit", "kunjungan", "ktm", "kf");
register("Telepon", "telepon", "telp", "call", "tlp", "telfon");
register("WA", "wa", "whatsapp", "chat", "msg", "pesan");
register("Demo", "demo", "demonstrasi", "demo produk");
register("Presentasi", "presentasi", "present", "pitch", "pres");
register("Follow-up", "follow-up", "follow up", "fu", "tl", "fl", "followup");
register("Instalasi", "instalasi", "install", "pasang");
register("Pengiriman", "pengiriman", "kirim", "delivery");
register("Servis", "servis", "service", "perbaikan");
register("Training", "training", "pelatihan", "train");
register("Lainnya", "lainnya", "other", "dll");

export function normalizeTujuan(input: string): string {
  const key = input.trim().toLowerCase();
  return TUJUAN_MAP[key] ?? input.trim();
}
