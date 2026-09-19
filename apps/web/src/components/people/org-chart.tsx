"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ForceGraf, type GarisViz, type SimpulViz } from "@/components/picform/spider/force-canvas";
import type { Dept, EmployeeItem } from "@/components/people/employee-spine-manager";

// F129 Org Chart sebagai FORCE TREE RADIAL — akar di tengah, tiap tingkat di
// cincinnya sendiri, dibuka bertahap.
//
// Sebelumnya menu ini grid kartu per departemen. Grid tak pernah menampilkan
// GARIS-nya — siapa di bawah siapa — padahal itu satu-satunya hal yang dicari
// orang dari sebuah org chart; jumlah anggota per kotak sudah ada di menu
// Karyawan.
//
// MEMAKAI MESIN YANG SAMA dengan dua tab /network (spider/force-canvas.tsx),
// bukan d3.tree sendiri. Seluruh aturan keterbacaan yang mahal didapat sudah
// tinggal di mesin itu: anti-tumpuk berbasis KOTAK LABEL (bukan lingkaran),
// pas-kan yang menolak mengecilkan teks di bawah ambang baca, posisi yang
// bertahan saat cabang dibuka, garis dipotong di tepi simpul. Menyalakan
// tata letak kedua di sini berarti semua itu harus ditulis ulang, dan cepat
// atau lambat satu layar ketinggalan dari yang lain.
//
// WARNA HANYA MENGKODEKAN DEPARTEMEN — di KEDUA mode, termasuk Reporting Line
// (warnanya dicari lewat dept_label → department.color). Jenis simpul dibedakan
// lewat BENTUK, dan data yang belum beres lewat lingkaran putus-putus, supaya
// bolong terbaca sebagai bolong dan bukan sebagai warna kesekian.

interface OrgReport { id: string; nama: string; role: string | null; dept_label: string | null }
export interface OrgReporting {
  hods: { key: string; name: string; role: string; reports: OrgReport[] }[];
  ambiguous: (OrgReport & { hod_names: string[] })[];
  unmapped: (OrgReport & { atasan_raw: string })[];
  counts: { total: number; mapped: number; ambiguous: number; unmapped: number };
}

type Jenis = "root" | "dept" | "hod" | "orang" | "masalah";

interface Simpul {
  id: string;
  jenis: Jenis;
  label: string;
  /** keterangan singkat; tampil di panel kanan, bukan di kanvas */
  sub?: string | null;
  /** warna departemen — satu-satunya sumbu warna di bagan ini */
  warna?: string | null;
  /** simpul yang datanya belum beres → lingkaran putus-putus */
  masalah?: boolean;
  detail?: { k: string; v: string }[];
  anak: Simpul[];
}

const JARI: Record<Jenis, number> = { root: 13, dept: 11, hod: 10, orang: 6, masalah: 9 };
const BENTUK: Record<Jenis, SimpulViz["bentuk"]> = {
  root: "root", dept: "divisi", hod: "posisi", orang: "posisi", masalah: "tak-kenal",
};

// ── penyusun pohon ────────────────────────────────────────────────────────
// Dua mode = dua bentuk pohon dari dua sumber berbeda; keduanya berakar di satu
// simpul perusahaan supaya jumlah daun selalu bisa diadu dengan total karyawan.
// Kalau tidak, cabang yang hilang tak kelihatan hilang.

function pohonDept(departments: Dept[], employees: EmployeeItem[]): Simpul {
  const byDept = new Map<string, EmployeeItem[]>();
  for (const e of employees) {
    const k = e.dept ?? "_none";
    if (!byDept.has(k)) byDept.set(k, []);
    byDept.get(k)!.push(e);
  }

  const orang = (m: EmployeeItem, warna: string | null): Simpul => ({
    id: `e:${m.id}`,
    jenis: m.roster_pending ? "masalah" : "orang",
    label: m.nama,
    sub: m.role,
    warna: m.roster_pending ? null : warna,
    masalah: m.roster_pending,
    detail: [
      { k: "Jabatan", v: m.role ?? "— belum diisi" },
      { k: "Departemen", v: m.dept_label ?? "— belum diisi" },
      { k: "Cabang", v: m.cabang ?? "—" },
      { k: "Lokasi", v: m.lokasi ?? "—" },
      { k: "KPI tercatat", v: String(m.kpi_count) },
      ...(m.roster_pending ? [{ k: "Catatan", v: "Belum tertaut roster (roster_pending)." }] : []),
    ],
    anak: [],
  });

  const cabang: Simpul[] = [...departments]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((d) => {
      const anggota = byDept.get(d.key) ?? [];
      return {
        id: `d:${d.key}`,
        // Departemen terdaftar tapi nol karyawan tetap ditampilkan — itu temuan,
        // bukan baris kosong yang layak disembunyikan.
        jenis: (anggota.length === 0 ? "masalah" : "dept") as Jenis,
        label: d.label,
        sub: `${anggota.length} orang`,
        warna: anggota.length === 0 ? null : d.color,
        masalah: anggota.length === 0,
        detail: [
          { k: "Anggota", v: String(anggota.length) },
          ...(anggota.length === 0
            ? [{ k: "Catatan", v: "Departemen terdaftar tapi belum ada karyawan tertaut." }]
            : []),
        ],
        anak: anggota.map((m) => orang(m, d.color)),
      };
    });

  const tanpa = byDept.get("_none") ?? [];
  if (tanpa.length) {
    cabang.push({
      id: "d:_none",
      jenis: "masalah",
      label: "Tanpa departemen",
      sub: `${tanpa.length} orang`,
      masalah: true,
      detail: [{ k: "Kenapa di sini", v: "Kolom dept karyawan ini kosong di Employee Spine." }],
      anak: tanpa.map((m) => orang(m, null)),
    });
  }

  const terisi = cabang.filter((c) => c.anak.length).length;
  return {
    id: "root",
    jenis: "root",
    label: "PT WRG",
    sub: `${employees.length} karyawan · ${terisi} departemen terisi`,
    detail: [
      { k: "Karyawan", v: String(employees.length) },
      { k: "Departemen terisi", v: `${terisi} dari ${departments.length}` },
    ],
    anak: cabang,
  };
}

function pohonReporting(r: OrgReporting, warnaDept: (label: string | null) => string | null): Simpul {
  const laporan = (m: OrgReport, tambahan: { k: string; v: string }[] = [], masalah = false): Simpul => ({
    id: `r:${m.id}`,
    jenis: masalah ? "masalah" : "orang",
    label: m.nama,
    sub: m.role,
    warna: masalah ? null : warnaDept(m.dept_label),
    masalah,
    detail: [
      { k: "Jabatan", v: m.role ?? "— belum diisi" },
      { k: "Departemen", v: m.dept_label ?? "— belum diisi" },
      ...tambahan,
    ],
    anak: [],
  });

  const anak: Simpul[] = r.hods
    .filter((h) => h.reports.length > 0)
    .map((h) => ({
      id: `h:${h.key}`,
      jenis: "hod" as const,
      label: h.name,
      sub: `${h.role} · ${h.reports.length} orang`,
      warna: "var(--viz-internal)",
      detail: [
        { k: "Jabatan", v: h.role },
        { k: "Bawahan langsung", v: String(h.reports.length) },
      ],
      anak: h.reports.map((m) => laporan(m)),
    }));

  // Ambigu & belum ter-mapping digantung sebagai CABANG, bukan disimpan di kartu
  // terpisah di bawah bagan: hanya dengan begitu jumlah daun di bawah akar sama
  // dengan total karyawan, dan orang yang "hilang" dari garis pelaporan terlihat
  // di bagan yang sama — bukan di tempat yang harus diingat untuk dilihat.
  if (r.ambiguous.length) {
    anak.push({
      id: "x:ambigu",
      jenis: "masalah",
      label: "Ambigu — multi-HOD",
      sub: `${r.ambiguous.length} orang`,
      masalah: true,
      detail: [{ k: "Kenapa di sini", v: "Teks atasan di form cocok ke lebih dari satu HoD, jadi resolver menolak menebak." }],
      anak: r.ambiguous.map((m) => laporan(m, [{ k: "Calon atasan", v: m.hod_names.join(" / ") }], true)),
    });
  }
  if (r.unmapped.length) {
    anak.push({
      id: "x:belum",
      jenis: "masalah",
      label: "Belum ter-mapping",
      sub: `${r.unmapped.length} orang`,
      masalah: true,
      detail: [{ k: "Kenapa di sini", v: "Teks atasan kosong atau tak cocok dengan satu pun HoD terdaftar." }],
      anak: r.unmapped.map((m) =>
        laporan(m, [{ k: "Atasan (apa adanya)", v: m.atasan_raw || "— tak disebut" }], true),
      ),
    });
  }

  const c = r.counts;
  return {
    id: "root",
    jenis: "root",
    label: "PT WRG",
    sub: `${c.mapped}/${c.total} ter-mapping · ${c.ambiguous} ambigu · ${c.unmapped} belum`,
    detail: [
      { k: "Ter-mapping ke HoD", v: `${c.mapped} dari ${c.total}` },
      { k: "Ambigu", v: String(c.ambiguous) },
      { k: "Belum ter-mapping", v: String(c.unmapped) },
    ],
    anak,
  };
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
  const pakaiReporting = mode === "reporting" && !!reporting;

  // Reporting Line hanya menyimpan NAMA departemen di tiap orang, bukan
  // warnanya; dipetakan lewat label supaya sumbu warna tetap satu di dua mode.
  const warnaDept = useMemo(() => {
    const peta = new Map(departments.map((d) => [d.label, d.color]));
    return (label: string | null) => (label ? peta.get(label) ?? null : null);
  }, [departments]);

  const akar = useMemo(
    () => (pakaiReporting && reporting ? pohonReporting(reporting, warnaDept) : pohonDept(departments, employees)),
    [pakaiReporting, reporting, departments, employees, warnaDept],
  );

  const { semua, induk } = useMemo(() => {
    const semua = new Map<string, Simpul>();
    const induk = new Map<string, string>();
    const jalan = (s: Simpul) => {
      semua.set(s.id, s);
      for (const a of s.anak) { induk.set(a.id, s.id); jalan(a); }
    };
    jalan(akar);
    return { semua, induk };
  }, [akar]);

  // Default: HANYA akar yang terbuka — tampil 1 + departemen (atau + HoD). 63
  // karyawan sekaligus membuat pas-kan otomatis mengecilkan gambar sampai
  // namanya tak terbaca, dan gagal karena terlalu kecil sama saja dengan gagal
  // karena bertumpuk.
  const [buka, setBuka] = useState<Set<string>>(() => new Set(["root"]));
  const [pilih, setPilih] = useState<string | null>(null);
  const [cari, setCari] = useState("");

  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (q.length < 2) return null;
    // Jabatan ikut dicari: "siapa saja yang jadi admin" adalah pertanyaan yang
    // dibawa orang ke org chart, dan jabatan tak pernah tampil di kanvas.
    return new Set(
      [...semua.values()]
        .filter((s) => s.label.toLowerCase().includes(q) || (s.sub ?? "").toLowerCase().includes(q))
        .map((s) => s.id),
    );
  }, [cari, semua]);

  // Pencarian MEMBUKA jalurnya, bukan menyaring pohonnya — menyaring membuang
  // konteks "orang ini di departemen apa / di bawah siapa", justru yang dicari.
  // Dihitung saat render, bukan lewat efek yang memanggil setState: keadaan
  // pohon tetap satu, hasil pencarian cuma lapisan turunan.
  const bukaEfektif = useMemo(() => {
    if (!cocok || cocok.size === 0) return buka;
    const s = new Set(buka);
    for (const id of cocok) {
      let p = induk.get(id);
      while (p) { s.add(p); p = induk.get(p); }
    }
    return s;
  }, [buka, cocok, induk]);

  const { simpul, garis } = useMemo(() => {
    const simpul: SimpulViz[] = [];
    const garis: GarisViz[] = [];
    const jalan = (s: Simpul, depth: number) => {
      simpul.push({
        id: s.id,
        label: s.label,
        bentuk: BENTUK[s.jenis],
        depth,
        jari: JARI[s.jenis],
        warna: s.jenis === "root" ? "var(--viz-internal)" : s.warna ?? null,
        punyaAnak: s.anak.length > 0,
        terbuka: bukaEfektif.has(s.id),
      });
      if (!bukaEfektif.has(s.id)) return;
      for (const a of s.anak) {
        garis.push({ id: `${s.id}->${a.id}`, source: s.id, target: a.id, jenis: "hirarki" });
        jalan(a, depth + 1);
      }
    };
    jalan(akar, 0);
    return { simpul, garis };
  }, [akar, bukaEfektif]);

  const klik = (id: string) => {
    setPilih(id);
    const s = semua.get(id);
    if (!s || s.anak.length === 0) return;
    setBuka(() => {
      // Bertolak dari bukaEfektif: begitu orang menyentuh pohon, cabang yang
      // terbuka karena pencarian ikut jadi keadaan sungguhan — kalau tidak,
      // menutupnya tak akan ada efeknya.
      const baru = new Set(bukaEfektif);
      if (baru.has(id)) {
        // Menutup cabang ikut menutup seluruh isinya; kalau tidak, membukanya
        // lagi akan meledak ke keadaan lama yang sudah tak diingat siapa pun.
        const tutup = (n: Simpul) => { baru.delete(n.id); n.anak.forEach(tutup); };
        tutup(s);
      } else baru.add(id);
      return baru;
    });
  };

  const gantiMode = (m: "dept" | "reporting") => {
    // Pohon lain sama sekali (id-nya pun beda awalan), jadi keadaan buka/pilih
    // dari pohon sebelumnya tak punya arti di sini.
    setMode(m);
    setBuka(new Set(["root"]));
    setPilih(null);
    setCari("");
  };

  const terpilih = pilih ? semua.get(pilih) ?? null : null;
  const deptBerwarna = useMemo(
    () => [...departments].filter((d) => d.color).sort((a, b) => a.label.localeCompare(b.label)),
    [departments],
  );
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
                cabang tersendiri — bukan disembunyikan — supaya jumlah daun di bawah akar tetap sama
                dengan total karyawan.
              </>
            ) : (
              <>
                Struktur per departemen dari Employee Spine (F118). Akar di tengah, tiap tingkat di
                cincinnya sendiri. Klik simpul untuk membuka cabangnya (yang masih tertutup bercincin
                putus-putus), seret untuk merapikan, scroll untuk memperbesar.
              </>
            )}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <CardContent className="pt-6">
            <ForceGraf
              simpul={simpul}
              garis={garis}
              radial
              fokus={pilih}
              sorot={cocok}
              onKlik={klik}
              kunciFit={mode}
              toolbar={
                <>
                  <Input
                    value={cari}
                    onChange={(e) => setCari(e.target.value)}
                    placeholder="Cari nama / jabatan…"
                    className="h-8 max-w-xs"
                  />
                  {cocok && (
                    <span className="text-xs text-muted-foreground">
                      {cocok.size} cocok{cocok.size > 0 ? " — jalurnya dibuka" : ""}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBuka(new Set(["root", ...akar.anak.map((d) => d.id)]))}
                  >
                    {pakaiReporting ? "Buka semua HoD" : "Buka semua departemen"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBuka(new Set(["root"]))}>
                    Tutup semua
                  </Button>
                </>
              }
              legenda={
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {/* Legenda WAJIB ada selama warna membawa arti: di sini warna =
                      departemen, dan tanpa legenda ia cuma jadi titik warna-warni. */}
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
                    <span className="inline-block size-3 rounded-full border border-dashed border-muted-foreground" />
                    {pakaiReporting ? "atasan ambigu / belum ter-mapping" : "tanpa departemen / belum tertaut roster"}
                  </span>
                </div>
              }
              catatan={`Tampil ${simpul.length} dari ${semua.size} simpul.`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {!terpilih ? (
              <p className="text-sm text-muted-foreground">
                Belum ada simpul dipilih. Klik salah satu untuk membaca rinciannya — jabatan,
                departemen, cabang/lokasi, dan jumlah KPI yang tercatat untuk orang itu.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {jenisLabel[terpilih.jenis]}
                  </div>
                  <div className="mt-1 text-sm font-medium">{terpilih.label}</div>
                  {terpilih.sub && <div className="text-xs text-muted-foreground">{terpilih.sub}</div>}
                </div>
                <dl className="space-y-2 text-sm">
                  {(terpilih.detail ?? []).map((x) => (
                    <div key={x.k}>
                      <dt className="text-xs text-muted-foreground">{x.k}</dt>
                      <dd className="whitespace-pre-wrap">{x.v}</dd>
                    </div>
                  ))}
                </dl>
                {terpilih.anak.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {terpilih.anak.length} cabang di bawahnya —{" "}
                    {bukaEfektif.has(terpilih.id) ? "terbuka" : "klik simpulnya untuk membuka"}.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
