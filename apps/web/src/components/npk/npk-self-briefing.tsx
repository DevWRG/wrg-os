import { ArrowDown, ArrowRight, ArrowUp, Info, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { fmt1, periodLabel, PREDIKAT_LABEL, type NpkDetailResult } from "./npk-format";
import { ASPEK_NAMA, TOTAL_ASPEK, zoneOf } from "./npk-status";

// `null` = TIDAK ADA pembanding (periode sebelumnya belum di-compute, atau periode
// ini belum punya aspek terukur) — bukan "tidak berubah". Dulu dirender "→ –" yang
// gampang kebaca sebagai delta nol; NPK AM baru punya baris S2 saja, jadi kasus ini
// normal dan harus dinyatakan apa adanya.
function deltaNode(v: number | null) {
  if (v == null) return <span className="text-[11px] leading-tight text-white/60">belum ada pembanding</span>;
  const up = v > 0, flat = v === 0;
  const Icon = flat ? ArrowRight : up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold", flat ? "text-white/60" : up ? "text-emerald-200" : "text-red-200")}>
      <Icon className="size-3" />{v > 0 ? "+" : ""}{fmt1(v)}
    </span>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur-sm">
      <div className="text-[10px] font-semibold tracking-wider text-white/70 uppercase">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2 text-white">{children}</div>
    </div>
  );
}

// Briefing-lite untuk halaman "NPK Saya" (dipakai HoD /npk/self maupun AM
// /npk/am-self): ringkasan naratif + delta + aspek terkuat/terlemah, di atas
// gauge/radar. Data tetap SK. Jujur soal coverage.
export function NpkSelfBriefing({ data, prevNpk }: { data: NpkDetailResult; prevNpk: number | null }) {
  const zone = zoneOf({ predikat: data.predikat, available_count: data.available_count });
  const hasData = data.available_count > 0;
  const delta = hasData && prevNpk != null ? Math.round((data.npk - prevNpk) * 100) / 100 : null;

  const avail = data.aspects.filter((a) => a.available && a.capped != null);
  const strongest = avail.length ? avail.reduce((m, a) => (a.capped! > m.capped! ? a : m)) : null;
  const weakest = avail.length > 1 ? avail.reduce((m, a) => (a.capped! < m.capped! ? a : m)) : null;
  const provisional = data.available_count < TOTAL_ASPEK;
  const wiredNama = avail.map((a) => ASPEK_NAMA[a.key]).join(", ") || "belum ada";
  // Plafon skor riil = Σ bobot aspek yang ada datanya. Menampilkan "/100" saat coverage
  // parsial membuat skor terlihat jauh lebih buruk dari kenyataannya.
  const ceiling = provisional ? avail.reduce((a, x) => a + x.weight, 0) : 100;

  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-700 to-teal-600 text-white shadow-[var(--shadow-card)] dark:from-teal-800 dark:to-teal-700">
      <div className="flex items-center justify-between gap-2 border-b border-white/15 px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <Sparkles className="size-4" /> Ringkasan NPK Saya
        </div>
        <div className="text-xs text-white/70">{periodLabel(data.period)} {data.year}</div>
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm leading-relaxed text-white/90">
          {!hasData ? (
            <>Belum ada aspek yang terukur untuk periode ini — skor NPK akan muncul begitu data aspek (target Revenue/Customer, AR, aktivitas CRM) tersedia untuk Anda.</>
          ) : (
            <>
              NPK Anda <span className="font-semibold text-white">{fmt1(data.npk)}/{ceiling}</span> — {zone.label}
              {!provisional && <> ({PREDIKAT_LABEL[data.predikat]})</>}, {data.available_count}/{TOTAL_ASPEK} aspek terukur.
              {delta != null && <> {delta >= 0 ? "Naik" : "Turun"} <span className="font-semibold">{fmt1(Math.abs(delta))}</span> vs semester lalu.</>}
              {strongest && <> Aspek terkuat <span className="font-semibold">{strongest.label}</span> ({fmt1(strongest.capped)}){weakest && weakest.key !== strongest.key && <>, perlu perbaikan <span className="font-semibold">{weakest.label}</span> ({fmt1(weakest.capped)})</>}.</>}
            </>
          )}
        </p>

        {provisional && (
          <p className="flex items-start gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs text-white/85">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Skor SEMENTARA — baru <span className="font-semibold">{data.available_count}/{TOTAL_ASPEK} aspek</span> ({wiredNama}) yang punya feed data live, jadi skor maksimum yang bisa dicapai sekarang <span className="font-semibold">{ceiling} dari 100</span>. Predikat SK ditahan sampai ke-7 aspek ter-feed — angka rendah di sini berarti data belum lengkap, bukan penilaian kinerja.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label="NPK"><span className="text-xl font-bold tabular-nums">{hasData ? fmt1(data.npk) : "–"}</span><span className="text-xs text-white/60">/{ceiling}</span></Tile>
          <Tile label="Status"><span className="text-sm font-semibold">{zone.label}</span></Tile>
          <Tile label="Coverage"><span className="text-xl font-bold tabular-nums">{data.available_count}/{TOTAL_ASPEK}</span></Tile>
          <Tile label="vs Semester Lalu">{deltaNode(delta)}</Tile>
        </div>
      </div>
    </div>
  );
}
