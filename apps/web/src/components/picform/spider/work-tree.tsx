"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { linkHorizontal } from "d3-shape";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PohonPekerjaan } from "./types";
import { LEVEL_URUT, warnaLevel } from "./viz";

// Pohon pekerjaan: divisi → posisi → tugas, dan divisi → SOP → langkah.
//
// D3 DIPAKAI UNTUK MENGHITUNG, BUKAN UNTUK MENGGAMBAR. d3-hierarchy menentukan
// koordinat tiap simpul, d3-shape menggambar kurva penghubung, d3-zoom menangani
// geser/perbesar — tapi seluruh <g>/<circle>/<text> dirender React. Pola campur
// (d3-selection meng-enter/exit DOM yang juga dimiliki React) adalah sumber bug
// yang tak perlu di sini: React dan D3 akan berebut simpul yang sama.
//
// SATU-SATUNYA HAL YANG DIWARNAI ADALAH LEVEL OTOMASI. Jenis simpul sudah
// terbaca dari kedalaman dan bentuknya, jadi mewarnainya lagi hanya memakai
// anggaran warna tanpa menambah informasi. Level otomasi (Manual → AI) justru
// tidak terbaca dari struktur mana pun, dan itu yang jadi tangga warna satu-hue.

type Jenis = "root" | "divisi" | "posisi" | "tugas" | "grup-sop" | "sop" | "langkah";

interface Simpul {
  id: string;
  jenis: Jenis;
  label: string;
  /** keterangan singkat di sebelah label (jumlah anak, frekuensi, dst) */
  sub?: string;
  /** level otomasi — hanya untuk langkah SOP */
  level?: string | null;
  target?: string | null;
  detail?: { k: string; v: string }[];
  anak: Simpul[];
}

const RINGKAS = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isi = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

function bangunPohon(data: PohonPekerjaan): Simpul {
  const divisi: Simpul[] = data.divisi.map((d) => {
    const tugasTotal = d.posisi.reduce((n, p) => n + p.tugas.length, 0);
    const langkahTotal = d.sop.reduce((n, s) => n + s.langkah.length, 0);

    const posisi: Simpul[] = d.posisi.map((p) => ({
      id: `p:${p.id}`,
      jenis: "posisi",
      label: p.nama,
      sub: `${p.tugas.length} tugas`,
      detail: [
        ...(p.jumlah_orang !== null ? [{ k: "Jumlah orang", v: String(p.jumlah_orang) }] : []),
        ...(isi(p.level_raw) ? [{ k: "Level (apa adanya)", v: p.level_raw }] : []),
        ...(isi(p.catatan) ? [{ k: "Catatan", v: p.catatan }] : []),
        { k: "Divisi", v: d.label },
      ],
      anak: p.tugas.map((t) => ({
        id: `t:${t.id}`,
        jenis: "tugas" as const,
        label: t.uraian,
        sub: t.frekuensi ?? t.frekuensi_raw ?? undefined,
        detail: [
          { k: "Frekuensi", v: t.frekuensi ?? t.frekuensi_raw ?? "— belum diisi" },
          { k: "Penanggung jawab", v: t.pj_key ?? t.pj_raw ?? "— belum diisi" },
          { k: "Target / KPI", v: t.kpi_target ?? "— belum diisi" },
          ...(isi(t.rules) ? [{ k: "Rules", v: t.rules }] : []),
          { k: "Posisi", v: p.nama },
        ],
        anak: [],
      })),
    }));

    // Cabang SOP digantung di DIVISI, bukan di posisi — Tabel B form PIC memang
    // tidak punya kolom posisi. Lihat pohonPekerjaan() di apps/api.
    const grupSop: Simpul[] = d.sop.length
      ? [{
        id: `gs:${d.key}`,
        jenis: "grup-sop",
        label: "SOP divisi",
        sub: `${d.sop.length} SOP · ${langkahTotal} langkah`,
        detail: [{ k: "Kenapa di sini", v: "SOP di form PIC melekat ke divisi, bukan ke posisi tertentu." }],
        anak: d.sop.map((s) => ({
          id: `s:${s.id}`,
          jenis: "sop" as const,
          label: s.nama,
          sub: `${s.langkah.length} langkah`,
          anak: s.langkah.map((l) => ({
            id: `l:${l.id}`,
            jenis: "langkah" as const,
            label: l.langkah,
            sub: l.kondisi ?? undefined,
            level: l.kondisi,
            target: l.target_level,
            detail: [
              { k: "Kondisi sekarang", v: l.kondisi ?? "— belum diisi" },
              { k: "Target level", v: l.target_level ?? "— belum diisi" },
              ...(isi(l.catatan) ? [{ k: "Catatan", v: l.catatan }] : []),
              { k: "SOP", v: s.nama },
            ],
            anak: [],
          })),
        })),
      }]
      : [];

    return {
      id: `d:${d.key}`,
      jenis: "divisi",
      label: d.label,
      sub: `${d.posisi.length} posisi · ${tugasTotal} tugas · ${d.sop.length} SOP`,
      detail: [
        { k: "PIC", v: d.pic_nama ?? "—" },
        { k: "HOD", v: d.hod_nama ?? "—" },
        { k: "Langkah SOP", v: String(langkahTotal) },
      ],
      anak: [...posisi, ...grupSop],
    };
  });

  return { id: "root", jenis: "root", label: "WRG-OS", sub: `${divisi.length} divisi`, anak: divisi };
}

/** peta id → id induk, dipakai membuka jalur ke hasil pencarian */
function petaInduk(akar: Simpul): Map<string, string> {
  const peta = new Map<string, string>();
  const jalan = (s: Simpul) => { for (const a of s.anak) { peta.set(a.id, s.id); jalan(a); } };
  jalan(akar);
  return peta;
}

const JARAK_X = 300;   // jarak antar kedalaman
const JARAK_Y = 26;    // jarak antar baris
const TINGGI = 620;

export function WorkTree({ data }: { data: PohonPekerjaan }) {
  const akarData = useMemo(() => bangunPohon(data), [data]);
  const induk = useMemo(() => petaInduk(akarData), [akarData]);
  const semuaSimpul = useMemo(() => {
    const out: Simpul[] = [];
    const jalan = (s: Simpul) => { out.push(s); s.anak.forEach(jalan); };
    jalan(akarData);
    return out;
  }, [akarData]);

  const [buka, setBuka] = useState<Set<string>>(() => new Set(["root"]));
  const [pilih, setPilih] = useState<string | null>(null);
  const [cari, setCari] = useState("");
  const [trf, setTrf] = useState<ZoomTransform>(zoomIdentity);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (q.length < 2) return null;
    return new Set(semuaSimpul.filter((s) => s.label.toLowerCase().includes(q)).map((s) => s.id));
  }, [cari, semuaSimpul]);

  // Pencarian MEMBUKA jalurnya, bukan menyaring pohonnya. Menyaring akan
  // menyembunyikan induk yang tak cocok, dan hasilnya kehilangan konteks
  // "tugas ini milik posisi apa di divisi mana" — justru yang dicari orang.
  //
  // Jalur itu dihitung saat render, BUKAN lewat useEffect yang memanggil
  // setBuka: efek semacam itu membuat satu render tambahan untuk tiap ketikan
  // dan membuat keadaan pohon punya dua sumber. Di sini `buka` tetap satu-satunya
  // keadaan yang dimiliki, dan hasil pencarian cuma lapisan turunan di atasnya.
  const bukaEfektif = useMemo(() => {
    if (!cocok || cocok.size === 0) return buka;
    const s = new Set(buka);
    for (const id of cocok) {
      let p = induk.get(id);
      while (p) { s.add(p); p = induk.get(p); }
    }
    return s;
  }, [buka, cocok, induk]);

  const layout = useMemo(() => {
    const h = hierarchy<Simpul>(akarData, (d) => (bukaEfektif.has(d.id) ? d.anak : undefined));
    const pohon = d3tree<Simpul>().nodeSize([JARAK_Y, JARAK_X]);
    return pohon(h);
  }, [akarData, bukaEfektif]);

  const simpul = useMemo(() => layout.descendants() as HierarchyPointNode<Simpul>[], [layout]);
  const garis = useMemo(() => {
    const path = linkHorizontal<unknown, HierarchyPointNode<Simpul>>().x((d) => d.y).y((d) => d.x);
    return layout.links().map((l) => ({
      id: `${l.source.data.id}->${l.target.data.id}`,
      d: path({ source: l.source as HierarchyPointNode<Simpul>, target: l.target as HierarchyPointNode<Simpul> }) ?? "",
    }));
  }, [layout]);

  const batas = useMemo(() => {
    const xs = simpul.map((s) => s.x), ys = simpul.map((s) => s.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }, [simpul]);

  const zoomRef = useRef<ReturnType<typeof d3zoom<SVGSVGElement, unknown>> | null>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 2.5])
      .on("zoom", (e) => setTrf(e.transform));
    zoomRef.current = z;
    const sel = select(svgRef.current);
    sel.call(z);
    // Klik-ganda memperbesar secara bawaan; di pohon itu mengganggu karena
    // klik-ganda di simpul gampang terjadi saat membuka/menutup cabang.
    sel.on("dblclick.zoom", null);
    return () => { sel.on(".zoom", null); };
  }, []);

  const pasang = useCallback((t: ZoomTransform) => {
    if (!svgRef.current || !zoomRef.current) return;
    select(svgRef.current).call(zoomRef.current.transform, t);
  }, []);

  const reset = useCallback(() => {
    pasang(zoomIdentity.translate(60, TINGGI / 2).scale(0.85));
  }, [pasang]);

  useEffect(() => { reset(); }, [reset]);

  const toggle = (s: Simpul) => {
    if (!s.anak.length) { setPilih(s.id); return; }
    setPilih(s.id);
    // Bertolak dari bukaEfektif, bukan dari `buka`: begitu orang menyentuh
    // pohon, cabang yang terbuka karena pencarian ikut jadi keadaan sungguhan —
    // kalau tidak, menutup cabang hasil pencarian tak akan ada efeknya (lapisan
    // turunan akan membukanya lagi pada render berikutnya).
    setBuka(() => {
      const baru = new Set(bukaEfektif);
      if (baru.has(s.id)) {
        // Menutup cabang ikut menutup seluruh isinya — kalau tidak, membukanya
        // lagi akan meledak ke keadaan lama yang sudah tak diingat siapa pun.
        const jalan = (n: Simpul) => { baru.delete(n.id); n.anak.forEach(jalan); };
        jalan(s);
      } else baru.add(s.id);
      return baru;
    });
  };

  const bukaDivisi = () => setBuka(new Set(["root", ...akarData.anak.map((d) => d.id)]));
  const tutupSemua = () => setBuka(new Set(["root"]));

  const terpilih = useMemo(() => semuaSimpul.find((s) => s.id === pilih) ?? null, [semuaSimpul, pilih]);
  const r = data.ringkas;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{r.divisi} divisi</Badge>
            <Badge variant="outline">{r.posisi} posisi</Badge>
            <Badge variant="outline">{r.tugas} tugas</Badge>
            <Badge variant="outline">{r.sop} SOP</Badge>
            <Badge variant="outline">{r.langkah} langkah</Badge>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Klik simpul untuk membuka cabangnya; klik daun untuk lihat rinciannya di panel kanan.
            Geser untuk menggeser kanvas, scroll untuk memperbesar. Cabang <strong>SOP divisi</strong>{" "}
            digantung di divisi — bukan di posisi — karena Tabel B form PIC tidak mencatat posisi
            untuk SOP; menggantungkannya ke posisi berarti mengarang data yang tak ada di sumbernya.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari tugas / posisi / langkah…"
                className="h-8 max-w-xs"
              />
              {cocok && (
                <span className="text-xs text-muted-foreground">
                  {cocok.size} cocok{cocok.size > 0 ? " — jalurnya dibuka otomatis" : ""}
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={bukaDivisi}>Buka divisi</Button>
                <Button size="sm" variant="outline" onClick={tutupSemua}>Tutup semua</Button>
                <Button size="sm" variant="outline" onClick={reset}>Pas-kan</Button>
              </div>
            </div>

            {/* Legenda WAJIB ada: warna di sini mengkodekan level otomasi, dan
                tanpa legenda ia cuma jadi gradasi biru tanpa arti. */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Level otomasi langkah:</span>
              {LEVEL_URUT.map((l) => (
                <span key={l} className="inline-flex items-center gap-1.5">
                  <span className="inline-block size-3 rounded-sm" style={{ background: warnaLevel(l) ?? undefined }} />
                  {l}
                </span>
              ))}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm border border-dashed border-muted-foreground" />
                belum diisi
              </span>
            </div>

            <div className="rounded-lg border bg-card" style={{ height: TINGGI }}>
              <svg
                ref={svgRef}
                width="100%"
                height={TINGGI}
                className="cursor-grab touch-none active:cursor-grabbing"
                role="img"
                aria-label="Pohon pekerjaan per divisi dan posisi"
              >
                <g transform={`translate(${trf.x},${trf.y}) scale(${trf.k})`}>
                  {garis.map((g) => (
                    <path
                      key={g.id}
                      d={g.d}
                      fill="none"
                      className="stroke-border"
                      strokeWidth={1.5}
                    />
                  ))}
                  {simpul.map((s) => {
                    const d = s.data;
                    const punyaAnak = d.anak.length > 0;
                    const terbuka = bukaEfektif.has(d.id);
                    const disorot = cocok?.has(d.id) ?? false;
                    const aktif = pilih === d.id;
                    const warna = d.jenis === "langkah" ? warnaLevel(d.level) : null;
                    return (
                      <g
                        key={d.id}
                        transform={`translate(${s.y},${s.x})`}
                        className="cursor-pointer"
                        onClick={() => toggle(d)}
                      >
                        {disorot && <circle r={11} className="fill-warning/25" />}
                        {/* Bentuk membedakan jenis simpul — bukan warna. */}
                        {d.jenis === "divisi" || d.jenis === "root" ? (
                          <rect x={-6} y={-6} width={12} height={12} rx={3}
                            fill="var(--viz-internal)"
                            className={aktif ? "stroke-foreground" : "stroke-card"} strokeWidth={2} />
                        ) : d.jenis === "posisi" ? (
                          <circle r={6} fill="var(--viz-internal)"
                            className={aktif ? "stroke-foreground" : "stroke-card"} strokeWidth={2} />
                        ) : d.jenis === "grup-sop" ? (
                          <rect x={-5} y={-5} width={10} height={10} rx={2}
                            fill="none" className="stroke-muted-foreground" strokeWidth={2} />
                        ) : d.jenis === "sop" ? (
                          <circle r={4.5} fill="none" className="stroke-muted-foreground" strokeWidth={2} />
                        ) : warna ? (
                          <rect x={-5} y={-5} width={10} height={10} rx={2} fill={warna}
                            className={aktif ? "stroke-foreground" : "stroke-card"} strokeWidth={1.5} />
                        ) : (
                          <rect x={-5} y={-5} width={10} height={10} rx={2} fill="none"
                            className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="2 2" />
                        )}

                        {punyaAnak && (
                          <text x={-13} y={4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                            {terbuka ? "▾" : "▸"}
                          </text>
                        )}
                        <text
                          x={12}
                          y={4}
                          className={`text-[12px] ${aktif ? "fill-foreground font-medium" : "fill-foreground/80"}`}
                        >
                          {RINGKAS(d.label, 44)}
                          {d.sub ? <tspan className="fill-muted-foreground"> · {d.sub}</tspan> : null}
                        </text>
                        <title>{d.label}</title>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
            <p className="text-xs text-muted-foreground">
              {simpul.length} simpul tampil dari {semuaSimpul.length} · rentang{" "}
              {Math.round(batas.y1 - batas.y0)}×{Math.round(batas.x1 - batas.x0)} px
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {!terpilih ? (
              <p className="text-sm text-muted-foreground">
                Belum ada simpul dipilih. Klik salah satu simpul di pohon untuk membaca rinciannya —
                frekuensi, penanggung jawab, dan target/KPI tugas, atau kondisi vs target level
                sebuah langkah SOP.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {terpilih.jenis === "grup-sop" ? "kumpulan SOP" : terpilih.jenis}
                  </div>
                  <div className="mt-1 text-sm font-medium">{terpilih.label}</div>
                </div>
                {terpilih.jenis === "langkah" && (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">sekarang: {terpilih.level ?? "belum diisi"}</Badge>
                    <Badge variant="secondary">target: {terpilih.target ?? "belum diisi"}</Badge>
                  </div>
                )}
                <dl className="space-y-2 text-sm">
                  {(terpilih.detail ?? []).map((x) => (
                    <div key={x.k}>
                      <dt className="text-xs text-muted-foreground">{x.k}</dt>
                      <dd className="whitespace-pre-wrap">{x.v}</dd>
                    </div>
                  ))}
                </dl>
                {terpilih.anak.length > 0 && (
                  <p className="text-xs text-muted-foreground">{terpilih.anak.length} cabang di bawahnya.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
