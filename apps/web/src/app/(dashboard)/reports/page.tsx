import { redirect } from "next/navigation";

// Menu "Reports" dulu cuma 4 kartu placeholder ("Generate / preview belum
// dihubungkan ke data riil") — dicabut dari menu pada audit data statis
// 9 Okt 2026. Laporan nyatanya sudah punya menu sendiri: Sales Analytics,
// Inventory, AR. Rute dipertahankan sebagai redirect supaya bookmark lama tak
// 404; "/" mengarah ke menu pertama yang boleh dilihat user.
export default function ReportsRedirect(): never {
  redirect("/");
}
