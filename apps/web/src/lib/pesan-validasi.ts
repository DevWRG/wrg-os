// Pesan validasi form bawaan browser (atribut required/min/max/type/pattern)
// dalam Bahasa Indonesia. Tooltip bawaan mengikuti bahasa BROWSER, bukan
// halaman — di laptop berbahasa Inggris muncul "Please fill out this field." /
// "Value must be greater than or equal to 1." (temuan uji user 26 Okt 2026).
// Dipasang sekali untuk seluruh aplikasi lewat <ValidasiBrowserId/> di root layout.
//
// Pure (tanpa DOM) supaya bisa diuji unit: cukup bentuk minimal elemen form.

export interface ElemenValidasi {
  tagName: string;
  type?: string;
  value: string;
  min?: string;
  max?: string;
  minLength?: number;
  maxLength?: number;
  step?: string;
  title?: string;
  validity: Pick<
    ValidityState,
    | "valueMissing" | "typeMismatch" | "patternMismatch" | "tooShort" | "tooLong"
    | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput"
  >;
}

const JENIS_TANGGAL = new Set(["date", "datetime-local", "month", "week", "time"]);

function tampilBatas(type: string, v: string): string {
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-");
    return `${d}/${m}/${y}`;
  }
  return v;
}

/** Pesan Bahasa Indonesia untuk kegagalan validasi pertama; null = tak ada yang dikenali. */
export function pesanValidasi(el: ElemenValidasi): string | null {
  const v = el.validity;
  const tag = el.tagName.toUpperCase();
  const type = (el.type ?? "").toLowerCase();
  const tanggal = JENIS_TANGGAL.has(type);

  if (v.valueMissing) {
    if (tag === "SELECT" || type === "radio") return "Pilih salah satu.";
    if (type === "checkbox") return "Centang kotak ini untuk melanjutkan.";
    if (type === "file") return "Pilih berkas terlebih dulu.";
    return tanggal ? "Tanggal wajib diisi." : "Kolom ini wajib diisi.";
  }
  if (v.badInput) {
    if (type === "number") return "Masukkan angka yang valid.";
    return tanggal ? "Tanggal tidak valid." : "Isian tidak valid.";
  }
  if (v.typeMismatch) {
    if (type === "email") return "Format email tidak valid (contoh: nama@domain.com).";
    if (type === "url") return "Format tautan tidak valid (contoh: https://…).";
    return "Format isian tidak valid.";
  }
  if (v.patternMismatch) {
    return el.title?.trim() ? `Format tidak sesuai: ${el.title.trim()}` : "Format isian tidak sesuai.";
  }
  if (v.tooShort) return `Minimal ${el.minLength} karakter (sekarang ${el.value.length}).`;
  if (v.tooLong) return `Maksimal ${el.maxLength} karakter.`;
  if (v.rangeUnderflow) {
    const b = tampilBatas(type, el.min ?? "");
    return tanggal ? `Tidak boleh sebelum ${b}.` : `Nilai minimal ${b}.`;
  }
  if (v.rangeOverflow) {
    const b = tampilBatas(type, el.max ?? "");
    return tanggal ? `Tidak boleh sesudah ${b}.` : `Nilai maksimal ${b}.`;
  }
  if (v.stepMismatch) {
    const step = el.step ?? "";
    if (type === "number" && (step === "" || step === "1")) return "Harus bilangan bulat.";
    return type === "number" ? `Harus kelipatan ${step}.` : "Nilai tidak sesuai langkah yang diizinkan.";
  }
  return null;
}
