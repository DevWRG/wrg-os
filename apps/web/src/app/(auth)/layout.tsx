import Link from "next/link";
import { HeartPulse } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Aside kiri — panel brand gradient (Adminator auth-aside), sembunyi di mobile */}
      <div className="from-primary to-purple relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -top-1/4 -right-1/4 aspect-square w-3/4 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.18),transparent_60%)]" />
        <div className="pointer-events-none absolute -bottom-1/4 -left-1/4 aspect-square w-3/4 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.10),transparent_60%)]" />

        <Link href="/dashboard" className="relative flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-white/15">
            <HeartPulse className="size-5" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-semibold">WRG OS</span>
            <span className="text-xs text-white/70">Wahana Lifeline</span>
          </div>
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
          <Link href="/dashboard" className="mb-8 flex items-center gap-2 text-sm font-semibold lg:hidden">
            <div className="from-primary to-purple text-primary-foreground flex size-8 items-center justify-center rounded-md bg-gradient-to-br">
              <HeartPulse className="size-4" />
            </div>
            <div className="flex flex-col leading-none">
              <span>WRG OS</span>
              <span className="text-muted-foreground text-xs font-normal">Wahana Lifeline</span>
            </div>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
