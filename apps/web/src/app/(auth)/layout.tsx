// Gradient identitas WRG (brand teal → emerald). Dipakai sebagai FALLBACK panel
// kiri bila foto hero (/brand/hero-login.jpg) belum tersedia — jadi tak pernah
// broken: kalau file ada, foto menutupi gradient; kalau tidak, gradient tampil.
const WRG_GRADIENT = "linear-gradient(160deg, #0a8a9e 0%, #0ca6bd 45%, #2bd4a8 100%)";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40 flex min-h-screen p-3 sm:p-4">
      <div className="bg-background grid w-full overflow-hidden rounded-3xl shadow-sm lg:grid-cols-[1.05fr_1fr]">
        {/* ── Panel kiri: hero (foto di atas gradient brand + overlay) ── */}
        <aside className="relative hidden overflow-hidden rounded-3xl lg:block" style={{ background: WRG_GRADIENT }}>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url('/brand/hero-login.jpg')" }}
            aria-hidden
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/30" aria-hidden />

          <div className="relative flex h-full flex-col justify-between p-8 text-white sm:p-10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wahana-lifeline-white.png" alt="Wahana LifeLine" className="h-8 w-auto max-w-[190px] object-contain drop-shadow" />

            <div className="max-w-md">
              <p className="text-xs font-medium tracking-[0.2em] text-white/70">WRG OPERATING SYSTEM</p>
              <h2 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl">WRG OS</h2>

              <figure className="mt-6 rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
                <figcaption className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">WL</span>
                  <span className="leading-tight">
                    <span className="block text-sm font-semibold">Wahana LifeLine</span>
                    <span className="block text-xs text-white/70">Operations Team</span>
                  </span>
                </figcaption>
              </figure>
            </div>
          </div>
        </aside>

        {/* ── Panel kanan: form ── */}
        <div className="bg-background flex flex-col">
          <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-12">
            <div className="w-full max-w-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-color.png" alt="Wahana LifeLine" className="mx-auto h-10 w-auto object-contain dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wahana-lifeline-white.png" alt="Wahana LifeLine" className="mx-auto hidden h-10 w-auto object-contain dark:block" />
              <div className="mt-8">{children}</div>
            </div>
          </div>
          <footer className="text-muted-foreground/70 px-6 pb-8 text-center text-xs">
            © 2026 Wahana LifeLine · WRG OS
          </footer>
        </div>
      </div>
    </div>
  );
}
