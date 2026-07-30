import { redirect } from "next/navigation";

// Menu Pricelist Setup sudah lebur jadi tab "Setup Harga" di /pricebook (di dalamnya
// masih ada dua sub-tab: kalkulator produk Accurate 043 + kroscek price book 073).
// Route ini dipertahankan supaya bookmark lama tidak mati.
//
// Gate-nya ada di tujuan: tab Setup Harga cuma dirender untuk HoD Business /
// Purchasing / admin, dan endpoint ber-HPP tidak dipanggil untuk yang lain.
export default function PricelistSetupRedirect() {
  redirect("/pricebook?tab=setup");
}
