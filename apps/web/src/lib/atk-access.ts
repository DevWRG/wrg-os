// Gerbang tulis /api/atk/stock-movements per JENIS gerakan. Dulu POST/PATCH/
// DELETE lolos bila user memegang SALAH SATU menu ATK (In/Out/Opname) — begitu
// karyawan diberi "Stock Out" (self-service), ia ikut bisa mencatat Barang Masuk
// dan mengubah/menghapus mutasi siapa pun lewat curl.
//
// Pemetaan mengikuti pemakaian di UI:
//   - Stock In (GA): form "in" + edit/hapus SEMUA mutasi (koreksi salah catat)
//   - Stock Out (karyawan): form "out", riwayat read-only
//   - Stock Opname: penyesuaian selisih → "in" (lebih) atau "out" (kurang)
// Baca (GET) tetap boleh dari ketiga menu — ketiga halaman menampilkan riwayat.

export type AtkMovementType = "in" | "out";

export const MENU_ATK = ["/atk-stock-in", "/atk-stock-out", "/atk-stock-opname"] as const;

export function atkCreateMenus(type: unknown): readonly string[] | null {
  if (type === "in") return ["/atk-stock-in", "/atk-stock-opname"];
  if (type === "out") return ["/atk-stock-out", "/atk-stock-opname"];
  return null;
}

// Edit & hapus mutasi = koreksi oleh GA di halaman Stock In saja.
export const MENU_ATK_KOREKSI = ["/atk-stock-in"] as const;
