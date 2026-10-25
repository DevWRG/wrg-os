"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// F63 Weekly Briefing Direktur — briefing untuk minggu yang baru mulai, disusun Senin 07:00
// dari rekap + resume minggu lalu (tabel briefing_mingguan). Isi = teks terformat (bagian A–H)
// dari LLM, ditampilkan apa adanya; WA ke Direktur hanya berisi LINK ke tab ini.

export interface BriefingMingguan {
  id: string;
  iso_year: number;
  iso_week: number;
  periode: string;
  dasar_dari: string;
  dasar_sampai: string;
  n_rekap: number;
  n_resume: number;
  content: string;
  narasi_ok: boolean;
  model_used: string | null;
  wa_terkirim: boolean;
  wa_sent_at: string | null;
  wa_error: string | null;
  generated_at: string;
}

const fmtWaktu = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const fmtTgl = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export function BriefingMingguanView({ briefs }: { briefs: BriefingMingguan[] }) {
  const [pilih, setPilih] = useState(0);
  if (briefs.length === 0) {
    return (
      <p className="text-muted-foreground">
        Belum ada Briefing Mingguan. Job <code>weekly-briefing</code> menyusunnya tiap Senin 07:00 (flag{" "}
        <code>WEEKLY_BRIEFING_ENABLED</code>).
      </p>
    );
  }
  const b = briefs[Math.min(pilih, briefs.length - 1)];

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
        <CardHeader className="space-y-0 pb-2">
          <CardTitle className="text-base">
            Briefing Mingguan W{b.iso_week} — {b.periode}
          </CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            Dasar: {b.n_rekap} rekap + {b.n_resume} resume {fmtTgl(b.dasar_dari)}–{fmtTgl(b.dasar_sampai)} · disusun{" "}
            {fmtWaktu(b.generated_at)} · {b.model_used ?? "tanpa LLM"} ·{" "}
            {b.wa_terkirim
              ? `Link WA terkirim ${b.wa_sent_at ? fmtWaktu(b.wa_sent_at) : ""}`
              : b.wa_error
                ? `WA tidak terkirim: ${b.wa_error}`
                : "WA belum dikirim"}
          </p>
        </CardHeader>
        <CardContent>
          {!b.narasi_ok && (
            <p className="bg-destructive/10 text-destructive mb-3 rounded-md px-3 py-2 text-sm">
              Briefing tidak berhasil disusun AI minggu ini — lihat catatan di bawah.
            </p>
          )}
          <pre className="bg-muted/50 max-h-[70vh] overflow-auto rounded-md p-3 text-sm whitespace-pre-wrap">{b.content}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
