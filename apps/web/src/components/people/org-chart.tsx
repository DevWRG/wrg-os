"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrgChart as D3OrgChart } from "d3-org-chart";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Dept, EmployeeItem } from "@/components/people/employee-spine-manager";

// F129 Org Chart — bagan organisasi klasik (kotak bertingkat, garis siku)
// memakai d3-org-chart (bumbeishvili, MIT).
//
// KENAPA LIBRARY, BUKAN ForceGraf SEPERTI /network: force tree radial bagus
// untuk MENJELAJAHI graf yang bentuknya belum diketahui — itu memang tugas
// /network. Org chart dipakai untuk hal yang berlawanan: bentuknya SUDAH
// diketahui dan harus terbaca sekali lihat, dengan tingkatan sejajar dan kotak
// berisi identitas orang (nama, jabatan, cabang). Simpul bulat berlabel tak
// pernah bisa memuat itu, dan tata letak yang bergerak membuat dua orang yang
// setingkat tak pernah tampak setingkat.
//
// LIBRARY INI MEMILIKI DOM-NYA SENDIRI (d3-selection meng-enter/exit di dalam
// container), menyimpang dari aturan "D3 menghitung, React menggambar" yang
// dipakai spider/force-canvas.tsx. Penyimpangannya disengaja dan DIKURUNG: React
// hanya menyediakan satu <div> kosong dan tak pernah merender apa pun di
// dalamnya, jadi tak ada simpul yang diperebutkan dua pihak. Semua yang React
// kendalikan (toolbar, legenda, panel detail) hidup di luar container itu.
//
// KONTEN KOTAK DISUNTIKKAN SEBAGAI STRING HTML (satu-satunya cara library ini
// menerima isi simpul). Karena itu setiap nilai dari basis data WAJIB lewat
// esc() — nama karyawan adalah data yang bisa diubah orang lewat menu Karyawan,
// dan tanpa escape sebuah nama berisi < > cukup untuk menyuntikkan markup.

interface OrgReport { id: string; nama: string; role: string | null; dept_label: string | null }
export interface OrgReporting {
  hods: { key: string; name: string; role: string; reports: OrgReport[] }[];
  ambiguous: (OrgReport & { hod_names: string[] })[];
  unmapped: (OrgReport & { atasan_raw: string })[];
  counts: { total: number; mapped: number; ambiguous: number; unmapped: number };
}

type Jenis = "root" | "dept" | "hod" | "orang" | "masalah";

/** Satu baris data datar — d3-org-chart menyusun hierarkinya dari parentId. */
interface Node {
  id: string;
  parentId: string | null;
  jenis: Jenis;
  nama: string;
  /** baris kedua di kotak: jabatan, atau jumlah anggota untuk simpul grup */
  sub: string | null;
  /** baris ketiga, lebih redup: cabang/lokasi atau departemen */
  ket: string | null;
  warna: string | null;
  detail: { k: string; v: string }[];
  /** DITEMPELKAN library ke tiap datum saat render (jumlah bawahan langsung).
   *  Bukan milik kita — karena itu opsional, dan jangan pernah diisi manual. */
  _directSubordinates?: number;
}

const TINGGI = 660;
const LEBAR_KOTAK = 224;
const TINGGI_KOTAK = 96;

/** WAJIB dipakai untuk SEMUA nilai yang masuk ke nodeContent. Lihat catatan
 *  di kepala berkas: isi kotak adalah string HTML yang disuntikkan apa adanya. */
function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── penyusun data ─────────────────────────────────────────────────────────
// Dua mode = dua susunan dari dua sumber berbeda; keduanya berakar di satu
// simpul perusahaan supaya jumlah daun selalu bisa diadu dengan total karyawan.
// Kalau tidak, cabang yang hilang tak kelihatan hilang.

function dataDept(departments: Dept[], employees: EmployeeItem[]): Node[] {
  const byDept = new Map<string, EmployeeItem[]>();
  for (const e of employees) {
    const k = e.dept ?? "_none";
    if (!byDept.has(k)) byDept.set(k, []);
    byDept.get(k)!.push(e);
  }

  const terisi = [...byDept.keys()].filter((k) => k !== "_none").length;
  const out: Node[] = [{
    id: "root",
    parentId: null,
    jenis: "root",
    nama: "PT WRG",
    sub: `${employees.length} karyawan`,
    ket: `${terisi} dari ${departments.length} departemen terisi`,
    warna: null,
    detail: [
      { k: "Karyawan", v: String(employees.length) },
      { k: "Departemen terisi", v: `${terisi} dari ${departments.length}` },
    ],
  }];

  const orang = (m: EmployeeItem, parentId: string, warna: string | null): Node => ({
    id: `e:${m.id}`,
    parentId,
    jenis: m.roster_pending ? "masalah" : "orang",
    nama: m.nama,
    sub: m.role,
    ket: [m.cabang, m.lokasi].filter(Boolean).join(" · ") || null,
    warna: m.roster_pending ? null : warna,
    detail: [
      { k: "Jabatan", v: m.role ?? "— belum diisi" },
      { k: "Departemen", v: m.dept_label ?? "— belum diisi" },
      { k: "Cabang", v: m.cabang ?? "—" },
      { k: "Lokasi", v: m.lokasi ?? "—" },
      { k: "KPI tercatat", v: String(m.kpi_count) },
      ...(m.roster_pending ? [{ k: "Catatan", v: "Belum tertaut roster (roster_pending)." }] : []),
    ],
  });

  for (const d of [...departments].sort((a, b) => a.label.localeCompare(b.label))) {
    const anggota = byDept.get(d.key) ?? [];
    // Departemen terdaftar tapi nol karyawan tetap ditampilkan — itu temuan,
    // bukan baris kosong yang layak disembunyikan.
    out.push({
      id: `d:${d.key}`,
      parentId: "root",
      jenis: anggota.length === 0 ? "masalah" : "dept",
      nama: d.label,
      sub: `${anggota.length} orang`,
      ket: anggota.length === 0 ? "belum ada karyawan tertaut" : null,
      warna: anggota.length === 0 ? null : d.color,
      detail: [
        { k: "Anggota", v: String(anggota.length) },
        ...(anggota.length === 0
          ? [{ k: "Catatan", v: "Departemen terdaftar tapi belum ada karyawan tertaut." }]
          : []),
      ],
    });
    for (const m of anggota) out.push(orang(m, `d:${d.key}`, d.color));
  }

  const tanpa = byDept.get("_none") ?? [];
  if (tanpa.length) {
    out.push({
      id: "d:_none",
      parentId: "root",
      jenis: "masalah",
      nama: "Tanpa departemen",
      sub: `${tanpa.length} orang`,
      ket: "kolom dept kosong di Employee Spine",
      warna: null,
      detail: [{ k: "Kenapa di sini", v: "Kolom dept karyawan ini kosong di Employee Spine." }],
    });
    for (const m of tanpa) out.push(orang(m, "d:_none", null));
  }

  return out;
}

function dataReporting(r: OrgReporting, warnaDept: (label: string | null) => string | null): Node[] {
  const c = r.counts;
  const out: Node[] = [{
    id: "root",
    parentId: null,
    jenis: "root",
    nama: "PT WRG",
    sub: `${c.mapped}/${c.total} ter-mapping`,
    ket: `${c.ambiguous} ambigu · ${c.unmapped} belum`,
    warna: null,
    detail: [
      { k: "Ter-mapping ke HoD", v: `${c.mapped} dari ${c.total}` },
      { k: "Ambigu", v: String(c.ambiguous) },
      { k: "Belum ter-mapping", v: String(c.unmapped) },
    ],
  }];

  const laporan = (
    m: OrgReport, parentId: string, tambahan: { k: string; v: string }[] = [], masalah = false,
  ): Node => ({
    id: `r:${m.id}`,
    parentId,
    jenis: masalah ? "masalah" : "orang",
    nama: m.nama,
    sub: m.role,
    ket: m.dept_label,
    warna: masalah ? null : warnaDept(m.dept_label),
    detail: [
      { k: "Jabatan", v: m.role ?? "— belum diisi" },
      { k: "Departemen", v: m.dept_label ?? "— belum diisi" },
      ...tambahan,
    ],
  });

  for (const h of r.hods.filter((x) => x.reports.length > 0)) {
    out.push({
      id: `h:${h.key}`,
      parentId: "root",
      jenis: "hod",
      nama: h.name,
      sub: h.role,
      ket: `${h.reports.length} bawahan langsung`,
      warna: "var(--viz-internal)",
      detail: [
        { k: "Jabatan", v: h.role },
        { k: "Bawahan langsung", v: String(h.reports.length) },
      ],
    });
    for (const m of h.reports) out.push(laporan(m, `h:${h.key}`));
  }

  // Ambigu & belum ter-mapping digantung sebagai CABANG, bukan disimpan di kartu
  // terpisah di bawah bagan: hanya dengan begitu jumlah daun di bawah akar sama
  // dengan total karyawan, dan orang yang "hilang" dari garis pelaporan terlihat
  // di bagan yang sama — bukan di tempat yang harus diingat untuk dilihat.
  if (r.ambiguous.length) {
    out.push({
      id: "x:ambigu", parentId: "root", jenis: "masalah",
      nama: "Ambigu — multi-HOD", sub: `${r.ambiguous.length} orang`,
      ket: "cocok ke lebih dari satu HoD", warna: null,
      detail: [{ k: "Kenapa di sini", v: "Teks atasan di form cocok ke lebih dari satu HoD, jadi resolver menolak menebak." }],
    });
    for (const m of r.ambiguous) {
      out.push(laporan(m, "x:ambigu", [{ k: "Calon atasan", v: m.hod_names.join(" / ") }], true));
    }
  }
  if (r.unmapped.length) {
    out.push({
      id: "x:belum", parentId: "root", jenis: "masalah",
      nama: "Belum ter-mapping", sub: `${r.unmapped.length} orang`,
      ket: "atasan kosong / tak dikenali", warna: null,
      detail: [{ k: "Kenapa di sini", v: "Teks atasan kosong atau tak cocok dengan satu pun HoD terdaftar." }],
    });
    for (const m of r.unmapped) {
      out.push(laporan(m, "x:belum", [{ k: "Atasan (apa adanya)", v: m.atasan_raw || "— tak disebut" }], true));
    }
  }

  return out;
}

export function OrgChart({
  departments,
  employees,
  reporting,
}: {
  departments: Dept[];
  employees: EmployeeItem[];
  reporting?: OrgReporting | null;
}) {
  const [mode, setMode] = useState<"dept" | "reporting">("dept");
  const [pilih, setPilih] = useState<string | null>(null);
  const [cari, setCari] = useState("");
  const pakaiReporting = mode === "reporting" && !!reporting;

  const kotakRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<D3OrgChart<Node> | null>(null);

  // Reporting Line hanya menyimpan NAMA departemen di tiap orang, bukan
  // warnanya; dipetakan lewat label supaya sumbu warna tetap satu di dua mode.
  const warnaDept = useMemo(() => {
    const peta = new Map(departments.map((d) => [d.label, d.color]));
    return (label: string | null) => (label ? peta.get(label) ?? null : null);
  }, [departments]);

  const data = useMemo(
    () => (pakaiReporting && reporting
      ? dataReporting(reporting, warnaDept)
      : dataDept(departments, employees)),
    [pakaiReporting, reporting, departments, employees, warnaDept],
  );

  const peta = useMemo(() => new Map(data.map((n) => [n.id, n])), [data]);

  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (q.length < 2) return null;
    // Jabatan ikut dicari: "siapa saja yang jadi admin" adalah pertanyaan yang
    // dibawa orang ke org chart.
    return data.filter((n) =>
      n.nama.toLowerCase().includes(q) || (n.sub ?? "").toLowerCase().includes(q));
  }, [cari, data]);

  // Bagannya dibangun SEKALI per mode, lalu hanya disuruh menggambar ulang.
  // Membangun ulang tiap render akan mengembalikan semua cabang ke keadaan awal
  // dan orang kehilangan tempatnya begitu mengetik satu huruf di kotak cari.
  useEffect(() => {
    const el = kotakRef.current;
    if (!el) return;

    const chart = new D3OrgChart<Node>()
      .container(el as unknown as string)
      .data(data)
      .svgHeight(TINGGI)
      .nodeWidth(() => LEBAR_KOTAK)
      .nodeHeight(() => TINGGI_KOTAK)
      .childrenMargin(() => 46)
      .siblingsMargin(() => 18)
      .neighbourMargin(() => 18)
      .compact(false)
      // Hanya akar + tingkat pertama yang terbuka. 63 karyawan sekaligus
      // membuat pas-kan otomatis mengecilkan bagan sampai namanya tak terbaca,
      // dan gagal karena terlalu kecil sama saja dengan gagal karena bertumpuk.
      .initialExpandLevel(1)
      // onNodeClick menerima HierarchyNode, bukan id — `String(d)` di sini
      // menghasilkan "[object Object]" dan panel detail diam-diam selalu kosong.
      .onNodeClick((d) => setPilih(d.data.id))
      .nodeContent((d) => kotak(d.data))
      // node.children terisi HANYA saat cabang terbuka (yang tertutup pindah ke
      // node._children) — itulah penanda buka/tutup yang dipakai library.
      .buttonContent(({ node }) => tombol(!!node.children, node.data._directSubordinates ?? 0))
      .linkUpdate(function (this: SVGPathElement) {
        // Garis diwarnai lewat token tema, bukan hex bawaan library — kalau
        // tidak, bagannya benar di satu mode dan kira-kira di mode lain.
        this.setAttribute("stroke", "var(--border)");
        this.setAttribute("stroke-width", "1.5");
      })
      .render();

    chartRef.current = chart;

    // Library membaca lebar container SEKALI saat render dan tidak memasang
    // pendengar resize apa pun: tanpa ini, memperkecil jendela (atau membuka
    // sidebar) menyisakan <svg> selebar ukuran lama — bagannya terpotong dan
    // tak ada yang menunjukkan kenapa. Lebar saja yang disetel ulang; tinggi
    // dikunci TINGGI supaya tata letak halaman tidak ikut melompat.
    let rafId = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w <= 0) return;
      // Digabung ke satu frame: ResizeObserver menembak per piksel saat jendela
      // diseret, dan render() di tiap tembakan membuat seretan tersendat.
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => chart.svgWidth(w).render());
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chartRef.current = null;
      // Library ini yang memiliki isi container; React tak pernah merender apa
      // pun di dalamnya, jadi membersihkannya sendiri aman dan perlu — tanpa
      // ini, ganti mode meninggalkan dua <svg> bertumpuk.
      el.innerHTML = "";
    };
  }, [data]);

  // Pencarian MENYOROT & memusatkan, bukan menyaring — menyaring membuang
  // konteks "orang ini di departemen apa / di bawah siapa", justru yang dicari.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!cocok || cocok.length === 0) {
      chart.clearHighlighting();
      return;
    }
    chart.clearHighlighting();
    for (const n of cocok) chart.setHighlighted(n.id);
    // Satu-satunya yang dipusatkan adalah hasil pertama; memusatkan semuanya
    // berarti tidak memusatkan apa pun.
    chart.setCentered(cocok[0].id);
  }, [cocok]);

  const terpilih = pilih ? peta.get(pilih) ?? null : null;
  const deptBerwarna = useMemo(
    () => [...departments].filter((d) => d.color).sort((a, b) => a.label.localeCompare(b.label)),
    [departments],
  );

  const gantiMode = (m: "dept" | "reporting") => {
    setMode(m);
    setPilih(null);
    setCari("");
  };

  const expandAll = useCallback(() => chartRef.current?.expandAll().fit(), []);
  const collapseAll = useCallback(() => chartRef.current?.collapseAll().fit(), []);
  const paskan = useCallback(() => chartRef.current?.fit(), []);
  const unduh = useCallback(() => chartRef.current?.exportImg({ full: true }), []);

  const jenisLabel: Record<Jenis, string> = {
    root: "perusahaan", dept: "departemen", hod: "head of department",
    orang: "karyawan", masalah: "perlu dibereskan",
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-2">
            {reporting && (
              <div className="flex w-fit gap-1 rounded-lg border p-1">
                {([["dept", "Per Departemen"], ["reporting", "Reporting Line"]] as const).map(([k, lbl]) => (
                  <button
                    key={k}
                    onClick={() => gantiMode(k)}
                    className={`rounded-md px-3 py-1 text-sm font-medium ${mode === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
            <Badge variant="outline">{employees.length} karyawan</Badge>
            <Badge variant="outline">{departments.length} departemen</Badge>
            {reporting && <Badge variant="outline">{reporting.counts.mapped} ter-mapping ke HoD</Badge>}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {pakaiReporting ? (
              <>
                Garis pelaporan hasil resolver HoD (F121) atas teks atasan di Employee Spine. Yang{" "}
                <strong>ambigu</strong> dan yang <strong>belum ter-mapping</strong> digantung sebagai
                cabang tersendiri — bukan disembunyikan — supaya jumlah kotak di bawah akar tetap
                sama dengan total karyawan.
              </>
            ) : (
              <>
                Struktur per departemen dari Employee Spine (F118). Klik tanda <strong>+</strong> di
                bawah kotak untuk membuka cabangnya, klik kotaknya untuk melihat rincian di panel
                kanan. Geser untuk menggeser kanvas, scroll untuk memperbesar.
              </>
            )}
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
                placeholder="Cari nama / jabatan…"
                className="h-8 max-w-xs"
              />
              {cocok && (
                <span className="text-xs text-muted-foreground">
                  {cocok.length} cocok{cocok.length > 0 ? " — disorot, yang pertama dipusatkan" : ""}
                </span>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={expandAll}>Buka semua</Button>
                <Button size="sm" variant="outline" onClick={collapseAll}>Tutup semua</Button>
                <Button size="sm" variant="outline" onClick={paskan}>Pas-kan</Button>
                <Button size="sm" variant="outline" onClick={unduh}>Unduh PNG</Button>
              </div>
            </div>

            {/* Legenda WAJIB ada selama warna membawa arti: di sini warna =
                departemen, dan tanpa legenda ia cuma jadi pita warna-warni. */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {deptBerwarna.length > 0 && (
                <>
                  <span>Departemen:</span>
                  {deptBerwarna.map((d) => (
                    <span key={d.key} className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-3 rounded-sm" style={{ background: d.color ?? undefined }} />
                      {d.label}
                    </span>
                  ))}
                </>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block size-3 rounded-sm border border-dashed border-muted-foreground" />
                {pakaiReporting ? "atasan ambigu / belum ter-mapping" : "tanpa departemen / belum tertaut roster"}
              </span>
            </div>

            {/* Container MILIK d3-org-chart. React sengaja tidak pernah
                merender anak apa pun di sini — lihat catatan di kepala berkas. */}
            <div
              ref={kotakRef}
              className="rounded-lg border bg-card"
              style={{ height: TINGGI }}
              role="img"
              aria-label={pakaiReporting ? "Bagan garis pelaporan per HoD" : "Bagan organisasi per departemen"}
            />
            <p className="text-xs text-muted-foreground">{data.length - 1} kotak dari 1 akar.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {!terpilih ? (
              <p className="text-sm text-muted-foreground">
                Belum ada kotak dipilih. Klik salah satu untuk membaca rinciannya — jabatan,
                departemen, cabang/lokasi, dan jumlah KPI yang tercatat untuk orang itu.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {jenisLabel[terpilih.jenis]}
                  </div>
                  <div className="mt-1 text-sm font-medium">{terpilih.nama}</div>
                  {terpilih.sub && <div className="text-xs text-muted-foreground">{terpilih.sub}</div>}
                </div>
                <dl className="space-y-2 text-sm">
                  {terpilih.detail.map((x) => (
                    <div key={x.k}>
                      <dt className="text-xs text-muted-foreground">{x.k}</dt>
                      <dd className="whitespace-pre-wrap">{x.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── isi kotak & tombol (string HTML — SEMUA nilai lewat esc()) ─────────────

/** Pita warna di sisi kiri menandai departemen; simpul bermasalah memakai
 *  bingkai putus-putus, bukan warna kesekian, supaya bolong terbaca sebagai
 *  bolong. Warnanya token tema, jadi kedua mode terang/gelap ikut benar. */
function kotak(n: Node): string {
  const masalah = n.jenis === "masalah";
  const pita = n.warna ?? (masalah ? "transparent" : "var(--viz-internal)");
  const besar = n.jenis === "root" || n.jenis === "dept" || n.jenis === "hod";
  return `
    <div style="
      box-sizing:border-box;height:100%;width:100%;display:flex;overflow:hidden;
      border-radius:10px;background:var(--card);
      border:1px ${masalah ? "dashed" : "solid"} var(--border);
      box-shadow:var(--shadow-card);
    ">
      <div style="width:6px;flex:none;background:${esc(pita)}"></div>
      <div style="padding:10px 12px;min-width:0;display:flex;flex-direction:column;gap:2px;justify-content:center">
        <div style="
          font-size:${besar ? 14 : 13}px;font-weight:600;color:var(--card-foreground);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis
        ">${esc(n.nama)}</div>
        ${n.sub ? `<div style="
          font-size:11.5px;color:var(--muted-foreground);
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis
        ">${esc(n.sub)}</div>` : ""}
        ${n.ket ? `<div style="
          font-size:10.5px;color:var(--muted-foreground);opacity:.75;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis
        ">${esc(n.ket)}</div>` : ""}
      </div>
    </div>`;
}

/** Tombol buka/tutup — angkanya jumlah bawahan langsung, supaya "ada isinya
 *  berapa" terbaca tanpa harus membukanya dulu. */
function tombol(terbuka: boolean, jumlah: number): string {
  return `
    <div style="
      display:inline-flex;align-items:center;gap:4px;padding:2px 8px;
      border:1px solid var(--border);border-radius:9999px;background:var(--card);
      font-size:11px;color:var(--muted-foreground);box-shadow:var(--shadow-card)
    ">
      <span style="font-weight:600">${terbuka ? "−" : "+"}</span>
      <span>${esc(String(jumlah))}</span>
    </div>`;
}
