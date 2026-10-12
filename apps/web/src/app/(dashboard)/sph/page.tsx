import { redirect } from "next/navigation";

// Breadcrumb (components/layout/breadcrumbs.tsx) bikin SETIAP segmen path
// bisa diklik, termasuk "Sph" di /sph/new — tanpa halaman index ini, klik
// segmen itu 404 krn belum ada page.tsx di /sph sendiri. Satu-satunya
// sub-halaman F15 saat ini cuma /sph/new, jadi redirect ke situ.
export default function SphIndexPage() {
  redirect("/sph/new");
}
