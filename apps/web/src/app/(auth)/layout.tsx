import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="from-primary-soft/30 flex min-h-screen flex-col bg-gradient-to-b to-transparent">
      {/* Top bar — logo kiri, link bantuan kanan (gaya WRG-CRM) */}
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/dashboard" className="flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wahana-lifeline-color.png" alt="Wahana Lifeline" className="h-7 w-auto dark:hidden" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wahana-lifeline-white.png" alt="Wahana Lifeline" className="hidden h-7 w-auto dark:block" />
        </Link>
        <p className="text-muted-foreground text-sm">
          Lupa password?{" "}
          <Link href="/forgot-password" className="text-primary font-medium hover:underline">
            Hubungi admin
          </Link>
        </p>
      </header>

      {/* Area form — kiri-rata dalam container sempit, terpusat vertikal */}
      <main className="flex flex-1 items-center px-6 sm:px-10">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </main>

      <footer className="text-muted-foreground/70 px-6 py-6 text-xs sm:px-10">
        Belum punya akun? Hubungi admin sistem (Husni). · © 2026 Wahana Lifeline · WRG OS
      </footer>
    </div>
  );
}
