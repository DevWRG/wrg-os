"use client";

import { Fragment, useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// F85 Senin Morning Brief — tampilan satu brief mingguan. Tabel kesiapan
// dirender dari `checks` (data terstruktur), BUKAN dari markdown, supaya warna
// status konsisten dengan WatchPoint. Narasi LLM dirender dari markdown-nya.

type CekHasil = "OK" | "WARN" | "FAIL" | "NA";
type HodStatus = "SIAP" | "PERLU KLARIFIKASI" | "TIDAK SIAP";
type Health = "RED" | "RISK" | "ON-TRACK";

export interface SeninBrief {
  id: string;
  iso_year: number;
  iso_week: number;
  periode: string;
  health: Health;
  checks: {
    hod_key: string;
    nama: string;
    peran: string;
    status: HodStatus;
    checks: { no: number; label: string; hasil: CekHasil; detail: string }[];
  }[];
  content: string;
  narasi_ok: boolean;
  model_used: string | null;
  wa_terkirim: boolean;
  wa_sent_at: string | null;
  wa_error: string | null;
  generated_at: string;
}

// Sama dengan chip status di components/watchpoint/* (GREEN/YELLOW/RED/NA).
const CHIP_CEK: Record<CekHasil, string> = {
  OK: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
  WARN: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
  FAIL: "bg-destructive/10 text-destructive",
  NA: "text-muted-foreground",
};
const TEKS_CEK: Record<CekHasil, string> = { OK: "OK", WARN: "Kurang", FAIL: "Gagal", NA: "—" };
const CHIP_STATUS: Record<HodStatus, string> = {
  SIAP: CHIP_CEK.OK,
  "PERLU KLARIFIKASI": CHIP_CEK.WARN,
  "TIDAK SIAP": CHIP_CEK.FAIL,
};
const CHIP_HEALTH: Record<Health, string> = {
  "ON-TRACK": CHIP_CEK.OK,
  RISK: CHIP_CEK.WARN,
  RED: CHIP_CEK.FAIL,
};
const LABEL_CEK = ["Data terkini", "Pipeline ber-Rp", "Tindak lanjut", "KPI terlacak", "Data basi"];

const fmtWaktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

/** **tebal** → <strong>; sisanya teks biasa (tanpa HTML mentah). */
function inline(teks: string): ReactNode[] {
  return teks.split(/(\*\*[^*]+\*\*)/g).map((bagian, i) =>
    bagian.startsWith("**") && bagian.endsWith("**")
      ? <strong key={i}>{bagian.slice(2, -2)}</strong>
      : <Fragment key={i}>{bagian}</Fragment>,
  );
}

/** Renderer markdown minimal untuk narasi LLM: ##/###, bullet, daftar bernomor, paragraf. */
function Narasi({ md }: { md: string }) {
  const blok: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const tutupList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blok.push(
      <Tag key={blok.length} className={cn("my-2 space-y-1 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
        {list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
      </Tag>,
    );
    list = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const nomor = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || nomor) {
      const ordered = Boolean(nomor);
      if (list && list.ordered !== ordered) tutupList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? nomor)![1]);
      continue;
    }
    tutupList();
    if (!line.trim()) continue;
    if (line.startsWith("### ")) blok.push(<h4 key={blok.length} className="mt-4 font-semibold">{inline(line.slice(4))}</h4>);
    else if (line.startsWith("## ")) blok.push(<h3 key={blok.length} className="mt-6 border-b pb-1 text-base font-semibold first:mt-0">{inline(line.slice(3))}</h3>);
    else blok.push(<p key={blok.length} className="my-2">{inline(line)}</p>);
  }
  tutupList();
  return <div className="text-sm leading-relaxed">{blok}</div>;
}

export function SeninBriefView({ briefs }: { briefs: SeninBrief[] }) {
  const [pilih, setPilih] = useState(0);
  if (briefs.length === 0) {
    return (
      <p className="text-muted-foreground">
        Belum ada Senin Brief. Job <code>senin-brief</code> menyusunnya tiap Senin 06:30 (flag{" "}
        <code>SENIN_BRIEF_ENABLED</code>).
      </p>
    );
  }
  const b = briefs[Math.min(pilih, briefs.length - 1)];
  const idxNarasi = b.content.indexOf("## Gap Utama per HoD");
  const narasi = b.narasi_ok && idxNarasi >= 0 ? b.content.slice(idxNarasi) : null;
  const catatanGagal = b.narasi_ok ? null : /^> ⚠️ (.*)$/m.exec(b.content)?.[1] ?? "Narasi AI tidak tersedia.";
  const jumlah = (s: HodStatus) => b.checks.filter((h) => h.status === s).length;

  return (
    <div className="space-y-4">
      {briefs.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {briefs.map((x, i) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setPilih(i)}
              className={cn(
                "rounded-md border px-3 py-1 text-sm",
                i === pilih ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
              )}
            >
              W{x.iso_week}
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="text-base">Senin Brief W{b.iso_week} — {b.periode}</CardTitle>
            <p className="text-muted-foreground mt-1 text-xs">
              Disusun {fmtWaktu(b.generated_at)} · {b.model_used ?? "tanpa LLM"} ·{" "}
              {b.wa_terkirim ? `WA Direktur terkirim ${b.wa_sent_at ? fmtWaktu(b.wa_sent_at) : ""}` : b.wa_error ? `WA gagal: ${b.wa_error}` : "WA belum dikirim"}
            </p>
          </div>
          <span className={cn("rounded-md px-2.5 py-1 text-sm font-semibold", CHIP_HEALTH[b.health])}>
            Overall Health: {b.health}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{jumlah("SIAP")} SIAP</Badge>
            <Badge variant="outline">{jumlah("PERLU KLARIFIKASI")} perlu klarifikasi</Badge>
            <Badge variant="outline">{jumlah("TIDAK SIAP")} tidak siap</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-3 font-medium">HoD</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  {LABEL_CEK.map((l, i) => (
                    <th key={l} className="py-2 pr-3 font-medium">{i + 1}. {l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.checks.map((h) => (
                  <tr key={h.hod_key} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{h.nama}</div>
                      <div className="text-muted-foreground text-xs">{h.peran}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={cn("rounded px-2 py-0.5 text-xs font-semibold whitespace-nowrap", CHIP_STATUS[h.status])}>
                        {h.status}
                      </span>
                    </td>
                    {h.checks.map((c) => (
                      <td key={c.no} className="py-2 pr-3" title={c.detail}>
                        <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", CHIP_CEK[c.hasil])}>
                          {TEKS_CEK[c.hasil]}
                        </span>
                        <div className="text-muted-foreground mt-1 max-w-[16rem] text-xs">{c.detail}</div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">
            Status dihitung dari data, bukan AI: SIAP = semua cek hijau · TIDAK SIAP = ≥3 cek gagal · — = cek tak berlaku.
            Cek 3 sementara memakai kepatuhan #PLAN/#REPORT AM (belum ada catatan action item rapat).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Gap, Pertanyaan Kritis &amp; Usulan Keputusan</CardTitle>
        </CardHeader>
        <CardContent>
          {narasi ? <Narasi md={narasi} /> : <p className="text-muted-foreground text-sm">⚠️ {catatanGagal}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
