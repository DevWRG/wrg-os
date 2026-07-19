import { redirect } from "next/navigation";

// People Analytics (editor profil spine) sudah dilebur ke hub "Karyawan 360"
// (tab Kelola Profil). Route lama dialihkan. Sub-menu /people/raci, /org, /voice,
// /hod-resolve tetap terpisah.
export default function PeopleRedirect() {
  redirect("/karyawan");
}
