"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

// Jembatan orang → posisi → proses. TAMBAHAN di bawah matriks RACI F120, bukan
// penggantinya.
//
// Dua pertanyaan berbeda atas dua sumber berbeda:
//   F120 (raci_assignment, grain karyawan, turunan transkrip wawancara)
//        → "orang ini terlibat di proses apa saja, sebagai R/A/C/I"
//   bagian ini (posisi_employee + posisi_tugas, grain posisi, dari form PIC)
//        → "orang ini memegang posisi apa, dan posisi itu bertanggung jawab
//           atas berapa proses"
// Keduanya bisa berbeda untuk orang yang sama, dan itu bukan kontradiksi —
// sumbernya beda, waktunya beda, dan penulisnya beda.
//
// 2026-09-19: dua kartu (tertaut & belum) disatukan jadi SATU kartu bertab.
// Keduanya sumber yang sama dan pertanyaan yang sama ("posisi orang ini apa"),
// cuma beda sisi jawabannya — dipisah jadi dua kartu hanya membuat halaman
// panjang dan memaksa mata bolak-balik. Penetapan posisi juga bisa MASSAL:
// 16 dari 22 yang belum dipetakan ada di satu dept (kirimtagih) gara-gara satu
// cacat kapasitas di form, jadi menetapkannya satu per satu adalah 16 klik
// untuk satu keputusan yang sama.

export interface RantaiRow {
  employee_id: string; karyawan: string; panggilan: string | null; dept: string | null;
  cabang: string | null; role_roster: string | null;
  posisi_id: number; posisi: string; jumlah_orang: number | null;
  divisi_key: string; divisi: string; sumber: string; dasar_tautan: string | null;
  proses: number;
}
export interface KandidatPosisi {
  posisi_id: number; posisi: string; divisi: string;
  jumlah_orang: number | null; terpakai: number;
}
export interface GapRow {
  employee_id: string; karyawan: string; panggilan: string | null;
  dept: string | null; role_roster: string | null; alasan: string; kandidat: string | null;
  kandidat_posisi: KandidatPosisi[];
}
export interface RaciKaryawan {
  ringkas: { karyawan_total: number; tertaut: number; belum: number; baris_tautan: number };
  rantai: RantaiRow[];
  gap: GapRow[];
}

interface HasilItem {
  employee_id: string; ok: boolean; error?: string;
  melebihi?: { posisi: string; jumlah_orang: number; terpakai: number };
}

const SUMBER_LABEL: Record<string, string> = {
  nama_di_catatan: "nama di form",
  nama_posisi_di_role: "nama posisi di role",
  alias_jabatan: "alias jabatan",
  manual: "diputuskan orang",
};

export function RaciPosisiBridge({
  data,
  bolehEdit = false,
  labelDept = {},
}: {
  data: RaciKaryawan | null;
  bolehEdit?: boolean;
  /**
   * dept key → label manusia (mis. `kirimtagih` → `Kirim-Tagih & Admin Cabang`).
   * Matriks di atas sudah memakai label; tabel ini dulu menulis kuncinya mentah,
   * jadi dua bagian di satu halaman menyebut dept yang sama dengan dua nama.
   */
  labelDept?: Record<string, string>;
}) {
  const dl = (d: string | null) => (d ? (labelDept[d] ?? d) : "—");
  const router = useRouter();
  // Satu state per baris supaya menyimpan seseorang tak membekukan baris lain.
  const [pilihPosisi, setPilihPosisi] = useState<Record<string, string>>({});
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [pesan, setPesan] = useState<Record<string, string>>({});
  // Penetapan massal.
  const [tandai, setTandai] = useState<Set<string>>(new Set());
  const [posisiMassal, setPosisiMassal] = useState("");
  const [sibukMassal, setSibukMassal] = useState(false);
  const [pesanMassal, setPesanMassal] = useState<{ nada: "ok" | "gagal"; teks: string } | null>(null);
  // Editor dibuka langsung di daftar yang perlu keputusan; pembaca biasa
  // disuguhi datanya dulu (mereka tak bisa berbuat apa-apa di tab satunya).
  const [tab, setTab] = useState<"tertaut" | "belum">(bolehEdit ? "belum" : "tertaut");

  const gap = useMemo(() => data?.gap ?? [], [data]);
  const gapById = useMemo(() => new Map(gap.map((g) => [g.employee_id, g])), [gap]);

  // Kandidat posisi bergantung dept, jadi satu batch = satu dept. Dept pertama
  // yang ditandai mengunci sisanya; tanpa kunci ini tombolnya harus memilih
  // kandidat "irisan" yang di data ini selalu kosong (dept beda → posisi beda).
  const deptTerkunci = useMemo(() => {
    for (const id of tandai) { const g = gapById.get(id); if (g) return g.dept ?? null; }
    return null;
  }, [tandai, gapById]);

  const kandidatMassal = useMemo(() => {
    for (const id of tandai) { const g = gapById.get(id); if (g) return g.kandidat_posisi; }
    return [];
  }, [tandai, gapById]);

  // Pintasan "pilih sedept": kasus nyatanya satu dept penuh sekaligus.
  const deptRingkas = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gap) m.set(g.dept ?? "—", (m.get(g.dept ?? "—") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [gap]);

  const bersihkanTanda = () => { setTandai(new Set()); setPosisiMassal(""); setPesanMassal(null); };

  // Updater-nya sengaja TIDAK dipakai untuk menyentuh state lain: fungsi
  // updater harus murni, dan setPosisiMassal di dalamnya akan jalan dua kali
  // di StrictMode.
  const toggleTanda = (id: string) => {
    const n = new Set(tandai);
    if (n.has(id)) n.delete(id); else n.add(id);
    setPesanMassal(null);
    setTandai(n);
    if (n.size === 0) setPosisiMassal("");
  };

  const tandaiSedept = (dept: string) => {
    const ids = gap.filter((g) => (g.dept ?? "—") === dept).map((g) => g.employee_id);
    // Klik kedua pada dept yang sudah penuh tertandai = lepas semua.
    const sudahSemua = ids.length === tandai.size && ids.every((i) => tandai.has(i));
    setPesanMassal(null);
    setPosisiMassal("");
    setTandai(sudahSemua ? new Set() : new Set(ids));
  };

  const simpan = async (g: GapRow) => {
    const posisiId = pilihPosisi[g.employee_id];
    if (!posisiId) return;
    setSibuk(g.employee_id);
    setPesan((m) => ({ ...m, [g.employee_id]: "" }));
    try {
      const r = await fetch("/api/picform/tautan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ employee_id: g.employee_id, posisi_id: Number(posisiId) }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; melebihi?: { posisi: string; jumlah_orang: number; terpakai: number } };
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      // Kapasitas TIDAK menghalangi (form Sales menulis Kirim Tagih 1 orang
      // padahal nyatanya 12) — jadi peringatannya ditampilkan, tautannya tetap
      // tersimpan. Yang salah di situ form-nya, bukan kenyataannya.
      if (j.melebihi) {
        setPesan((m) => ({ ...m, [g.employee_id]: `Tersimpan. Catatan: '${j.melebihi!.posisi}' kini ${j.melebihi!.terpakai} orang, kapasitas form ${j.melebihi!.jumlah_orang} — angka di xlsx perlu dibetulkan.` }));
      }
      // refresh() memuat ulang data server; barisnya hilang dari daftar ini
      // karena gap diturunkan dari KETIADAAN tautan, bukan dari tabel gap.
      router.refresh();
    } catch (e) {
      setPesan((m) => ({ ...m, [g.employee_id]: `Gagal: ${e instanceof Error ? e.message : "tak diketahui"}` }));
    } finally {
      setSibuk(null);
    }
  };

  const simpanMassal = async () => {
    if (!posisiMassal || tandai.size === 0) return;
    setSibukMassal(true);
    setPesanMassal(null);
    try {
      const r = await fetch("/api/picform/tautan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [...tandai].map((employee_id) => ({ employee_id, posisi_id: Number(posisiMassal) })),
        }),
      });
      const j = (await r.json()) as { error?: string; hasil?: HasilItem[] };
      if (!r.ok || j.error || !j.hasil) throw new Error(j.error ?? `HTTP ${r.status}`);
      const gagal = j.hasil.filter((h) => !h.ok);
      const lebih = j.hasil.find((h) => h.melebihi)?.melebihi;
      // Nama yang gagal disebut apa adanya — "3 gagal" tanpa siapa-siapanya
      // memaksa orang menebak dan mencoba ulang semuanya.
      const namaGagal = gagal
        .map((h) => gapById.get(h.employee_id)?.karyawan ?? h.employee_id)
        .slice(0, 5)
        .join(", ");
      const bagian = [`${j.hasil.length - gagal.length} tersimpan`];
      if (gagal.length) bagian.push(`${gagal.length} gagal (${namaGagal}${gagal.length > 5 ? ", …" : ""}): ${gagal[0].error ?? "tak diketahui"}`);
      if (lebih) bagian.push(`catatan: '${lebih.posisi}' kini ${lebih.terpakai} orang, kapasitas form ${lebih.jumlah_orang} — angka di xlsx perlu dibetulkan`);
      setPesanMassal({ nada: gagal.length ? "gagal" : "ok", teks: bagian.join(" · ") });
      setTandai(new Set());
      setPosisiMassal("");
      router.refresh();
    } catch (e) {
      setPesanMassal({ nada: "gagal", teks: `Gagal: ${e instanceof Error ? e.message : "tak diketahui"}` });
    } finally {
      setSibukMassal(false);
    }
  };

  if (!data) {
    return (
      <Card><CardContent className="pt-6">
        <p className="text-muted-foreground">
          Data jembatan posisi tidak tersedia. Pastikan <code>apps/api</code> jalan dan{" "}
          <code>scripts/ops/posisi-employee-match.mjs --apply</code> sudah dijalankan.
        </p>
      </CardContent></Card>
    );
  }
  const r = data.ringkas;
  const pct = r.karyawan_total > 0 ? Math.round((r.tertaut / r.karyawan_total) * 1000) / 10 : null;

  const kolomRantai: DataColumn<RantaiRow>[] = [
    { id: "karyawan", header: "Karyawan", accessor: (x) => x.karyawan },
    { id: "dept", header: "Dept", accessor: (x) => dl(x.dept) },
    { id: "divisi", header: "Divisi (form)", accessor: (x) => x.divisi },
    { id: "posisi", header: "Posisi", accessor: (x) => x.posisi },
    {
      id: "proses", header: "Proses", align: "right",
      accessor: (x) => x.proses,
      cell: (x) => <span className="tabular-nums">{x.proses}</span>,
    },
    {
      id: "sumber", header: "Dasar tautan", accessor: (x) => x.sumber,
      cell: (x) => (
        <span title={x.dasar_tautan ?? undefined} className="text-xs">
          {SUMBER_LABEL[x.sumber] ?? x.sumber}
        </span>
      ),
    },
    { id: "role", header: "Role di roster", accessor: (x) => x.role_roster ?? "", className: "min-w-[16rem]" },
  ];

  const kolomGap: DataColumn<GapRow>[] = [
    ...(bolehEdit
      ? [{
          id: "tandai", header: "", className: "w-8",
          cell: (x: GapRow) => {
            const beda = deptTerkunci != null && (x.dept ?? null) !== deptTerkunci;
            return (
              <span title={beda ? `Satu penetapan massal = satu dept. Sedang memilih dept '${dl(deptTerkunci)}'.` : undefined}>
                <Checkbox
                  checked={tandai.has(x.employee_id)}
                  disabled={beda || sibukMassal}
                  onCheckedChange={() => toggleTanda(x.employee_id)}
                />
              </span>
            );
          },
        } satisfies DataColumn<GapRow>]
      : []),
    // Role dilipat ke bawah nama, dan kolom teks dipotong (teks penuh di
    // tooltip). Sebelumnya lebar kolom mengikuti isi, dan di layar 1440px itu
    // mendorong kolom AKSI ke luar layar — tab yang seluruh gunanya menetapkan
    // posisi malah menyembunyikan kontrolnya di balik scroll horizontal.
    {
      id: "karyawan", header: "Karyawan", accessor: (x) => `${x.karyawan} ${x.role_roster ?? ""}`,
      cell: (x) => (
        <div className="max-w-[17rem]">
          <div className="truncate font-medium">{x.karyawan}</div>
          <div className="text-muted-foreground truncate text-xs" title={x.role_roster ?? undefined}>
            {x.role_roster ?? "—"}
          </div>
        </div>
      ),
    },
    { id: "dept", header: "Dept", accessor: (x) => dl(x.dept) },
    {
      id: "alasan", header: "Kenapa belum dipetakan", accessor: (x) => x.alasan,
      cell: (x) => <span className="block max-w-[15rem] truncate text-xs" title={x.alasan}>{x.alasan}</span>,
    },
    {
      id: "kandidat", header: bolehEdit ? "Tetapkan posisi" : "Posisi yang mungkin",
      accessor: (x) => x.kandidat ?? "",
      cell: (x) => {
        if (!bolehEdit) {
          return x.kandidat
            ? <span className="text-xs text-muted-foreground">{x.kandidat}</span>
            : <span className="text-xs text-muted-foreground">—</span>;
        }
        if (x.kandidat_posisi.length === 0) {
          // Nol kandidat = divisinya tak punya pemetaan department (Business IVD
          // & Medical) atau posisinya belum ada di form. Tak ada yang bisa
          // dipilih, jadi jangan tampilkan dropdown kosong yang bikin bingung.
          return <span className="text-xs text-muted-foreground">tak ada kandidat — divisi belum terpetakan ke dept</span>;
        }
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <select
                value={pilihPosisi[x.employee_id] ?? ""}
                onChange={(e) => setPilihPosisi((m) => ({ ...m, [x.employee_id]: e.target.value }))}
                disabled={sibuk === x.employee_id || sibukMassal}
                className="max-w-[11rem] rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
              >
                <option value="">pilih posisi…</option>
                {x.kandidat_posisi.map((k) => (
                  <option key={k.posisi_id} value={k.posisi_id}>
                    {k.posisi} — {k.terpakai}/{k.jumlah_orang ?? "?"} terisi
                  </option>
                ))}
              </select>
              <Button
                size="sm" variant="outline"
                disabled={!pilihPosisi[x.employee_id] || sibuk === x.employee_id || sibukMassal}
                onClick={() => void simpan(x)}
              >
                {sibuk === x.employee_id ? "…" : "Simpan"}
              </Button>
            </div>
            {pesan[x.employee_id] && (
              <p className={`text-xs ${pesan[x.employee_id].startsWith("Gagal") ? "text-destructive" : "text-muted-foreground"}`}>
                {pesan[x.employee_id]}
              </p>
            )}
          </div>
        );
      },
      className: "min-w-[16rem]",
    },
  ];

  return (
    <Card id="posisi-form-pic" className="scroll-mt-20">
      <CardHeader className="gap-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Posisi &amp; proses per karyawan (form PIC)</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{r.tertaut} dari {r.karyawan_total} karyawan tertaut</Badge>
            {pct != null && <Badge variant="outline">{pct}%</Badge>}
            <Badge variant="outline">{r.baris_tautan} baris tautan</Badge>
          </div>
        </div>
        <div className="flex gap-1 rounded-lg border p-1 self-start">
          {([["tertaut", `Tertaut (${r.tertaut})`], ["belum", `Belum dipetakan (${r.belum})`]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${tab === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {lbl}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {tab === "tertaut" ? (
          <>
            <p className="text-sm text-muted-foreground">
              Matriks di atas menjawab &ldquo;orang ini terlibat di proses apa&rdquo; menurut
              transkrip wawancara. Tabel ini menjawab pertanyaan lain: &ldquo;orang ini memegang
              posisi apa menurut form PIC, dan posisi itu memikul berapa proses&rdquo;. Sumber, waktu,
              dan penulisnya berbeda — kalau keduanya tidak sama untuk orang yang sama, itu bukan
              kontradiksi, itu bahan konfirmasi. Baris bisa lebih banyak dari jumlah orang: seseorang
              boleh merangkap, dan kolom <em>Proses</em> dihitung per posisi — jangan dijumlahkan
              begitu saja jadi beban satu orang.
            </p>
            <DataTable
              columns={kolomRantai}
              data={data.rantai}
              getKey={(x) => `${x.employee_id}|${x.posisi_id}`}
              pageSize={25}
              initialSort={{ id: "proses", dir: "desc" }}
              searchPlaceholder="Cari karyawan / posisi…"
            />
          </>
        ) : r.belum === 0 ? (
          <p className="text-sm text-muted-foreground">Semua karyawan sudah tertaut ke posisi form PIC.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Mereka <strong>tidak</strong> berarti tanpa tanggung jawab — semuanya tetap punya baris
              R/A/C/I di matriks atas; yang belum ada hanya tautan ke posisi di form PIC, dan
              alasannya ditulis apa adanya di bawah. Sebagian besar karena form menyebut kapasitas
              lebih kecil dari jumlah orang yang cocok (mis. <em>Kirim Tagih</em> diisi 1 orang
              padahal 12 orang rolenya memuatnya), atau karena dua orang punya role identik untuk dua
              posisi berbeda. Keduanya butuh keputusan HoD/PIC, bukan tebakan sistem.
            </p>

            {bolehEdit && (
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium">Tetapkan sekaligus:</span>
                  {deptRingkas.map(([d, n]) => (
                    <button key={d} onClick={() => tandaiSedept(d)} disabled={sibukMassal}
                      className={`rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 ${
                        deptTerkunci === (d === "—" ? null : d) ? "border-primary bg-primary-soft text-primary font-medium" : "border-border hover:bg-muted"
                      }`}>
                      {dl(d === "—" ? null : d)} ({n})
                    </button>
                  ))}
                  <span className="text-muted-foreground text-xs">atau centang baris di tabel</span>
                </div>

                {tandai.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                    <Badge variant="secondary">{tandai.size} dipilih</Badge>
                    {deptTerkunci != null && (
                      // Kunci dept sebelumnya cuma terbaca lewat tooltip di checkbox
                      // yang mati — terlihat seperti baris yang rusak, bukan aturan.
                      <span className="text-muted-foreground text-xs">
                        satu batch = satu dept, terkunci di <strong>{dl(deptTerkunci)}</strong>
                      </span>
                    )}
                    {kandidatMassal.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        tak ada kandidat posisi untuk dept ini — divisinya belum terpetakan ke dept
                      </span>
                    ) : (
                      <>
                        <select
                          value={posisiMassal}
                          onChange={(e) => setPosisiMassal(e.target.value)}
                          disabled={sibukMassal}
                          className="max-w-[20rem] rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                        >
                          <option value="">pilih posisi…</option>
                          {kandidatMassal.map((k) => (
                            <option key={k.posisi_id} value={k.posisi_id}>
                              {k.posisi} — {k.terpakai}/{k.jumlah_orang ?? "?"} terisi
                            </option>
                          ))}
                        </select>
                        <Button size="sm" disabled={!posisiMassal || sibukMassal} onClick={() => void simpanMassal()}>
                          {sibukMassal ? "Menyimpan…" : `Tetapkan ke ${tandai.size} orang`}
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" disabled={sibukMassal} onClick={bersihkanTanda}>Batal</Button>
                  </div>
                )}

                {pesanMassal && (
                  <p className={`text-xs ${pesanMassal.nada === "gagal" ? "text-destructive" : "text-muted-foreground"}`}>
                    {pesanMassal.teks}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  Kapasitas form tidak menghalangi — kalau terlampaui, tautannya tetap tersimpan dan
                  angkanya dilaporkan supaya xlsx-nya dibetulkan. Tautan manual tak pernah tersapu
                  impor ulang.
                </p>
              </div>
            )}

            <DataTable
              columns={kolomGap}
              data={gap}
              getKey={(x) => x.employee_id}
              pageSize={25}
              searchPlaceholder="Cari karyawan / alasan…"
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
