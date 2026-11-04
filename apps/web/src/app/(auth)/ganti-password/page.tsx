import { redirect } from "next/navigation";

import { sessionUser } from "@/lib/admin-guard";

import { GantiPasswordForm } from "./ganti-password-form";

export const dynamic = "force-dynamic";

// Halaman wajib-ganti-password. Layout dashboard mengarahkan ke sini selama
// app_user.force_change = true; di luar grup (dashboard) supaya tak berputar.
export default async function GantiPasswordPage() {
  const me = await sessionUser();
  if (!me) redirect("/login?next=/ganti-password");
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Ganti password</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
        {me.force_change
          ? "Akun Anda masih memakai password awal atau baru direset admin. Ganti dulu sebelum melanjutkan."
          : "Ganti password akun Anda."}
      </p>
      <div className="mt-8">
        <GantiPasswordForm />
      </div>
    </div>
  );
}
