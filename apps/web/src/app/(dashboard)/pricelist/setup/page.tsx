import { redirect } from "next/navigation";

// Menu Pricelist Setup pindah ke /pricebook/setup (nama menu "Setup Harga"; di
// dalamnya masih ada dua sub-tab: kalkulator produk Accurate 043 + kroscek price
// book 073). Route ini dipertahankan supaya bookmark lama tidak mati.
//
// Gate-nya ada di tujuan: /pricebook/setup hanya untuk HoD Business / Purchasing /
// admin dan meng-redirect yang lain, jadi endpoint ber-HPP tak pernah dipanggil.
export default function PricelistSetupRedirect() {
  redirect("/pricebook/setup");
}
