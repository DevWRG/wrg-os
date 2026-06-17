import Link from "next/link";

// Gradient identitas WRG (brand teal #0ca6bd) → emerald, diagonal.
const WRG_GRADIENT = "linear-gradient(145deg, #0a8a9e 0%, #0ca6bd 48%, #2bd4a8 100%)";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ── Panel kiri: brand + value prop (gradient WRG) ── */}
      <aside className="relative hidden flex-col justify-between p-10 text-white lg:flex" style={{ background: WRG_GRADIENT }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wahana-lifeline-white.png" alt="Wahana LifeLine" className="h-9 w-auto" />

        <div className="max-w-md">
          <p className="text-xs font-medium tracking-[0.2em] text-white/70">WRG CRM · PLAN &amp; REPORT</p>
          <h1 className="mt-4 text-4xl font-bold leading-tight">Dashboard untuk plan &amp; report harian tim.</h1>
          <p className="mt-4 text-sm leading-relaxed text-white/80">
            Submit #PLAN pagi via WA, kirim #REPORT sore, lihat progress per orang/divisi/cabang/HOD area.
            Geotag verifikasi untuk AM sales visit.
          </p>

          <figure className="mt-8 rounded-xl border border-white/20 bg-white/10 p-5 backdrop-blur-sm">
            <blockquote className="text-sm leading-relaxed text-white/90">
              &ldquo;Sekali submit di WA, semua HOD bisa lihat real-time di dashboard. Lebih cepat, lebih akurat.&rdquo;
            </blockquote>
            <figcaption className="mt-4 flex items-center gap-2 text-xs text-white/70">
              <span className="flex size-7 items-center justify-center rounded-full bg-white/20 text-[10px] font-semibold">WL</span>
              Wahana LifeLine · Operations Team
            </figcaption>
          </figure>
        </div>

        <p className="font-mono text-xs text-white/50">© 2026 Wahana LifeLine · Plan &amp; Report v5</p>
      </aside>

      {/* ── Panel kanan: form ── */}
      <div className="bg-background flex flex-col">
        <header className="flex items-center justify-between px-6 py-6 sm:px-10">
          <span className="text-muted-foreground text-sm font-medium">WRG CRM</span>
          <p className="text-muted-foreground text-sm">
            Lupa password?{" "}
            <Link href="/forgot-password" className="text-primary font-medium hover:underline">
              Hubungi admin
            </Link>
          </p>
        </header>

        <main className="flex flex-1 items-center px-6 sm:px-10">
          <div className="mx-auto w-full max-w-md">{children}</div>
        </main>

        <footer className="text-muted-foreground/70 px-6 py-6 text-center text-xs sm:px-10">
          Belum punya password? Hubungi admin sistem (Husni).
        </footer>
      </div>
    </div>
  );
}
