import { redirect } from "next/navigation";

// Raport Karyawan dilebur ke hub "Karyawan 360". Route lama dialihkan.
export default function RaportKaryawanRedirect() {
  redirect("/karyawan");
}
