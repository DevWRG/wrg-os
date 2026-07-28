import { redirect } from "next/navigation";

import { sessionUser } from "@/lib/admin-guard";
import { homePath } from "@/lib/nav";

export const dynamic = "force-dynamic";

// Root = pengalih ke menu pertama yang boleh dilihat user (belum tentu
// /overview) — lihat homePath(). Tujuan default setelah login juga ke sini.
export default async function Home() {
  redirect(homePath(await sessionUser()));
}
