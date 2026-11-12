"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TabKso } from "@/lib/kso-komite-access";
import { cn } from "@/lib/utils";

import { persenFee } from "@/lib/kso-komite-daftar";

import { BadgeAlatBaru, BadgeFaskesBaru, LabelStatus } from "./label-status";
import { BagianKurang, BagianLampiran } from "./lampiran-kurang";
import { BagianSph, FormPenawaranSph } from "./sph-kso";
import { GERBANG_CLS, GERBANG_KATA, GERBANG_SOLID, LABEL_PERLINDUNGAN, LABEL_ZONA, STATUS_LABEL, ZONA_CLS, kirim, persen, rp, rpJt, waktu, type Detail } from "./types";

// Detail satu rencana + form aksi sesuai tab. Form hanya muncul bila tab boleh "edit" DAN
// status rencana cocok; API tetap memeriksa keduanya (tombol tersembunyi ≠ endpoint tertutup).
// Tata letak mengikuti dashboard Komite KSO Direktur: kepala · angka kunci · peringatan ·
// tujuh gerbang · aksi · riwayat. Layar lebar = panel kanan; layar sempit = dialog.
type PropsDetail = { tab: TabKso; id: number | null; bolehAksi: boolean; onBerubah: () => void; onTutup?: () => void };

function useDetail({ tab, id, onBerubah, onTutup }: PropsDetail) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const url = `/api/kso-komite/${tab}/rencana/${id}`;
  // Pemuatan awal. Komponen di-remount per rencana (key di pemanggil), jadi state awal sudah bersih.
  useEffect(() => {
    if (!id) return;
    let batal = false;
    kirim<Detail>(url).then((x) => { if (!batal) setD(x); }).catch((e: Error) => { if (!batal) setErr(e.message); });
    return () => { batal = true; };
  }, [id, url]);
  const jalankan = async (aksi: string, body: Record<string, unknown>) => {
    await kirim(`/api/kso-komite/rencana/${id}/${aksi}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    // sesudah aksi, rencana bisa keluar dari akses tab ini (mis. pindah status) → tampilkan apa adanya
    try { setD(await kirim<Detail>(url)); } catch { setD(null); onTutup?.(); }
    onBerubah();
  };
  return { d, err, jalankan };
}

export function RencanaPanel(p: PropsDetail) {
  const { d, err, jalankan } = useDetail(p);
  return (
    <div className="bg-card max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border p-5 shadow-[var(--shadow-card)]">
      {!p.id ? <p className="text-muted-foreground py-10 text-center text-sm">Pilih usulan di sebelah kiri untuk melihat rinciannya.</p>
        : err ? <p className="text-destructive text-sm">{err}</p>
        : !d ? <p className="text-muted-foreground text-sm">Memuat…</p>
        : <IsiDetail tab={p.tab} d={d} bolehAksi={p.bolehAksi} jalankan={jalankan} />}
    </div>
  );
}

export function RencanaDialog({ onClose, ...p }: Omit<PropsDetail, "onTutup"> & { onClose: () => void }) {
  const { d, err, jalankan } = useDetail({ ...p, onTutup: onClose });
  return (
    <Dialog open={!!p.id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="sr-only">
          <DialogTitle>{d ? d.rencana.faskes_nama : "Memuat…"}</DialogTitle>
          <DialogDescription>Rincian rencana KSO</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {err ? <p className="text-destructive text-sm">{err}</p>
            : !d ? <p className="text-muted-foreground text-sm">Memuat…</p>
            : <IsiDetail tab={p.tab} d={d} bolehAksi={p.bolehAksi} jalankan={jalankan} ruangTutup />}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function IsiDetail({ tab, d, bolehAksi, jalankan, ruangTutup = false }: { tab: TabKso; d: Detail; bolehAksi: boolean; jalankan: Jalankan; ruangTutup?: boolean }) {
  const r = d.rencana;
  return (
    <div className="space-y-5">
      <header>
        <div className={cn("flex items-start justify-between gap-3", ruangTutup && "pr-8")}>
          <span className="text-muted-foreground font-mono text-xs">{r.nomor ?? `D${r.id} · draft`}</span>
          <LabelStatus status={r.status} />
        </div>
        <h2 className="mt-1 text-lg font-bold leading-tight">{r.faskes_nama}{r.faskes_baru && <BadgeFaskesBaru kota={r.faskes_kota} className="ml-2 align-middle" />}</h2>
        <p className="text-muted-foreground text-sm">{r.jumlah} × {r.alat_nama}{r.alat_baru && <BadgeAlatBaru className="ml-1.5 align-middle" />} · AM {r.am_nama}{r.cabang ? ` · ${r.cabang}` : ""}</p>
      </header>
      {bolehAksi && r.faskes_baru && d.faskes_saran_master && <FormTautkanFaskes d={d} jalankan={jalankan} />}
      <AngkaKunci d={d} />
      <Peringatan d={d} />
      <BagianKurang d={d} />
      {bolehAksi && <FormAksi tab={tab} d={d} jalankan={jalankan} />}
      <Gerbang d={d} />
      <BagianLampiran tab={tab} d={d} />
      <HargaZona d={d} />
      <Isian d={d} />
      {d.pendapat.length > 0 && (
        <Blok judul="HOD">
          {d.pendapat.map((p) => (
            <li key={`${p.hod_id}-${p.jenis}`}>
              <b>{p.hod_nama ?? p.hod_id}</b> · {p.jenis === "putusan" ? `putusan: ${p.keputusan}${p.dianggap_setuju ? " (lewat batas, dianggap setuju)" : ""}` : "pendapat"}
              {p.catatan && <> — “{p.catatan}”</>} <span className="text-muted-foreground text-xs">{waktu(p.at)}</span>
            </li>
          ))}
        </Blok>
      )}
      {d.usulan.length > 0 && (
        <Blok judul="Usulan komite ke Direksi">
          {d.usulan.map((u, i) => (
            <li key={i}><b>{STATUS_LABEL[u.usulan] ?? u.usulan}</b>{u.alasan && ` — ${u.alasan}`}
              {u.syarat?.length ? <> · syarat: {u.syarat.map((x) => x.isi).join("; ")}</> : null}
              {u.data_kurang && ` · kurang: ${u.data_kurang} (oleh ${u.pemilik}, kembali ${u.tanggal_kembali})`}
              <span className="text-muted-foreground text-xs"> {waktu(u.at)}</span></li>
          ))}
        </Blok>
      )}
      {d.putusan && <Blok judul="Putusan Direksi"><li><b>{d.putusan.putusan}</b>{d.putusan.catatan && ` — ${d.putusan.catatan}`} <span className="text-muted-foreground text-xs">{waktu(d.putusan.at)}</span></li></Blok>}
      {d.mandat && <Mandat d={d} />}
      <BagianSph tab={tab} d={d} />
      {r.harga_deal != null && (
        <Blok judul="PKS (dicocokkan Sekretariat)">
          <li>Harga {rp(Number(r.harga_deal))}/test · tenor {String(r.pks_tenor_bulan ?? "—")} bln · volume min {String(r.pks_volume_minimum ?? "—")} test/bln</li>
          {Array.isArray(r.pks_klausul) && <li>Klausul: {(r.pks_klausul as string[]).map((k) => labelKlausul(d, k)).join(", ") || "—"}</li>}
        </Blok>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold">Riwayat status</h3>
        <ol className="flex flex-wrap items-center gap-1 text-xs">
          {d.riwayat.map((h, i) => (
            <li key={i} className="flex items-center gap-1" title={`${waktu(h.at)} · ${h.oleh_nama ?? h.oleh ?? "—"}${h.oleh_peran ? ` (${h.oleh_peran})` : ""}`}>
              {i > 0 && <span className="text-muted-foreground" aria-hidden>→</span>}
              <span className="rounded-md border px-1.5 py-0.5">{STATUS_LABEL[h.ke] ?? h.ke}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

const labelKlausul = (d: Detail, k: string) => LABEL_PERLINDUNGAN[k] ?? d.klausul_khusus.find((x) => x.kode === k)?.label ?? k;

function Blok({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">{judul}</h3>
      <ul className="space-y-1 text-sm">{children}</ul>
    </section>
  );
}

/**
 * Kisi angka kunci (CAPEX · VOLUME · HARGA/TEST · FEE · HARGA BERSIH · TENOR · HARI KERJA · GPM · ZONA). Respons yang
 * disaring (d.tanpa_angka — AM, HOD Sales, Admin Sales, Teknik) tidak membawa capex/harga bersih/GPM → ubinnya tak tampil.
 */
function AngkaKunci({ d }: { d: Detail }) {
  const r = d.rencana, g = d.angka_gpm;
  const isi: ([string, React.ReactNode] | false)[] = [
    r.capex != null && ["Capex", rpJt(r.capex)],
    ["Volume", r.volume_estimasi != null ? `${r.volume_estimasi.toLocaleString("id-ID")} test/bln` : "—"],
    ["Harga/test", rp(r.harga_per_test)],
    // 302: fee ke RS/perantara; GPM di bawah dihitung dari harga bersih fee
    ["Fee", r.fee_persen === undefined ? "—" : r.fee_persen == null ? <span className="text-amber-700 dark:text-amber-400">belum diisi</span> : persenFee(r.fee_persen)],
    !d.tanpa_angka && ["Harga bersih", rp(r.harga_bersih ?? (r.harga_per_test == null ? null : r.harga_per_test * (1 - (r.fee_persen ?? 0) / 100)))],
    ["Tenor", r.tenor_bulan != null ? `${r.tenor_bulan} bln` : "—"],
    ["Hari kerja", r.hari_kerja != null ? `${r.hari_kerja} hari/bln` : r.hari_kerja_default != null ? `${r.hari_kerja_default} hari/bln (default)` : "—"],
    !d.tanpa_angka && ["GPM deal", g?.hd ? "Hemodialisa" : <>{persen(g?.gpm ?? r.gpm_deal)}{r.fee_persen ? <span className="text-muted-foreground text-xs font-normal"> bersih fee</span> : null}</>],
    ["Zona", r.zona ? <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", ZONA_CLS[r.zona])}>{LABEL_ZONA[r.zona]}</span> : "—"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y py-3 sm:grid-cols-3">
      {isi.filter((x) => x !== false).map(([l, v]) => (
        <div key={l}>
          <dt className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">{l}</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Hal yang perlu diperhatikan — hanya yang ada, satu kalimat per kotak. */
function Peringatan({ d }: { d: Detail }) {
  const r = d.rencana, g = d.angka_gpm;
  const merah: string[] = [], kuning: string[] = [];
  if (!r.volume_sumber) merah.push("Sumber angka volume kosong.");
  if (r.volume_terverifikasi === false) merah.push(`Bukti volume ditolak Sekretaris${r.volume_verifikasi_catatan ? `: ${r.volume_verifikasi_catatan}` : "."}`);
  if (g && !g.hd && g.gpm == null && g.catatan) kuning.push(`GPM belum bisa dihitung: ${g.catatan}.`);
  if (r.zona_dasar && r.zona && r.zona_dasar !== r.zona) kuning.push(`Dari GPM masuk ${LABEL_ZONA[r.zona_dasar]}, naik ke ${LABEL_ZONA[r.zona]} karena gerbang/aturan.`);
  if (r.alasan_forum) kuning.push(`Ke forum karena: ${r.alasan_forum}`);
  if (merah.length + kuning.length === 0) return null;
  return (
    <div className="space-y-2">
      {merah.map((t) => <p key={t} className="rounded-md border-l-4 border-red-600 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-300">{t}</p>)}
      {kuning.map((t) => <p key={t} className="rounded-md border-l-4 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">{t}</p>)}
    </div>
  );
}

function Isian({ d }: { d: Detail }) {
  const r = d.rencana;
  return (
    <Blok judul="Isian AM">
      {/* kalimat AM apa adanya, dalam tanda kutip — bukan kategori turunan */}
      <li><span className="text-muted-foreground">Bukti volume:</span> {r.volume_sumber ? <i>“{r.volume_sumber}”</i> : "—"}
        {r.volume_terverifikasi === true && <span className="text-emerald-700 dark:text-emerald-400"> · diverifikasi Sekretaris</span>}</li>
      {r.kompetitor_alat && <li><span className="text-muted-foreground">Kompetitor:</span> {r.kompetitor_alat}</li>}
      {r.harga_pesaing != null && <li><span className="text-muted-foreground">Harga pesaing:</span> {rp(r.harga_pesaing)}/test</li>}
      {r.klausul_ada != null && <li><span className="text-muted-foreground">Klausul dari RS:</span> {r.klausul_ada ? <>ADA{r.klausul_detail ? <> — <i>“{r.klausul_detail}”</i></> : " (isinya belum ditulis)"}</> : "TIDAK"}</li>}
      {r.alasan_strategis && <li><span className="text-muted-foreground">Alasan strategis:</span> <i>“{r.alasan_strategis}”</i></li>}
      <li><span className="text-muted-foreground">Klausul khusus:</span> {d.klausul.length ? d.klausul.map((k) => k.label).join(", ") : "tidak ada"}</li>
      {d.pendukung.map((p, i) => <li key={i}><span className="text-muted-foreground">Pendukung:</span> {p.nama} ({p.tipe.replace(/_/g, " ")}){p.kontak_terakhir_tanggal ? ` · kontak ${p.kontak_terakhir_tanggal}` : ""}</li>)}
      {r.payback_bulan ? <li><span className="text-muted-foreground">Payback:</span> ±{r.payback_bulan} bln</li> : null}
    </Blok>
  );
}

const bulat100 = (x: number | null | undefined) => (x == null ? null : Math.ceil(x / 100) * 100);

function Ubin({ label, nilai, ket }: { label: string; nilai: string; ket?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">{label}</div>
      <div className="font-semibold tabular-nums">{nilai}</div>
      {ket && <div className="text-muted-foreground text-xs">{ket}</div>}
    </div>
  );
}

/** F170 v2 (Pedoman Komite KSO Forum v01): harga minimum per zona di volume usulan. */
function HargaZona({ d }: { d: Detail }) {
  const r = d.rencana, g = d.angka_gpm;
  if (!g || g.hd || g.harga_forum == null) return null;
  const v = g.volume_min_forum, vol = r.volume_estimasi ?? 0;
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">Harga minimum per zona <span className="text-muted-foreground font-normal">· di {vol.toLocaleString("id-ID")} test/bln</span></h3>
      <div className="grid grid-cols-3 gap-2">
        <Ubin label="AM ≥55%" nilai={rp(bulat100(g.harga_am))} />
        <Ubin label="2 HOD ≥50%" nilai={rp(bulat100(g.harga_hod))} />
        <Ubin label="Forum ≥45%" nilai={rp(bulat100(g.harga_forum))} />
      </div>
      {g.gpm != null && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          {v == null ? `Di ${rp(r.harga_per_test)} zona Forum tidak tercapai di volume berapa pun.`
            : vol > 0 && v > vol * 10 ? `Di ${rp(r.harga_per_test)} zona Forum baru tercapai di atas 10× volume usulan — tidak realistis.`
            : `Volume minimum zona Forum di ${rp(r.harga_per_test)}: ${Math.ceil(v).toLocaleString("id-ID")} test/bln.`}
        </p>
      )}
    </section>
  );
}

function Gerbang({ d }: { d: Detail }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">Tujuh gerbang</h3>
      <ul className="space-y-2">
        {d.gerbang.map((g) => (
          <li key={g.no} className="flex items-start gap-2.5 text-sm">
            <span className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-xs font-bold", GERBANG_SOLID[g.status])}>{g.no}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{g.nama}</span>
              {g.nilai && <span className="text-muted-foreground block text-xs">{g.nilai}</span>}
            </span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold", GERBANG_CLS[g.status])}>{GERBANG_KATA[g.status] ?? g.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Mandat({ d }: { d: Detail }) {
  const m = d.mandat!;
  // respons disaring: harga mandat tidak dikirim (Admin Sales tetap menerima harga pembuka = harga di penawaran)
  const ubin = d.tanpa_angka
    ? (m.harga_pembuka != null ? [<Ubin key="p" label="Harga penawaran (pembuka)" nilai={rp(m.harga_pembuka)} />] : [])
    : [<Ubin key="p" label="Pembuka" nilai={m.harga_pembuka != null ? rp(m.harga_pembuka) : "—"} ket="GPM ≥ 55%, ≥ usulan AM" />,
       <Ubin key="t" label="Target" nilai={rp(m.harga_target)} ket="GPM 50%" />,
       <Ubin key="b" label="Batas bawah" nilai={rp(m.harga_lantai)} ket="GPM 45%" />];
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">{d.tanpa_angka ? "Mandat" : "Batas negosiasi AM"} <span className="text-muted-foreground font-normal">· mandat {m.sumber}, berlaku s/d {m.berlaku_sampai}</span></h3>
      {ubin.length > 0 && <div className={cn("grid gap-2", ubin.length === 1 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-3")}>{ubin}</div>}
      <p className="text-muted-foreground mt-1.5 text-xs">
        {m.capex_maks != null ? `Capex maks ${rpJt(m.capex_maks)} · ` : ""}tenor maks {m.tenor_maks_bulan} bln · volume min {m.volume_minimum ?? "—"} test/bln
        {m.volume_terbukti ? ` · dihitung di ${m.volume_terbukti} test/bln` : ""}
        {m.klausul_dilarang.length > 0 && ` · klausul dilarang: ${m.klausul_dilarang.map((k) => labelKlausul(d, k)).join(", ")}`}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- form aksi per tab

type Jalankan = (aksi: string, body: Record<string, unknown>) => Promise<void>;

function FormAksi({ tab, d, jalankan }: { tab: TabKso; d: Detail; jalankan: Jalankan }) {
  const s = d.rencana.status;
  const hariIni = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  const mandatLewat = !!d.mandat && d.mandat.berlaku_sampai < hariIni;
  if (tab === "hod" && s === "JALUR_CEPAT") return <FormPutusHod jalankan={jalankan} />;
  if (tab === "hod" && (s === "JALUR_FORUM" || s === "DIAGENDAKAN")) return <FormTeks judul="Beri pendapat" nada="amber" label="Pendapat untuk komite (bukan putusan)" aksi="pendapat-hod" kunci="catatan" jalankan={jalankan} />;
  if (tab === "agenda" && s === "DIAGENDAKAN") return <FormUsulan jalankan={jalankan} />;
  if (tab === "agenda" && mandatLewat && (s === "DIPUTUS_AM" || s === "DIPUTUS_HOD" || s === "MANDAT_TERBIT"))
    return <FormTeks judul="Tarik kembali ke forum" nada="amber" label="Alasan" aksi="tarik" kunci="alasan" jalankan={jalankan} />;
  if (tab === "direksi" && ["DIREKOMENDASIKAN", "DIREKOMENDASIKAN_BERSYARAT", "TIDAK_DIREKOMENDASIKAN"].includes(s)) return <FormDireksi d={d} jalankan={jalankan} />;
  // Sekretariat (atau Admin Sales cadangan): penawaran terbit dengan harga pembuka mandat
  // F170 v2: bukti volume zona Forum & Direktur diverifikasi Sekretaris sebelum putusan
  if (tab === "sekretariat" && ["DIAJUKAN", "JALUR_FORUM", "DIAGENDAKAN"].includes(s)
      && (d.rencana.zona === "forum" || d.rencana.zona === "direktur") && d.rencana.volume_terverifikasi == null)
    return <FormVerifikasi jalankan={jalankan} />;
  if ((tab === "sekretariat" || tab === "penawaran") && (s === "DIPUTUS_AM" || s === "DIPUTUS_HOD" || s === "MANDAT_TERBIT") && !mandatLewat)
    return (
      <div className="space-y-3">
        <FormPenawaranSph d={d}
          label={`Harga per test (Rp) — ${[d.mandat?.harga_pembuka != null && `pembuka ${rp(d.mandat.harga_pembuka)}`,
            d.mandat?.harga_target !== undefined && `target ${rp(d.mandat.harga_target)}`,
            d.mandat?.harga_lantai !== undefined && `batas bawah ${rp(d.mandat.harga_lantai)}`].filter(Boolean).join(", ") || "sesuai mandat"}`}
          awal={d.mandat?.harga_pembuka ?? d.mandat?.harga_target ?? d.mandat?.harga_lantai ?? null} jalankan={jalankan} />
        <FormTeks judul="Catat kalah" nada="amber" label="Alasan kalah" aksi="kalah" kunci="alasan" jalankan={jalankan} />
      </div>
    );
  // Sekretariat: negosiasi berjalan → cocokkan naskah PKS dengan putusan sebelum tanda tangan
  if (tab === "sekretariat" && s === "PENAWARAN_TERBIT")
    return (
      <div className="space-y-3">
        <FormPks d={d} jalankan={jalankan} />
        <FormTeks judul="Catat kalah" nada="amber" label="Alasan kalah (wajib, dibawa ke tinjauan portofolio)" aksi="kalah" kunci="alasan" jalankan={jalankan} />
      </div>
    );
  if (tab === "teknik" && s === "PKS_TTD") return <FormSerahTerima jalankan={jalankan} />;
  return null;
}

function Kotak({ judul, children }: { judul: string; nada?: "sky" | "amber"; children: React.ReactNode }) {
  return (
    <div className="border-primary-dark/40 space-y-3 rounded-lg border bg-white p-4 dark:bg-card">
      <h3 className="font-semibold">{judul}</h3>
      {children}
    </div>
  );
}

function useKirim(jalankan: Jalankan) {
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (aksi: string, body: Record<string, unknown>) => {
    setSibuk(true); setErr(null);
    try { await jalankan(aksi, body); } catch (e) { setErr((e as Error).message); } finally { setSibuk(false); }
  };
  return { sibuk, err, go };
}

function Pilihan<T extends string>({ nilai, set, opsi }: { nilai: T | null; set: (v: T) => void; opsi: [T, string][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {opsi.map(([v, l]) => (
        <Button key={v} type="button" size="sm" variant={nilai === v ? "default" : "soft"} aria-pressed={nilai === v} onClick={() => set(v)}>{l}</Button>
      ))}
    </div>
  );
}

/**
 * 303: faskes baru (calon customer) → akun master begitu customer terdaftar di Accurate/CRM (masuk referensi KSO sesudah
 * penyegaran malam). Pilihan = akun master paling mirip; ID akun boleh diketik bila tak ada di pilihan.
 */
function FormTautkanFaskes({ d, jalankan }: { d: Detail; jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const saran = d.faskes_saran_master ?? [];
  const [akun, setAkun] = useState<string>(saran[0]?.id ?? "");
  return (
    <Kotak judul="Tautkan ke akun master">
      <p className="text-muted-foreground text-sm">Faskes ini dicatat AM sebagai calon customer. Begitu akunnya ada di Accurate/CRM, tautkan —
        semua usulan untuk faskes ini pindah ke akun master dan gerbang draft dihitung ulang.</p>
      {saran.length > 0 && (
        <div className="space-y-1.5" role="radiogroup" aria-label="Akun master yang mirip">
          {saran.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="radio" name="akun-master" value={s.id} checked={akun === s.id} onChange={() => setAkun(s.id)} />
              <span>{s.nama}{s.cabang ? <span className="text-muted-foreground"> — {s.cabang}</span> : null}
                <span className="text-muted-foreground font-mono text-xs"> · {s.id}</span></span>
            </label>
          ))}
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="akun-master-id">ID akun master</Label>
        <Input id="akun-master-id" value={akun} onChange={(e) => setAkun(e.target.value)} placeholder="ID akun (Accounts)" className="max-w-[16rem] font-mono" />
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!akun.trim() || sibuk} onClick={() => go("tautkan-faskes", { akun: akun.trim() })}>Tautkan</Button>
    </Kotak>
  );
}

function FormPutusHod({ jalankan }: { jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [k, setK] = useState<"setuju" | "tolak" | "naikkan" | null>(null);
  const [c, setC] = useState("");
  return (
    <Kotak judul="Putuskan (jalur cepat)">
      <Pilihan nilai={k} set={setK} opsi={[["setuju", "Setuju"], ["tolak", "Tolak"], ["naikkan", "Naikkan ke forum"]]} />
      <Textarea placeholder="Catatan (opsional)" value={c} onChange={(e) => setC(e.target.value)} />
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!k || sibuk} onClick={() => go("putus-hod", { keputusan: k, catatan: c })}>Simpan putusan</Button>
    </Kotak>
  );
}

function FormTeks({ judul, nada, label, aksi, kunci, jalankan }: { judul: string; nada?: "sky" | "amber"; label: string; aksi: string; kunci: string; jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [v, setV] = useState("");
  return (
    <Kotak judul={judul} nada={nada}>
      <Label>{label}</Label>
      <Textarea value={v} onChange={(e) => setV(e.target.value)} />
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!v.trim() || sibuk} onClick={() => go(aksi, { [kunci]: v })}>Simpan</Button>
    </Kotak>
  );
}

const angka = (s: string) => (s.trim() === "" ? null : Number(s.replace(/\./g, "").replace(",", ".")));

function FormUsulan({ jalankan }: { jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [u, setU] = useState<"DIREKOMENDASIKAN" | "DIREKOMENDASIKAN_BERSYARAT" | "DITAHAN" | "TIDAK_DIREKOMENDASIKAN" | null>(null);
  const [f, setF] = useState({ syarat: "", data_kurang: "", pemilik: "", tanggal_kembali: "", alasan: "" });
  const isi = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Kotak judul="Rumuskan usulan ke Direksi">
      <Pilihan nilai={u} set={setU} opsi={[["DIREKOMENDASIKAN", "Direkomendasikan"], ["DIREKOMENDASIKAN_BERSYARAT", "Bersyarat"], ["DITAHAN", "Ditahan"], ["TIDAK_DIREKOMENDASIKAN", "Tidak direkomendasikan"]]} />
      {u === "DIREKOMENDASIKAN_BERSYARAT" && <><Label>Syarat</Label><Textarea value={f.syarat} onChange={isi("syarat")} /></>}
      {u === "DITAHAN" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div><Label>Data yang kurang</Label><Input value={f.data_kurang} onChange={isi("data_kurang")} /></div>
          <div><Label>Siapa melengkapi</Label><Input value={f.pemilik} onChange={isi("pemilik")} /></div>
          <div><Label>Kembali ke forum</Label><Input type="date" value={f.tanggal_kembali} onChange={isi("tanggal_kembali")} /></div>
        </div>
      )}
      {(u === "TIDAK_DIREKOMENDASIKAN" || u === "DIREKOMENDASIKAN") && <><Label>Alasan / catatan</Label><Textarea value={f.alasan} onChange={isi("alasan")} /></>}
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!u || sibuk} onClick={() => go("usulkan", { usulan: u, ...f })}>Simpan usulan</Button>
    </Kotak>
  );
}

/** Sekretaris: verifikasi bukti volume (Pedoman — LIS/SIMRS, pembelian reagen RS, surat RS; lisan tidak diterima). */
function FormVerifikasi({ jalankan }: { jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [sah, setSah] = useState<"sah" | "tolak" | null>(null);
  const [c, setC] = useState("");
  return (
    <Kotak judul="Verifikasi bukti volume" nada="amber">
      <p className="text-muted-foreground text-xs">Minta berkas buktinya ke AM, cocokkan dengan volume yang diusulkan. Ditolak = gerbang 2 merah.</p>
      <Pilihan nilai={sah} set={setSah} opsi={[["sah", "Bukti sah"], ["tolak", "Tolak bukti"]]} />
      {sah && <><Label>{sah === "tolak" ? "Alasan penolakan (wajib)" : "Catatan (opsional)"}</Label><Textarea value={c} onChange={(e) => setC(e.target.value)} /></>}
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button className="w-full sm:w-auto" disabled={!sah || sibuk} onClick={() => go("verifikasi-volume", { sah: sah === "sah", catatan: c })}>Simpan verifikasi</Button>
    </Kotak>
  );
}

// MAX(@GPM 55%, usulan AM) — sama dengan default kso.putus_direksi (migrasi 272)
function pembukaAwal(at55: number | null | undefined, usulan: number | null | undefined) {
  if (at55 == null) return usulan ?? null;
  return usulan != null && usulan > at55 ? usulan : at55;
}

function FormDireksi({ d, jalankan }: { d: Detail; jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [p, setP] = useState<"SETUJU" | "BERSYARAT" | "TOLAK" | null>(null);
  const r = d.rencana, g = d.angka_gpm;
  // F170 v2: nilai awal = tiga harga Pedoman di volume terbukti (pembuka @55%, target @50%, batas bawah @45%); Direksi boleh mengubah.
  // 272: pembuka awal tak pernah di bawah harga usulan AM.
  const awal = (x: number | null | undefined) => (x == null ? "" : String(Math.round(x)));
  const [f, setF] = useState({
    pembuka: awal(pembukaAwal(bulat100(g?.harga_am), r.harga_per_test)), lantai: awal(bulat100(g?.harga_forum)), target: awal(bulat100(g?.harga_hod)), tenor_maks: awal(r.tenor_bulan),
    capex_maks: awal(r.capex), volume_min: r.volume_estimasi ? awal(Math.floor(r.volume_estimasi * 0.8)) : "", catatan: "",
  });
  const isi = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const kolom: [keyof typeof f, string, string][] = [
    ["pembuka", "Harga pembuka penawaran (Rp/test, GPM ≥ 55%, ≥ usulan AM)", r.harga_per_test ? `usulan AM ${rp(r.harga_per_test)}` : ""],
    ["target", "Harga target (Rp/test, GPM 50%)", ""],
    ["lantai", "Batas bawah AM — lantai (Rp/test, GPM 45%)", ""],
    ["tenor_maks", "Tenor maks (bulan)", r.tenor_bulan ? `diminta ${r.tenor_bulan}` : ""],
    ["capex_maks", "Capex maks (Rp)", `capex usulan ${rpJt(r.capex)}`],
    ["volume_min", "Volume minimum (test/bln)", r.volume_estimasi ? `estimasi ${r.volume_estimasi}` : ""],
  ];
  return (
    <Kotak judul="Putusan Direksi">
      <Pilihan nilai={p} set={setP} opsi={[["SETUJU", "Setuju + mandat"], ["BERSYARAT", "Bersyarat"], ["TOLAK", "Tolak"]]} />
      {p && p !== "TOLAK" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {kolom.map(([k, l, ph]) => (
            <div key={k}><Label>{l}</Label><Input inputMode="numeric" placeholder={ph} value={f[k]} onChange={isi(k)} /></div>
          ))}
        </div>
      )}
      {p && <><Label>{p === "TOLAK" ? "Alasan penolakan" : p === "BERSYARAT" ? "Syarat" : "Catatan (opsional)"}</Label><Textarea value={f.catatan} onChange={isi("catatan")} /></>}
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button className="w-full sm:w-auto" disabled={!p || sibuk} onClick={() => go("putus-direksi", {
        putusan: p, catatan: f.catatan, pembuka: angka(f.pembuka), lantai: angka(f.lantai), target: angka(f.target), tenor_maks: angka(f.tenor_maks),
        capex_maks: angka(f.capex_maks), volume_min: angka(f.volume_min),
      })}>Simpan putusan</Button>
    </Kotak>
  );
}

// Pencocokan PKS: isi dari naskah PKS, bukan dari mandat — sistem yang membandingkan dengan putusan
// (harga ≥ lantai, tenor ≤ maks, volume ≥ minimum, perlindungan wajib ada, tanpa klausul dilarang /
// di luar usulan). Tidak cocok = ditolak dengan rinciannya; tidak ada PKS di luar keputusan.
function FormPks({ d, jalankan }: { d: Detail; jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [f, setF] = useState({ harga: "", tenor: "", volume: "" });
  const [klausul, setKlausul] = useState<string[]>([]);
  const isi = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ubah = (k: string, ya: boolean) => setKlausul((x) => (ya ? [...new Set([...x, k])] : x.filter((y) => y !== k)));
  const m = d.mandat;
  const wajib = m?.klausul_wajib ?? Object.keys(LABEL_PERLINDUNGAN);
  const centang = (k: string, label: string, catatan?: string) => (
    <label key={k} className="flex items-start gap-2 text-sm">
      <Checkbox className="mt-0.5" checked={klausul.includes(k)} onCheckedChange={(v) => ubah(k, v === true)} />
      <span>{label}{catatan && <span className="text-muted-foreground text-xs"> — {catatan}</span>}</span>
    </label>
  );
  return (
    <Kotak judul="Cocokkan & catat PKS">
      <p className="text-muted-foreground text-xs">Isi persis seperti naskah PKS. Putusan: lantai {rp(m?.harga_lantai)}/test · tenor maks {m?.tenor_maks_bulan ?? "—"} bln · volume min {m?.volume_minimum ?? "—"} test/bln.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div><Label>Harga per test di PKS (Rp)</Label><Input inputMode="numeric" value={f.harga} onChange={isi("harga")} /></div>
        <div><Label>Tenor di PKS (bulan)</Label><Input inputMode="numeric" value={f.tenor} onChange={isi("tenor")} /></div>
        <div><Label>Volume minimum di PKS (test/bln)</Label><Input inputMode="numeric" value={f.volume} onChange={isi("volume")} /></div>
      </div>
      <div className="space-y-1">
        <Label>Perlindungan WRG yang ada di naskah (wajib ketiganya)</Label>
        {wajib.map((k) => centang(k, LABEL_PERLINDUNGAN[k] ?? k))}
      </div>
      <div className="space-y-1">
        <Label>Klausul khusus RS yang ada di naskah</Label>
        {d.klausul_khusus.map((k) => centang(k.kode, k.label,
          m?.klausul_dilarang.includes(k.kode) ? "dilarang mandat" : d.klausul.some((x) => x.kode === k.kode) ? "sudah diusulkan" : "tidak pernah diusulkan"))}
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!f.harga.trim() || !f.tenor.trim() || !f.volume.trim() || sibuk}
        onClick={() => go("pks", { harga_deal: angka(f.harga), tenor_bulan: angka(f.tenor), volume_minimum: angka(f.volume), klausul })}>
        Cocokkan & simpan
      </Button>
    </Kotak>
  );
}

function FormSerahTerima({ jalankan }: { jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [sn, setSn] = useState("");
  const [tgl, setTgl] = useState("");
  return (
    <Kotak judul="Catat serah terima">
      <div className="grid gap-2 sm:grid-cols-2">
        <div><Label>Nomor seri alat (wajib)</Label><Input value={sn} onChange={(e) => setSn(e.target.value)} /></div>
        <div><Label>Tanggal serah terima</Label><Input type="date" value={tgl} onChange={(e) => setTgl(e.target.value)} /></div>
      </div>
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!sn.trim() || sibuk} onClick={() => go("serah-terima", { nomor_seri: sn, tanggal: tgl || null })}>Simpan</Button>
    </Kotak>
  );
}
