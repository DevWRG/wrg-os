import { notFound } from "next/navigation";

import { sessionUser } from "@/lib/admin-guard";
import { ShowcaseTabs } from "./showcase-tabs";

// UI Showcase = katalog komponen untuk developer, isinya angka contoh (bukan
// data riil). Sudah dicabut dari menu (audit data statis 9 Okt 2026). Gate di
// sini wajib karena layout dashboard tak meng-gate rute di luar katalog menu —
// tanpa ini URL-nya tetap terbuka untuk semua yang login. notFound(), bukan
// akses-ditolak: bagi non-admin halaman ini memang tak ada.
export default async function ShowcaseLayout({ children }: { children: React.ReactNode }) {
  const me = await sessionUser();
  if (!(me?.superuser === true || me?.role === "admin")) notFound();
  return <ShowcaseTabs>{children}</ShowcaseTabs>;
}
