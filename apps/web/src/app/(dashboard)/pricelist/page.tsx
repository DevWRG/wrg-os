import { redirect } from "next/navigation";

// Menu Pricelist sudah lebur jadi tab "Harga per Produk" di /pricebook (satu pintu
// untuk semua harga jual). Route ini dipertahankan supaya bookmark, tautan di pesan
// WA, dan riwayat browser lama tidak mati — bukan sisa yang lupa dihapus.
//
// Gate-nya ada di tujuan: /pricebook cuma menampilkan tab ini untuk yang berizin
// (canViewPricelist), dan datanya tidak diambil kalau tak berhak.
export default function PricelistRedirect() {
  redirect("/pricebook?tab=harga");
}
