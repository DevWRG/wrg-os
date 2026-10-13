import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { rp, tgl, type Briefing } from "./types";

function Baris({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_1fr]">
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide sm:pt-0.5">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// F131 — briefing pra-kunjungan: fakta saja (tanpa LLM), sama dengan balasan WA #BRIEF.
export function BriefingPanel({ b }: { b: Briefing }) {
  const p = b.pembelian;
  const l = b.piutang.lewat_tempo;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Briefing kunjungan</CardTitle>
        <p className="text-muted-foreground text-xs">Ringkasan fakta sebelum berkunjung — sama dengan balasan WhatsApp <code>#BRIEF</code>.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Baris label="Pembelian">
          {p.terakhir
            ? <>Terakhir <b>{tgl(p.terakhir, true)}</b> ({p.hari_sejak} hari lalu) · 12 bln {rp(p.netto_12bln)} ({p.faktur_12bln} faktur){p.brand_teratas.length ? <> · {p.brand_teratas.join(", ")}</> : null}</>
            : <span className="text-muted-foreground">Belum pernah ada faktur — calon pelanggan.</span>}
        </Baris>
        <Baris label="Piutang">
          {b.piutang.sisa > 0
            ? <>{rp(b.piutang.sisa)}{l.faktur
                ? <> · <span className="font-medium text-rose-700 dark:text-rose-400">lewat jatuh tempo {l.faktur} faktur {rp(l.nilai)} (terlama {l.terlama_hari} hari)</span></>
                : <span className="text-muted-foreground"> · belum ada yang lewat jatuh tempo</span>}</>
            : <span className="text-muted-foreground">Tidak ada.</span>}
        </Baris>
        <Baris label="Kecepatan bayar">
          {b.bayar.faktur > 0
            ? <>Median <b>{b.bayar.median_hari} hari</b> setelah faktur ({b.bayar.faktur} faktur lunas, 12 bln)
                {b.bayar.tepat_pct != null && <> · {b.bayar.tepat_pct}% tepat waktu</>}
                {b.bayar.rata_telat_hari ? <span className="text-muted-foreground"> · yang telat rata-rata {b.bayar.rata_telat_hari} hari</span> : null}
                {b.bayar.tren && <span className="text-muted-foreground"> · {b.bayar.tren} dari tahun sebelumnya</span>}</>
            : <span className="text-muted-foreground">Belum ada pelunasan dalam 12 bulan.</span>}
        </Baris>
        {b.kso.aktif > 0 && (
          <Baris label="KSO aktif">
            {b.kso.aktif} alat{b.kso.alat.length ? ` (${b.kso.alat.join(", ")})` : ""}{b.kso.mou_terdekat ? ` · MoU terdekat habis ${tgl(b.kso.mou_terdekat, true)}` : ""}
          </Baris>
        )}
        {b.deal.length > 0 && (
          <Baris label="Deal terbuka">
            <ul className="space-y-0.5">
              {b.deal.map((d, i) => (
                <li key={i}><b>{d.stage}</b> — {[d.brand, d.produk].filter(Boolean).join(" ") || "—"}{d.nilai ? ` ${rp(d.nilai)}` : ""}
                  {d.hari_di_tahap != null && <span className="text-muted-foreground"> · {d.hari_di_tahap} hari di tahap ini</span>}{d.am && <span className="text-muted-foreground"> · {d.am}</span>}</li>
              ))}
            </ul>
          </Baris>
        )}
        {b.demo.length > 0 && (
          <Baris label="Demo / trial">
            {b.demo.map((d) => `${d.kode} ${d.alat}${d.tanggal_selesai ? ` s/d ${tgl(d.tanggal_selesai)}` : ""}`).join(" · ")} — belum ada hasil
          </Baris>
        )}
        {/* Kunjungan yang ada sudah tampil lengkap di Timeline (filter Aktivitas AM)
            dari sumber yang sama (activity_log.account_id) — di sini hanya
            ditampilkan bila BELUM ada sama sekali, sebagai fakta pra-kunjungan.
            Telepon & catatan (#CALL/#NOTE) tak ditampilkan di sini sama sekali —
            Timeline filter "Telepon & catatan" membaca interaction_log yang sama.
            Balasan WA #BRIEF tetap memuat keduanya. */}
        {b.kunjungan.length === 0 && (
          <Baris label="Kunjungan terakhir">
            <span className="text-muted-foreground">Belum ada laporan kunjungan tercatat.</span>
          </Baris>
        )}
        <Baris label="Kompetitor (12 bln)">
          {b.kompetitor.length ? (
            <ul className="space-y-0.5">
              {b.kompetitor.map((k, i) => (
                <li key={i}><span className="text-muted-foreground tabular-nums">{tgl(k.tanggal)}</span> · <b>{k.vendor}</b>{k.produk ? ` ${k.produk}` : ""}{k.harga_text ? ` (${k.harga_text})` : ""}
                  {k.konteks && <span className="text-muted-foreground"> — {k.konteks}</span>}</li>
              ))}
            </ul>
          ) : <span className="text-muted-foreground">Tidak ada sebutan kompetitor di laporan faskes ini.</span>}
          {b.dominan_wilayah.length > 0 && (
            <div className="mt-1 text-xs">Dominan di wilayah (dikonfirmasi HoD): {b.dominan_wilayah.map((d) => `${d.kategori} — ${d.vendor}`).join("; ")}</div>
          )}
        </Baris>
      </CardContent>
    </Card>
  );
}
