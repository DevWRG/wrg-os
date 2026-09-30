"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation,
  forceX, forceY,
  type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";

import { Button } from "@/components/ui/button";

// Mesin graf gaya (force) yang dipakai BERSAMA oleh tab Pohon Pekerjaan dan tab
// Jaringan Koordinasi.
//
// KENAPA SATU MESIN, BUKAN DUA KOMPONEN: begitu tab Jaringan ikut menampilkan
// sub-tree (divisi → posisi → tugas), dua tab itu menggambar hal yang sama —
// simpul berlabel yang saling terhubung, sebagian hierarki, sebagian relasi.
// Dua salinan berarti setiap perbaikan keterbacaan (anti-tumpuk label, potong
// garis di tepi simpul, pas-kan bingkai) harus ditulis dua kali, dan cepat atau
// lambat satu tab ketinggalan. Yang berbeda cuma konfigurasi: pohon memakai
// cincin per kedalaman (radial), jaringan memakai tata letak bebas.
//
// PEMBAGIAN TUGAS DENGAN REACT, DAN KENAPA SEKETAT INI:
// d3-force bekerja dengan MEMUTASI objek simpul (menempelkan x/y/vx/vy tiap
// tick). Objek itu karena itu tidak boleh keluar dari effect ini — ia lahir,
// dimutasi, dan mati di dalam satu simulasi. Yang menyeberang ke React hanyalah
// `pos`: peta id → {x,y} yang dibuat ulang tiap tick, data mati tanpa identitas.
// Versi pertama modul ini membagikan array simpulnya ke React dan memutasinya di
// tempat; selain ditolak aturan immutability, pola itu berarti React merender
// dari objek yang diam-diam berubah di belakangnya.

export type Bentuk =
  | "root" | "divisi" | "posisi" | "luar" | "tak-kenal" | "grup" | "sop" | "tugas" | "langkah";

export interface SimpulViz {
  id: string;
  label: string;
  bentuk: Bentuk;
  /** kedalaman hierarki; dipakai tata letak radial & jarak garis */
  depth: number;
  /** jari-jari gambar simpul */
  jari: number;
  /** isi warna; null = digambar kosong (bingkai saja) */
  warna: string | null;
  punyaAnak: boolean;
  terbuka: boolean;
}

export interface GarisViz {
  id: string;
  source: string;
  target: string;
  jenis: "koordinasi" | "hirarki";
  bobot?: number;
  sepihak?: boolean;
  bolak_balik?: boolean;
}

interface Ukuran {
  baris: string[];
  halfW: number;
  halfH: number;
  cy: number;
}
interface NodeSim extends SimulationNodeDatum, Ukuran {
  id: string;
  depth: number;
  jari: number;
}
interface LinkSim extends SimulationLinkDatum<NodeSim> {
  id: string;
  jenis: GarisViz["jenis"];
  bobot: number;
}
type Titik = { x: number; y: number };

const TINGGI_BARIS = 13;
const LEBAR_KARAKTER = 5.9;   // rata-rata pada font 11px sistem
const MAKS_KARAKTER = 16;
const MAKS_BARIS = 3;
const JARAK_CINCIN = 150;

/** Di atas ambang ini gaya anti-tumpuk dimatikan — O(n²) per tick, dan di
 *  kerapatan segitu label memang tak muat betapapun rapinya didorong. UI
 *  MENGATAKANNYA (catatan di bawah kanvas); batas diam-diam yang membuat gambar
 *  terlihat "sudah rapi" padahal tidak adalah hal yang dihindari di sini. */
const AMBANG_ANTI_TUMPUK = 220;
/** Auto-pas-kan tak pernah mengecilkan teks di bawah ini — lebih baik sebagian
 *  isi di luar bingkai (bisa digeser) daripada seluruhnya tampil tapi tak
 *  terbaca. Tombol "Pas-kan" yang ditekan sendiri boleh lebih kecil: di situ
 *  orang memang sedang minta melihat keseluruhan bentuk. */
const SKALA_AUTO_MIN = 0.85;
const SKALA_MANUAL_MIN = 0.2;

function bungkus(teks: string): string[] {
  const kata = teks.split(/\s+/);
  const baris: string[] = [];
  let kini = "";
  for (const k of kata) {
    const calon = kini ? `${kini} ${k}` : k;
    if (calon.length <= MAKS_KARAKTER || !kini) kini = calon;
    else { baris.push(kini); kini = k; }
  }
  if (kini) baris.push(kini);
  if (baris.length <= MAKS_BARIS) return baris;
  const potong = baris.slice(0, MAKS_BARIS);
  potong[MAKS_BARIS - 1] = `${potong[MAKS_BARIS - 1].slice(0, MAKS_KARAKTER - 1)}…`;
  return potong;
}

/** Gaya anti-tumpang-tindih berbasis KOTAK LABEL (AABB), bukan lingkaran.
 *  forceCollide hanya menjaga jarak bulatannya; yang lebar dan saling menimpa
 *  adalah teksnya — dan teks itulah isi gambarnya, bulatan cuma penanda.
 *  Sengaja tidak dikalikan alpha: dorongannya harus tuntas sebelum simulasi
 *  mereda, bukan ikut mengecil dan meninggalkan tumpukan terakhir tepat saat
 *  gambar berhenti bergerak. */
function gayaKotak(nodes: NodeSim[]) {
  const f = () => {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.x == null || a.y == null) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (b.x == null || b.y == null) continue;
        const dx = b.x - a.x;
        const dy = (b.y + b.cy) - (a.y + a.cy);
        const ox = a.halfW + b.halfW + 8 - Math.abs(dx);
        const oy = a.halfH + b.halfH + 6 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        // Didorong lewat sisi dengan tumpang tindih paling sedikit: simpul
        // bergeser seperlunya dan bentuk jaringannya tidak berubah.
        const kunciA = a.fx != null, kunciB = b.fx != null;
        if (ox < oy) {
          const s = (dx < 0 ? -1 : 1) * ox * 0.5;
          if (!kunciA) a.x -= kunciB ? s * 2 : s;
          if (!kunciB) b.x += kunciA ? s * 2 : s;
        } else {
          const s = (dy < 0 ? -1 : 1) * oy * 0.5;
          if (!kunciA) a.y -= kunciB ? s * 2 : s;
          if (!kunciB) b.y += kunciA ? s * 2 : s;
        }
      }
    }
  };
  f.initialize = () => {};
  return f;
}

function ukur(s: SimpulViz): Ukuran {
  const baris = bungkus(s.label);
  const lebarLabel = Math.max(...baris.map((b) => b.length)) * LEBAR_KARAKTER;
  const atas = -s.jari - 4;
  const bawah = s.jari + 6 + baris.length * TINGGI_BARIS;
  return {
    baris,
    halfW: Math.max(s.jari, lebarLabel / 2) + 4,
    halfH: (bawah - atas) / 2,
    cy: (atas + bawah) / 2,
  };
}

export interface ForceGrafProps {
  simpul: SimpulViz[];
  garis: GarisViz[];
  /** true = cincin per kedalaman (dipakai pohon); false = tata letak bebas */
  radial?: boolean;
  tinggi?: number;
  fokus: string | null;
  /** id simpul yang sedang disorot (hasil pencarian) */
  sorot?: Set<string> | null;
  onKlik: (id: string) => void;
  /** berubahnya nilai ini memicu pas-kan ulang (mis. ganti mode/tab) */
  kunciFit: string;
  toolbar?: ReactNode;
  legenda?: ReactNode;
  catatan?: ReactNode;
}

export function ForceGraf({
  simpul, garis, radial = false, tinggi = 700, fokus, sorot, onKlik, kunciFit,
  toolbar, legenda, catatan,
}: ForceGrafProps) {
  const [trf, setTrf] = useState<ZoomTransform>(zoomIdentity);
  const [lebar, setLebar] = useState(900);
  const [pos, setPos] = useState<Map<string, Titik>>(() => new Map());
  const svgRef = useRef<SVGSVGElement | null>(null);
  const kotakRef = useRef<HTMLDivElement | null>(null);

  // Posisi bertahan lintas pembangunan ulang simulasi. Tanpa ini, membuka satu
  // cabang mengocok SELURUH tata letak dan orang kehilangan tempatnya — cacat
  // khas force-tree yang dibangun ulang dari nol tiap kali di-expand.
  const posRef = useRef(new Map<string, Titik>());
  /** jembatan ke simulasi yang hidup di dalam effect (dipakai handler seret) */
  const apiRef = useRef<{
    seret: (id: string, x: number, y: number) => void;
    lepas: (id: string) => void;
  } | null>(null);
  const paskanRef = useRef<(auto?: boolean) => void>(() => {});

  const ukuran = useMemo(() => {
    const m = new Map<string, Ukuran>();
    for (const s of simpul) m.set(s.id, ukur(s));
    return m;
  }, [simpul]);

  // Jari-jari dipetakan sekali: garis butuh jari kedua ujungnya untuk memotong
  // di tepi simpul, dan mencarinya dengan .find() di dalam map berarti O(n²)
  // pada SETIAP tick simulasi — 60 kali sedetik.
  const jariPer = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of simpul) m.set(s.id, s.jari);
    return m;
  }, [simpul]);

  const antiTumpuk = simpul.length <= AMBANG_ANTI_TUMPUK;

  useEffect(() => {
    const cx = lebar / 2, cy = tinggi / 2;
    const simpan = posRef.current;
    const indukDari = new Map<string, string>();
    for (const g of garis) if (g.jenis === "hirarki") indukDari.set(g.target, g.source);

    // Objek simpul milik simulasi dibuat DI SINI dan tak pernah keluar.
    const nodes: NodeSim[] = simpul.map((s) => {
      const u = ukuran.get(s.id)!;
      return { id: s.id, depth: s.depth, jari: s.jari, ...u };
    });
    const peta = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      const lama = simpan.get(n.id);
      if (lama) { n.x = lama.x; n.y = lama.y; continue; }
      // Simpul baru lahir DI DEKAT induknya (bukan di tengah kanvas), jadi
      // cabang yang dibuka terlihat menyembur dari simpul yang barusan diklik.
      const p = simpan.get(indukDari.get(n.id) ?? "");
      if (p) {
        const sudut = ((n.id.length * 37) % 360) * (Math.PI / 180); // sebar tanpa acak
        n.x = p.x + Math.cos(sudut) * 30;
        n.y = p.y + Math.sin(sudut) * 30;
      }
      if (radial && n.depth === 0) { n.fx = cx; n.fy = cy; }
    }
    const links: LinkSim[] = garis
      .filter((g) => peta.has(g.source) && peta.has(g.target))
      .map((g) => ({
        id: g.id, source: g.source, target: g.target, jenis: g.jenis, bobot: g.bobot ?? 1,
      }));

    const sim = forceSimulation<NodeSim, LinkSim>(nodes)
      .force("link", forceLink<NodeSim, LinkSim>(links).id((d) => d.id)
        .distance((l) => (l.jenis === "hirarki"
          ? (radial ? JARAK_CINCIN * 0.8 : 90)
          : 100 + 40 / Math.sqrt(l.bobot)))
        .strength((l) => (l.jenis === "hirarki" ? 0.7 : 0.28)))
      .force("muat", forceManyBody().strength(-400).distanceMax(700))
      .force("tabrak", forceCollide<NodeSim>((d) => d.jari + 8));

    if (radial) {
      // Akar dipaku di pusat: cincin hanya bermakna kalau titik nolnya diam.
      sim.force("cincin", forceRadial<NodeSim>((d) => d.depth * JARAK_CINCIN, cx, cy)
        .strength((d) => (d.depth === 0 ? 0 : 0.45)));
    } else {
      sim.force("pusat", forceCenter(cx, cy))
        .force("x", forceX(cx).strength(0.03))
        .force("y", forceY(cy).strength(0.05));
    }
    if (antiTumpuk) sim.force("kotak", gayaKotak(nodes));

    let sudahPas = false;
    sim.on("tick", () => {
      const baru = new Map<string, Titik>();
      for (const n of nodes) {
        if (n.x != null && n.y != null) baru.set(n.id, { x: n.x, y: n.y });
      }
      posRef.current = baru;
      setPos(baru);
      if (!sudahPas && sim.alpha() < 0.06) {
        sudahPas = true;
        paskanRef.current(true);
      }
    });

    apiRef.current = {
      seret: (id, x, y) => {
        const n = peta.get(id);
        if (!n) return;
        n.fx = x; n.fy = y;
        sim.alphaTarget(0.2).restart();
      },
      lepas: (id) => {
        const n = peta.get(id);
        // Akar radial tetap dipaku; simpul lain dilepas supaya tata letak
        // berikutnya benar-benar hasil simulasi, bukan separuh dipaku tangan.
        if (n && !(radial && n.depth === 0)) { n.fx = null; n.fy = null; }
        sim.alphaTarget(0);
      },
    };
    return () => { sim.stop(); apiRef.current = null; };
  }, [simpul, garis, ukuran, lebar, tinggi, radial, antiTumpuk, kunciFit]);

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
    const z = d3zoom<SVGSVGElement, unknown>().scaleExtent([0.1, 3]).on("zoom", (e) => setTrf(e.transform));
    zoomRef.current = z;
    const sel = select(svgRef.current);
    sel.call(z);
    sel.on("dblclick.zoom", null);
    return () => { sel.on(".zoom", null); };
  }, []);

  // "Pas-kan" = masukkan isi ke dalam bingkai, dihitung dari kotak LABEL bukan
  // titik simpul. Mengembalikan zoom ke identitas bukan hal yang sama: graf yang
  // melayang jauh dari titik asal tetap di luar layar setelah "reset".
  const paskan = useCallback((auto = false) => {
    if (!svgRef.current || !zoomRef.current) return;
    const p = posRef.current;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    let akarX = 0, akarY = 0, jumlahAkar = 0;
    for (const s of simpul) {
      const t = p.get(s.id), u = ukuran.get(s.id);
      if (!t || !u) continue;
      x0 = Math.min(x0, t.x - u.halfW); x1 = Math.max(x1, t.x + u.halfW);
      y0 = Math.min(y0, t.y + u.cy - u.halfH); y1 = Math.max(y1, t.y + u.cy + u.halfH);
      if (s.depth === 0) { akarX += t.x; akarY += t.y; jumlahAkar++; }
    }
    if (!Number.isFinite(x0)) return;
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
    const muat = Math.min(lebar / (bw + 48), tinggi / (bh + 48), 1.4);
    const k = Math.max(muat, auto ? SKALA_AUTO_MIN : SKALA_MANUAL_MIN);
    // Kalau pada skala minimum isinya tak muat, jangan pusatkan ke tengah kotak
    // pembatas — pusatkan ke akar/inti, supaya yang terlihat adalah pangkal
    // gambar dan orang tahu harus menggeser ke mana.
    const pusat = k > muat && jumlahAkar > 0
      ? { x: akarX / jumlahAkar, y: akarY / jumlahAkar }
      : { x: x0 + bw / 2, y: y0 + bh / 2 };
    select(svgRef.current).call(
      zoomRef.current.transform,
      zoomIdentity.translate(lebar / 2 - k * pusat.x, tinggi / 2 - k * pusat.y).scale(k),
    );
  }, [simpul, ukuran, lebar, tinggi]);
  // Lewat ref supaya handler tick (dipasang sekali per simulasi) memanggil versi
  // terbaru tanpa membangun ulang simulasinya.
  useEffect(() => { paskanRef.current = paskan; }, [paskan]);

  // Seret pakai pointer event React, bukan d3-drag: dua pustaka yang memegang
  // simpul DOM yang sama adalah sumber bug yang tak perlu di sini.
  const seret = useRef<string | null>(null);
  const mulaiSeret = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    seret.current = id;
  };
  const selamaSeret = (e: React.PointerEvent) => {
    if (!seret.current || !svgRef.current) return;
    const kotak = svgRef.current.getBoundingClientRect();
    apiRef.current?.seret(
      seret.current,
      (e.clientX - kotak.left - trf.x) / trf.k,
      (e.clientY - kotak.top - trf.y) / trf.k,
    );
  };
  const akhirSeret = () => {
    if (!seret.current) return;
    apiRef.current?.lepas(seret.current);
    seret.current = null;
  };

  const tetangga = useMemo(() => {
    if (!fokus) return null;
    const set = new Set<string>([fokus]);
    for (const g of garis) {
      if (g.source === fokus) set.add(g.target);
      if (g.target === fokus) set.add(g.source);
    }
    return set;
  }, [fokus, garis]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <span className="text-xs text-muted-foreground">
          {simpul.length} simpul · {garis.length} garis
        </span>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={() => paskan(false)}>Pas-kan</Button>
        </div>
      </div>

      {legenda}

      <div ref={kotakRef} className="rounded-lg border bg-card" style={{ height: tinggi }}>
        <svg
          ref={svgRef}
          width="100%"
          height={tinggi}
          className="cursor-grab touch-none active:cursor-grabbing"
          role="img"
          aria-label="Graf simpul dan garis"
          onPointerMove={selamaSeret}
          onPointerUp={akhirSeret}
          onPointerLeave={akhirSeret}
        >
          <defs>
            {/* markerUnits="userSpaceOnUse" — tanpa ini ukuran panah ikut
                strokeWidth, sehingga garis tebal menumbuhkan kepala panah
                sebesar simpulnya sendiri. */}
            <marker id="panah" viewBox="0 0 10 10" refX={9} refY={5}
              markerUnits="userSpaceOnUse" markerWidth={9} markerHeight={9}
              orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <g transform={`translate(${trf.x},${trf.y}) scale(${trf.k})`}>
            {garis.map((g) => {
              const a = pos.get(g.source), b = pos.get(g.target);
              const ja = jariPer.get(g.source) ?? 8;
              const jb = jariPer.get(g.target) ?? 8;
              if (!a || !b) return null;
              // Garis dipotong di tepi kedua simpul, bukan di titik pusatnya:
              // kalau tidak, kepala panah tenggelam di dalam simpul tujuan dan
              // arah koordinasi tak terbaca.
              const dx = b.x - a.x, dy = b.y - a.y;
              const d = Math.hypot(dx, dy) || 1;
              const ux = dx / d, uy = dy / d;
              const hirarki = g.jenis === "hirarki";
              const mulaiR = ja + 2, akhirR = jb + (hirarki ? 2 : 7);
              if (d <= mulaiR + akhirR) return null;
              const redup = tetangga ? !(tetangga.has(g.source) && tetangga.has(g.target)) : false;
              return (
                <line
                  key={g.id}
                  x1={a.x + ux * mulaiR} y1={a.y + uy * mulaiR}
                  x2={b.x - ux * akhirR} y2={b.y - uy * akhirR}
                  className={hirarki ? "stroke-border" : "stroke-muted-foreground"}
                  strokeWidth={hirarki ? 1.5 : Math.min(4, 1 + (g.bobot ?? 1) * 0.45)}
                  strokeOpacity={redup ? 0.07 : hirarki ? 0.9 : g.sepihak ? 0.4 : 0.5}
                  strokeDasharray={g.sepihak ? "5 4" : undefined}
                  markerEnd={hirarki ? undefined : "url(#panah)"}
                />
              );
            })}
            {simpul.map((n) => {
              const t = pos.get(n.id);
              const u = ukuran.get(n.id);
              if (!t || !u) return null;
              const redup = tetangga ? !tetangga.has(n.id) : false;
              const aktif = fokus === n.id;
              const disorot = sorot?.has(n.id) ?? false;
              const jr = n.jari;
              const gores = aktif ? "stroke-foreground" : "stroke-card";
              return (
                <g
                  key={n.id}
                  transform={`translate(${t.x},${t.y})`}
                  opacity={redup ? 0.15 : 1}
                  className="cursor-pointer"
                  onPointerDown={(e) => mulaiSeret(e, n.id)}
                  onClick={(e) => { e.stopPropagation(); onKlik(n.id); }}
                >
                  {disorot && <circle r={jr + 7} className="fill-warning/25" />}
                  {/* Cabang yang masih tertutup diberi cincin putus-putus —
                      penanda "ada isinya" yang tak memakai warna, jadi tetap
                      terbaca berdampingan dengan makna warna yang lain. */}
                  {n.punyaAnak && !n.terbuka && (
                    <circle r={jr + 4} fill="none" className="stroke-muted-foreground"
                      strokeWidth={1} strokeDasharray="2 3" />
                  )}
                  {n.bentuk === "divisi" || n.bentuk === "root" ? (
                    <rect x={-jr} y={-jr} width={jr * 2} height={jr * 2} rx={4}
                      fill={n.warna ?? "none"}
                      className={n.warna ? gores : "stroke-muted-foreground"} strokeWidth={2} />
                  ) : n.bentuk === "luar" ? (
                    <rect x={-jr} y={-jr} width={jr * 2} height={jr * 2} rx={2}
                      fill={n.warna ?? "none"} transform="rotate(45)"
                      className={n.warna ? gores : "stroke-muted-foreground"} strokeWidth={2} />
                  ) : n.bentuk === "tak-kenal" ? (
                    <circle r={jr} fill="none" className="stroke-muted-foreground"
                      strokeWidth={2} strokeDasharray="3 3" />
                  ) : n.bentuk === "grup" || n.bentuk === "sop" ? (
                    <rect x={-jr} y={-jr} width={jr * 2} height={jr * 2} rx={2} fill="none"
                      className="stroke-muted-foreground" strokeWidth={2} />
                  ) : n.bentuk === "langkah" || n.bentuk === "tugas" ? (
                    <rect x={-jr} y={-jr} width={jr * 2} height={jr * 2} rx={2}
                      fill={n.warna ?? "none"}
                      className={n.warna ? gores : "stroke-muted-foreground"}
                      strokeWidth={1.5}
                      strokeDasharray={n.warna ? undefined : "2 2"} />
                  ) : (
                    <circle r={jr} fill={n.warna ?? "none"}
                      className={n.warna ? gores : "stroke-muted-foreground"} strokeWidth={2} />
                  )}
                  {/* Label SELALU tampil — identitas simpul tidak boleh
                      bergantung pada warna semata. Digaris luar dengan warna
                      kartu supaya tetap terbaca kalau kebetulan jatuh di atas
                      garis: gaya kotak menjauhkan label dari label lain, tapi
                      garis penghubung tetap bisa lewat di bawahnya. */}
                  <text
                    y={jr + 13}
                    textAnchor="middle"
                    paintOrder="stroke"
                    stroke="var(--card)"
                    strokeWidth={3.5}
                    strokeLinejoin="round"
                    className={`pointer-events-none text-[11px] ${aktif ? "fill-foreground font-medium" : "fill-foreground/80"}`}
                  >
                    {u.baris.map((b, i) => (
                      <tspan key={i} x={0} dy={i === 0 ? 0 : TINGGI_BARIS}>{b}</tspan>
                    ))}
                  </text>
                  <title>{n.label}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <p className="text-xs text-muted-foreground">
        Klik simpul untuk membuka/menutup cabangnya, seret untuk merapikan, scroll untuk memperbesar.
        {!antiTumpuk && (
          <>
            {" "}
            <strong>Perapian label mati</strong> di atas {AMBANG_ANTI_TUMPUK} simpul (sekarang{" "}
            {simpul.length}) — tutup sebagian cabang supaya tulisannya tidak bertumpuk lagi.
          </>
        )}
        {catatan ? <> {catatan}</> : null}
      </p>
    </div>
  );
}
