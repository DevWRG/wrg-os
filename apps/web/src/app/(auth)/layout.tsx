import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Aside kiri — panel brand gradient cyan→coral (WRG), sembunyi di mobile */}
      <div className="from-primary to-wrg-coral relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -top-1/4 -right-1/4 aspect-square w-3/4 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.18),transparent_60%)]" />
        <div className="pointer-events-none absolute -bottom-1/4 -left-1/4 aspect-square w-3/4 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.10),transparent_60%)]" />

        <Link href="/dashboard" className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wahana-lifeline-white.png" alt="Wahana Lifeline" className="h-11 w-auto" />
        </Link>

        <div className="relative">
          <p className="mb-3 text-[11px] font-semibold tracking-wider text-white/70 uppercase">Dashboard Internal</p>
          <p className="max-w-sm text-2xl leading-snug font-semibold">
            Plan, report, dan kepatuhan tim sales dalam satu tempat.
          </p>
          <p className="mt-4 text-sm text-white/70">Geotag visit · pipeline · AR · intelijen kompetitor — live dari lapangan.</p>
        </div>

        <p className="relative text-xs text-white/60">© 2026 Wahana Lifeline · WRG OS</p>
      </div>

      {/* Main kanan — area form */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Link href="/dashboard" className="mb-8 flex lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wahana-lifeline-color.png" alt="Wahana Lifeline" className="h-9 w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wahana-lifeline-white.png" alt="Wahana Lifeline" className="hidden h-9 w-auto dark:block" />
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
