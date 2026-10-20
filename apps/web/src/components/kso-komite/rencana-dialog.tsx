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

import { GERBANG_CLS, GERBANG_IKON, LABEL_PERLINDUNGAN, STATUS_LABEL, kirim, rp, rpJt, waktu, type Detail } from "./types";

// Detail satu rencana + form aksi sesuai tab. Form hanya muncul bila tab boleh "edit" DAN
// status rencana cocok; API tetap memeriksa keduanya (tombol tersembunyi ≠ endpoint tertutup).
export function RencanaDialog({ tab, id, bolehAksi, onClose, onBerubah }: {
  tab: TabKso; id: number | null; bolehAksi: boolean; onClose: () => void; onBerubah: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const url = `/api/kso-komite/${tab}/rencana/${id}`;

  // Pemuatan awal. Dialog di-remount per rencana (key di pemanggil), jadi state awal sudah bersih.
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
    try { setD(await kirim<Detail>(url)); } catch { onClose(); }
    onBerubah();
  };

  const r = d?.rencana;
  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{r ? r.faskes_nama : "Memuat…"}</DialogTitle>
          {r && <DialogDescription>{r.nomor ?? `D${r.id}`} · {STATUS_LABEL[r.status] ?? r.status} · AM {r.am_nama}{r.cabang ? ` · ${r.cabang}` : ""}</DialogDescription>}
        </DialogHeader>
        <DialogBody className="space-y-4">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {d && r && (
            <>
              {bolehAksi && <FormAksi tab={tab} d={d} jalankan={jalankan} />}
              <Isian d={d} />
              <Gerbang d={d} />
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
                <Blok judul="Usulan komite">
                  {d.usulan.map((u, i) => (
                    <li key={i}><b>{STATUS_LABEL[u.usulan] ?? u.usulan}</b>{u.alasan && ` — ${u.alasan}`}
                      {u.syarat?.length ? <> · syarat: {u.syarat.map((x) => x.isi).join("; ")}</> : null}
                      {u.data_kurang && ` · kurang: ${u.data_kurang} (oleh ${u.pemilik}, kembali ${u.tanggal_kembali})`}
                      <span className="text-muted-foreground text-xs"> {waktu(u.at)}</span></li>
                  ))}
                </Blok>
              )}
              {d.mandat && (
                <Blok judul={`Mandat negosiasi (${d.mandat.sumber}) — berlaku s/d ${d.mandat.berlaku_sampai}`}>
                  <li>Lantai {rp(d.mandat.harga_lantai)}/test · pembuka {rp(d.mandat.harga_target)}/test</li>
                  <li>Capex maks {rpJt(d.mandat.capex_maks)} · tenor maks {d.mandat.tenor_maks_bulan} bln · volume min {d.mandat.volume_minimum ?? "—"} test/bln</li>
                  {d.mandat.klausul_dilarang.length > 0 && <li>Klausul dilarang: {d.mandat.klausul_dilarang.map((k) => labelKlausul(d, k)).join(", ")}</li>}
                </Blok>
              )}
              {r.harga_deal != null && (
                <Blok judul="PKS (dicocokkan Sekretariat)">
                  <li>Harga {rp(Number(r.harga_deal))}/test · tenor {String(r.pks_tenor_bulan ?? "—")} bln · volume min {String(r.pks_volume_minimum ?? "—")} test/bln</li>
                  {Array.isArray(r.pks_klausul) && <li>Klausul: {(r.pks_klausul as string[]).map((k) => labelKlausul(d, k)).join(", ") || "—"}</li>}
                </Blok>
              )}
              {d.putusan && <Blok judul="Putusan Direksi"><li><b>{d.putusan.putusan}</b>{d.putusan.catatan && ` — ${d.putusan.catatan}`} <span className="text-muted-foreground text-xs">{waktu(d.putusan.at)}</span></li></Blok>}
              <Blok judul="Jejak status">
                {d.riwayat.map((h, i) => (
                  <li key={i} className="text-xs">{waktu(h.at)} · {STATUS_LABEL[h.ke] ?? h.ke} · {h.oleh_nama ?? h.oleh ?? "—"}{h.oleh_peran ? ` (${h.oleh_peran})` : ""}</li>
                ))}
              </Blok>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

const labelKlausul = (d: Detail, k: string) => LABEL_PERLINDUNGAN[k] ?? d.klausul_khusus.find((x) => x.kode === k)?.label ?? k;

function Blok({ judul, children }: { judul: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">{judul}</h3>
      <ul className="space-y-1 text-sm">{children}</ul>
    </section>
  );
}

function Isian({ d }: { d: Detail }) {
  const r = d.rencana;
  return (
    <Blok judul="Isian AM">
      <li>{r.jumlah} × {r.alat_nama} · capex {rpJt(r.capex)}{r.payback_bulan ? ` · payback ±${r.payback_bulan} bln` : ""}</li>
      <li>Volume {r.volume_estimasi ?? "—"} test/bln · harga {rp(r.harga_per_test)}/test · tenor {r.tenor_bulan ?? "—"} bln</li>
      {/* kalimat AM apa adanya, dalam tanda kutip — bukan kategori turunan */}
      <li>Sumber volume: {r.volume_sumber ? <i>“{r.volume_sumber}”</i> : <span className="text-red-700 dark:text-red-400">kosong</span>}</li>
      <li>Klausul khusus: {d.klausul.length ? d.klausul.map((k) => k.label).join(", ") : "tidak ada"}</li>
      {d.pendukung.map((p, i) => <li key={i}>Pendukung: {p.nama} ({p.tipe.replace(/_/g, " ")}){p.kontak_terakhir_tanggal ? ` · kontak ${p.kontak_terakhir_tanggal}` : ""}</li>)}
      {r.alasan_forum && <li className="text-amber-700 dark:text-amber-400">Ke forum karena: {r.alasan_forum}</li>}
    </Blok>
  );
}

function Gerbang({ d }: { d: Detail }) {
  return (
    <Blok judul="Tujuh gerbang">
      {d.gerbang.map((g) => (
        <li key={g.no} className="flex items-start gap-2">
          <span className={cn("mt-0.5 inline-block w-5 shrink-0 rounded text-center text-xs font-bold", GERBANG_CLS[g.status])}>{GERBANG_IKON[g.status]}</span>
          <span><b>{g.no}. {g.nama}</b>{g.nilai && <span className="text-muted-foreground"> — {g.nilai}</span>}</span>
        </li>
      ))}
    </Blok>
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
  if (tab === "agenda" && mandatLewat && (s === "DIPUTUS_HOD" || s === "MANDAT_TERBIT"))
    return <FormTeks judul="Tarik kembali ke forum" nada="amber" label="Alasan" aksi="tarik" kunci="alasan" jalankan={jalankan} />;
  if (tab === "direksi" && ["DIREKOMENDASIKAN", "DIREKOMENDASIKAN_BERSYARAT", "TIDAK_DIREKOMENDASIKAN"].includes(s)) return <FormDireksi d={d} jalankan={jalankan} />;
  // Sekretariat (atau Admin Sales cadangan): penawaran terbit dengan harga pembuka mandat
  if ((tab === "sekretariat" || tab === "penawaran") && (s === "DIPUTUS_HOD" || s === "MANDAT_TERBIT") && !mandatLewat)
    return (
      <div className="space-y-3">
        <FormAngka judul="Terbitkan penawaran" label={`Harga per test (Rp) — lantai ${rp(d.mandat?.harga_lantai)}, pembuka ${rp(d.mandat?.harga_target)}`}
          awal={d.mandat?.harga_target ?? d.mandat?.harga_lantai ?? null} aksi="penawaran" kunci="harga" jalankan={jalankan} />
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

function Kotak({ judul, nada = "sky", children }: { judul: string; nada?: "sky" | "amber"; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-3 rounded-lg border-2 p-3", nada === "sky" ? "border-sky-500/50 bg-sky-500/5" : "border-amber-500/50 bg-amber-500/5")}>
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
        <Button key={v} type="button" size="sm" variant={nilai === v ? "default" : "outline"} onClick={() => set(v)}>{l}</Button>
      ))}
    </div>
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

function FormAngka({ judul, label, aksi, kunci, awal = null, jalankan }: {
  judul: string; label: string; aksi: string; kunci: string; awal?: number | null; jalankan: Jalankan;
}) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [v, setV] = useState(awal == null ? "" : String(awal));
  return (
    <Kotak judul={judul}>
      <Label>{label}</Label>
      <Input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} />
      {err && <p className="text-destructive text-sm">{err}</p>}
      <Button disabled={!v.trim() || sibuk} onClick={() => go(aksi, { [kunci]: angka(v) })}>Simpan</Button>
    </Kotak>
  );
}

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

function FormDireksi({ d, jalankan }: { d: Detail; jalankan: Jalankan }) {
  const { sibuk, err, go } = useKirim(jalankan);
  const [p, setP] = useState<"SETUJU" | "BERSYARAT" | "TOLAK" | null>(null);
  const [f, setF] = useState({ lantai: "", target: "", tenor_maks: "", capex_maks: "", volume_min: "", catatan: "" });
  const isi = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const r = d.rencana;
  const kolom: [keyof typeof f, string, string][] = [
    ["lantai", "Harga lantai (Rp/test)", r.harga_per_test ? `usulan AM ${rp(r.harga_per_test)}` : ""],
    ["target", "Harga pembuka (Rp/test)", ""],
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
        putusan: p, catatan: f.catatan, lantai: angka(f.lantai), target: angka(f.target), tenor_maks: angka(f.tenor_maks),
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
