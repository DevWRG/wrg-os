"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { KoordGraf } from "./types";
import { warnaGrup } from "./viz";

// Graf koordinasi antar divisi / antar posisi (Tabel C form PIC).
//
// DUA LEVEL, DAN ITU BUKAN SEKADAR PILIHAN TAMPILAN. Di sumbernya, asal selalu
// POSISI sementara tujuan sudah dinormalisasi ke DIVISI — campur satuan. Karena
// itu:
//   • mode "Antar divisi" memakai edges_divisi (asal ikut diangkat ke divisinya),
//     satu-satunya level di mana 'bolak-balik' dan 'sepihak' punya arti;
//   • mode "Per posisi" memakai edges apa adanya, untuk menelusuri siapa
//     menyebut siapa.
// Menyatukan keduanya jadi satu graf akan membuat resiprositas selalu terbaca
// nol — bukan temuan tentang organisasi, cuma artefak satuan yang campur.
//
// Seperti di work-tree.tsx: D3 menghitung tata letak, React menggambar DOM-nya.

type Mode = "divisi" | "posisi";

interface NodeSim extends SimulationNodeDatum {
  id: string;
  label: string;
  bentuk: "divisi" | "posisi" | "luar" | "tak-kenal";
  derajat: number;
}
interface LinkSim extends SimulationLinkDatum<NodeSim> {
  id: string;
  bobot: number;
  sepihak: boolean;
  bolak_balik: boolean;
  topik: string[];
}

const TINGGI = 620;
const JARI = (derajat: number) => 7 + Math.min(11, Math.sqrt(derajat) * 2.2);

export function KoordGraph({
  graf, labelDivisi,
}: { graf: KoordGraf; labelDivisi: Record<string, string> }) {
  const [mode, setMode] = useState<Mode>("divisi");
  const [fokus, setFokus] = useState<string | null>(null);
  const [trf, setTrf] = useState<ZoomTransform>(zoomIdentity);
  const [lebar, setLebar] = useState(900);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const kotakRef = useRef<HTMLDivElement | null>(null);

  const grupNode = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graf.nodes) m.set(n.id, n.grup);
    return m;
  }, [graf.nodes]);

  const bentukDari = useCallback((id: string, asalPosisi: boolean): NodeSim["bentuk"] => {
    if (asalPosisi) return "posisi";
    const g = grupNode.get(id);
    if (g === "external") return "luar";
    if (g === "tak-terklasifikasi") return "tak-kenal";
    return id in labelDivisi ? "divisi" : "tak-kenal";
  }, [grupNode, labelDivisi]);

  const namaDari = useCallback(
    (id: string) => labelDivisi[id] ?? id,
    [labelDivisi],
  );

  // Data graf per mode. Disalin ke objek baru tiap kali mode berganti: d3-force
  // MEMUTASI node (menempelkan x/y/vx/vy), jadi memberinya objek dari props akan
  // mengotori data yang dianggap React tak berubah.
  const { nodes, links } = useMemo(() => {
    const peta = new Map<string, NodeSim>();
    const pakai = (id: string, asalPosisi: boolean) => {
      const ada = peta.get(id);
      if (ada) return ada;
      const n: NodeSim = { id, label: namaDari(id), bentuk: bentukDari(id, asalPosisi), derajat: 0 };
      peta.set(id, n);
      return n;
    };
    const ls: LinkSim[] = [];

    if (mode === "divisi") {
      for (const e of graf.edges_divisi) {
        const a = pakai(e.from, false), b = pakai(e.to, false);
        a.derajat += e.bobot; b.derajat += e.bobot;
        ls.push({
          id: `${e.from}→${e.to}`, source: a.id, target: b.id, bobot: e.bobot,
          sepihak: e.sepihak, bolak_balik: e.bolak_balik, topik: [],
        });
      }
    } else {
      for (const e of graf.edges) {
        const a = pakai(e.from, true), b = pakai(e.to, false);
        a.derajat += e.bobot; b.derajat += e.bobot;
        ls.push({
          id: `${e.from}→${e.to}`, source: a.id, target: b.id, bobot: e.bobot,
          sepihak: false, bolak_balik: false, topik: e.topik,
        });
      }
    }
    return { nodes: [...peta.values()], links: ls };
  }, [mode, graf, namaDari, bentukDari]);

  // Simulasi hidup di ref; React hanya diberi tahu "posisi berubah" lewat
  // penghitung. Menyimpan array node di state dan menyalinnya tiap tick akan
  // membuat 60 render/detik berisi objek baru tanpa guna.
  const simRef = useRef<Simulation<NodeSim, LinkSim> | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const sim = forceSimulation<NodeSim, LinkSim>(nodes)
      .force("link", forceLink<NodeSim, LinkSim>(links).id((d) => d.id)
        .distance((l) => 90 + 40 / Math.sqrt(l.bobot)).strength(0.35))
      .force("muat", forceManyBody().strength(-560))
      .force("pusat", forceCenter(lebar / 2, TINGGI / 2))
      .force("x", forceX(lebar / 2).strength(0.04))
      .force("y", forceY(TINGGI / 2).strength(0.06))
      .force("tabrak", forceCollide<NodeSim>((d) => JARI(d.derajat) + 26))
      .on("tick", () => setTick((t) => t + 1));
    simRef.current = sim;
    return () => { sim.stop(); simRef.current = null; };
  }, [nodes, links, lebar]);

  useEffect(() => {
    const el = kotakRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLebar(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomRef = useRef<ReturnType<typeof d3zoom<SVGSVGElement, unknown>> | null>(null);
  useEffect(() => {
    if (!svgRef.current) return;
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 3]).on("zoom", (e) => setTrf(e.transform));
    zoomRef.current = z;
    const sel = select(svgRef.current);
    sel.call(z);
    sel.on("dblclick.zoom", null);
    return () => { sel.on(".zoom", null); };
  }, []);
  const reset = () => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  };

  // Seret simpul. Pakai pointer event React (bukan d3-drag) supaya tak ada dua
  // pustaka yang memegang simpul DOM yang sama — d3-drag mengikat listener ke
  // elemen yang siklus hidupnya milik React.
  const seret = useRef<string | null>(null);
  const keGraf = (e: React.PointerEvent) => {
    const kotak = svgRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - kotak.left - trf.x) / trf.k,
      y: (e.clientY - kotak.top - trf.y) / trf.k,
    };
  };
  const mulaiSeret = (e: React.PointerEvent, n: NodeSim) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    seret.current = n.id;
    simRef.current?.alphaTarget(0.25).restart();
  };
  const selamaSeret = (e: React.PointerEvent) => {
    if (!seret.current || !svgRef.current) return;
    const n = nodes.find((x) => x.id === seret.current);
    if (!n) return;
    const p = keGraf(e);
    n.fx = p.x; n.fy = p.y;
    setTick((t) => t + 1);
  };
  const akhirSeret = () => {
    if (!seret.current) return;
    const n = nodes.find((x) => x.id === seret.current);
    // fx/fy dilepas: simpul yang ditinggal terkunci akan membuat tata letak
    // berikutnya terbaca sebagai hasil simulasi padahal separuhnya dipaku tangan.
    if (n) { n.fx = null; n.fy = null; }
    seret.current = null;
    simRef.current?.alphaTarget(0);
  };

  const tetangga = useMemo(() => {
    if (!fokus) return null;
    const set = new Set<string>([fokus]);
    for (const l of links) {
      const s = (l.source as NodeSim).id ?? (l.source as unknown as string);
      const t = (l.target as NodeSim).id ?? (l.target as unknown as string);
      if (s === fokus) set.add(t);
      if (t === fokus) set.add(s);
    }
    return set;
  }, [fokus, links]);

  const rinci = useMemo(() => {
    if (!fokus) return null;
    const keluar = links.filter((l) => ((l.source as NodeSim).id ?? l.source) === fokus);
    const masuk = links.filter((l) => ((l.target as NodeSim).id ?? l.target) === fokus);
    return { keluar, masuk };
  }, [fokus, links]);

  const r = graf.ringkas;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{r.baris} pernyataan koordinasi</Badge>
            <Badge variant="outline">{r.pasangan_divisi} pasangan divisi</Badge>
            <Badge variant="secondary">{r.pasangan_bolak_balik} bolak-balik</Badge>
            <Badge variant="outline">{r.pasangan_sepihak} sepihak</Badge>
            {r.tak_terklasifikasi > 0 && (
              <Badge variant="destructive">{r.tak_terklasifikasi} tak terklasifikasi</Badge>
            )}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Jaringan <strong>deklaratif</strong> — isi kolom &ldquo;Koordinasi dengan&rdquo; di form
            PIC, bukan hasil pengamatan percakapan. <strong>Sepihak</strong> (garis putus-putus) =
            divisi ini mencatat koordinasi ke divisi lawan tapi lawannya tidak mencatat baliknya;
            biasanya artinya salah satu form belum lengkap. Pihak luar tak pernah ditandai sepihak —
            mereka tak punya form untuk mengakui balik.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border p-0.5">
                {(["divisi", "posisi"] as Mode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setFokus(null); }}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {m === "divisi" ? "Antar divisi" : "Per posisi"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {nodes.length} node · {links.length} garis
              </span>
              <div className="ml-auto flex gap-2">
                {fokus && <Button size="sm" variant="outline" onClick={() => setFokus(null)}>Lepas sorot</Button>}
                <Button size="sm" variant="outline" onClick={reset}>Pas-kan</Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm" style={{ background: "var(--viz-internal)" }} />
                divisi (kotak) &amp; posisi (bulat)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 rotate-45" style={{ background: "var(--viz-external)" }} />
                pihak luar
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm border border-dashed border-muted-foreground" />
                tak terklasifikasi
              </span>
              <span>garis putus-putus = sepihak · tebal garis = jumlah baris</span>
            </div>

            <div ref={kotakRef} className="rounded-lg border bg-card" style={{ height: TINGGI }}>
              <svg
                ref={svgRef}
                width="100%"
                height={TINGGI}
                className="cursor-grab touch-none active:cursor-grabbing"
                role="img"
                aria-label="Jaringan koordinasi antar divisi dan posisi"
                onPointerMove={selamaSeret}
                onPointerUp={akhirSeret}
                onPointerLeave={akhirSeret}
                onClick={() => setFokus(null)}
              >
                <defs>
                  <marker id="panah" viewBox="0 0 10 10" refX={10} refY={5}
                    markerWidth={5} markerHeight={5} orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
                  </marker>
                </defs>
                <g transform={`translate(${trf.x},${trf.y}) scale(${trf.k})`}>
                  {links.map((l) => {
                    const s = l.source as NodeSim, t = l.target as NodeSim;
                    if (typeof s.x !== "number" || typeof t.x !== "number") return null;
                    const redup = tetangga ? !(tetangga.has(s.id) && tetangga.has(t.id)) : false;
                    return (
                      <line
                        key={l.id}
                        x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                        className="stroke-muted-foreground"
                        strokeWidth={Math.min(5, 1 + l.bobot * 0.5)}
                        strokeOpacity={redup ? 0.08 : l.sepihak ? 0.45 : 0.6}
                        strokeDasharray={l.sepihak ? "5 4" : undefined}
                        markerEnd="url(#panah)"
                      />
                    );
                  })}
                  {nodes.map((n) => {
                    if (typeof n.x !== "number" || typeof n.y !== "number") return null;
                    const redup = tetangga ? !tetangga.has(n.id) : false;
                    const aktif = fokus === n.id;
                    const jr = JARI(n.derajat);
                    const warna = n.bentuk === "luar" ? warnaGrup("external") : warnaGrup("internal");
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${n.x},${n.y})`}
                        opacity={redup ? 0.18 : 1}
                        className="cursor-pointer"
                        onPointerDown={(e) => mulaiSeret(e, n)}
                        onClick={(e) => { e.stopPropagation(); setFokus(aktif ? null : n.id); }}
                      >
                        {n.bentuk === "divisi" ? (
                          <rect x={-jr} y={-jr} width={jr * 2} height={jr * 2} rx={4} fill={warna}
                            className={aktif ? "stroke-foreground" : "stroke-card"} strokeWidth={2} />
                        ) : n.bentuk === "luar" ? (
                          <rect x={-jr} y={-jr} width={jr * 2} height={jr * 2} rx={2} fill={warna}
                            transform="rotate(45)"
                            className={aktif ? "stroke-foreground" : "stroke-card"} strokeWidth={2} />
                        ) : n.bentuk === "tak-kenal" ? (
                          <circle r={jr} fill="none" className="stroke-muted-foreground"
                            strokeWidth={2} strokeDasharray="3 3" />
                        ) : (
                          <circle r={jr} fill={warna}
                            className={aktif ? "stroke-foreground" : "stroke-card"} strokeWidth={2} />
                        )}
                        {/* Label SELALU tampil, tidak hanya saat hover: identitas
                            node tidak boleh bergantung pada warna semata. */}
                        <text y={jr + 13} textAnchor="middle"
                          className={`pointer-events-none text-[11px] ${aktif ? "fill-foreground font-medium" : "fill-foreground/75"}`}>
                          {n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label}
                        </text>
                        <title>{n.label} — {n.derajat} baris koordinasi</title>
                      </g>
                    );
                  })}
                </g>
              </svg>
            </div>
            <p className="text-xs text-muted-foreground">
              Klik node untuk menyorot tetangganya, seret untuk merapikan, scroll untuk memperbesar.
              Tata letaknya hasil simulasi gaya — jarak antar node tidak mengandung arti.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {!rinci || !fokus ? (
              <p className="text-sm text-muted-foreground">
                Belum ada node dipilih. Klik salah satu node untuk melihat siapa saja yang
                berkoordinasi dengannya{mode === "posisi" ? ", beserta apa yang dikoordinasikan" : ""}.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {nodes.find((n) => n.id === fokus)?.bentuk === "luar" ? "pihak luar" : mode === "posisi" ? "node" : "divisi"}
                  </div>
                  <div className="mt-1 text-sm font-medium">{namaDari(fokus)}</div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground">
                    Menyatakan koordinasi ke ({rinci.keluar.length})
                  </div>
                  <ul className="mt-1 space-y-1.5 text-sm">
                    {rinci.keluar.length === 0 && <li className="text-muted-foreground">—</li>}
                    {rinci.keluar.map((l) => (
                      <li key={l.id}>
                        <span className="font-medium">{namaDari((l.target as NodeSim).id)}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          · {l.bobot} baris{l.sepihak ? " · sepihak" : l.bolak_balik ? " · bolak-balik" : ""}
                        </span>
                        {l.topik.length > 0 && (
                          <ul className="mt-0.5 list-inside list-disc text-xs text-muted-foreground">
                            {l.topik.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground">Disebut oleh ({rinci.masuk.length})</div>
                  <ul className="mt-1 space-y-1 text-sm">
                    {rinci.masuk.length === 0 && <li className="text-muted-foreground">—</li>}
                    {rinci.masuk.map((l) => (
                      <li key={l.id}>
                        {namaDari((l.source as NodeSim).id)}{" "}
                        <span className="text-xs text-muted-foreground">· {l.bobot} baris</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
