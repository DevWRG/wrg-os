"use client";

import { useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ForceGraf, type GarisViz, type SimpulViz } from "./force-canvas";
import type { PohonPekerjaan } from "./types";
import { LEVEL_URUT, warnaLevel } from "./viz";

// Pohon pekerjaan sebagai FORCE TREE RADIAL yang dibuka bertahap.
//
// KENAPA BUKAN FORCE GRAPH BIASA (semua 757 simpul sekaligus): pohon ini punya
// 1 akar + 6 divisi + 31 posisi + 283 tugas + 167 SOP + 436 langkah. Melempar
// semuanya ke satu simulasi berarti ±286 ribu pasangan diperiksa tiap tick —
// berat — dan yang lebih fatal, hasilnya kabut helai yang justru menyembunyikan
// hierarkinya. Yang dipakai di sini: hanya cabang yang DIBUKA ikut simulasi
// (puluhan simpul), dan gaya radial per kedalaman menahan tiap tingkat di
// cincinnya sendiri — jadi gerakannya tetap hidup & bisa diseret, tapi
// "divisi → posisi → tugas" tetap terbaca sebagai tingkatan, bukan gumpalan.
//
// SOP DIGANTUNG DI DIVISI, BUKAN DI POSISI. Tabel B form PIC memang tak
// mencatat posisi untuk SOP; menggantungkannya ke posisi berarti mengarang
// pemetaan yang tak ada di sumbernya.

type Jenis = "root" | "divisi" | "posisi" | "tugas" | "grup-sop" | "sop" | "langkah";

interface Simpul {
  id: string;
  jenis: Jenis;
  label: string;
  sub?: string;
  level?: string | null;
  target?: string | null;
  detail?: { k: string; v: string }[];
  anak: Simpul[];
}

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

const JARI: Record<Jenis, number> = {
  root: 13, divisi: 11, posisi: 9, "grup-sop": 8, sop: 7, tugas: 6, langkah: 6,
};
const BENTUK: Record<Jenis, SimpulViz["bentuk"]> = {
  root: "root", divisi: "divisi", posisi: "posisi", "grup-sop": "grup",
  sop: "sop", tugas: "tugas", langkah: "langkah",
};

export function WorkForce({ data }: { data: PohonPekerjaan }) {
  const akar = useMemo(() => bangunPohon(data), [data]);

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

  // Default: HANYA akar yang terbuka, jadi yang tampil 1 + 6 divisi.
  //
  // Sempat di-set "semua divisi terbuka" (44 simpul sekaligus) dan itu keliru:
  // 31 posisi + 6 kumpulan SOP berlabel panjang membentuk kotak pembatas
  // ±860×860, sehingga pas-kan otomatis mengecilkan gambar ke 0,77× — teksnya
  // jadi 8,5px dan tak terbaca. Gagal karena terlalu kecil sama saja dengan
  // gagal karena bertumpuk. Dibuka bertahap, tiap langkah tetap terbaca.
  const [buka, setBuka] = useState<Set<string>>(() => new Set(["root"]));
  const [pilih, setPilih] = useState<string | null>(null);
  const [cari, setCari] = useState("");

  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (q.length < 2) return null;
    return new Set([...semua.values()].filter((s) => s.label.toLowerCase().includes(q)).map((s) => s.id));
  }, [cari, semua]);

  // Pencarian MEMBUKA jalurnya, bukan menyaring pohonnya — menyaring membuang
  // konteks "tugas ini milik posisi apa di divisi mana", justru yang dicari
  // orang. Jalurnya dihitung saat render, bukan lewat efek yang memanggil
  // setState: keadaan pohon tetap satu, hasil pencarian cuma lapisan turunan.
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
        // Satu-satunya hal yang diwarnai bertingkat adalah level otomasi:
        // jenis simpul sudah terbaca dari bentuk & kedalamannya, jadi
        // mewarnainya lagi cuma menghabiskan anggaran warna tanpa menambah
        // informasi. Langkah tanpa level = bingkai putus-putus, supaya
        // "belum diisi PIC" tidak menyamar jadi "Manual".
        warna: s.jenis === "langkah" ? warnaLevel(s.level)
          : s.jenis === "divisi" || s.jenis === "posisi" || s.jenis === "root"
            ? "var(--viz-internal)"
            : null,
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

  const terpilih = pilih ? semua.get(pilih) ?? null : null;
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
            Akar di tengah, tiap tingkat di cincinnya sendiri: divisi → posisi → tugas. Klik simpul
            untuk membuka cabangnya (yang masih tertutup bercincin putus-putus). Cabang{" "}
            <strong>SOP divisi</strong> menggantung di divisi — bukan di posisi — karena Tabel B
            form PIC tidak mencatat posisi untuk SOP.
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
              kunciFit="pohon"
              toolbar={
                <>
                  <Input
                    value={cari}
                    onChange={(e) => setCari(e.target.value)}
                    placeholder="Cari tugas / posisi / langkah…"
                    className="h-8 max-w-xs"
                  />
                  {cocok && (
                    <span className="text-xs text-muted-foreground">
                      {cocok.size} cocok{cocok.size > 0 ? " — jalurnya dibuka" : ""}
                    </span>
                  )}
                  <Button size="sm" variant="outline"
                    onClick={() => setBuka(new Set(["root", ...akar.anak.map((d) => d.id)]))}>
                    Buka semua divisi
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setBuka(new Set(["root"]))}>
                    Tutup semua
                  </Button>
                </>
              }
              legenda={
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Level otomasi langkah:</span>
                  {LEVEL_URUT.map((l) => (
                    <span key={l} className="inline-flex items-center gap-1.5">
                      <span className="inline-block size-3 rounded-sm"
                        style={{ background: warnaLevel(l) ?? undefined }} />
                      {l}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block size-3 rounded-sm border border-dashed border-muted-foreground" />
                    belum diisi
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
                Belum ada simpul dipilih. Klik salah satu untuk membaca rinciannya — frekuensi,
                penanggung jawab, dan target/KPI sebuah tugas, atau kondisi vs target level sebuah
                langkah SOP.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {terpilih.jenis === "grup-sop" ? "kumpulan SOP" : terpilih.jenis}
                  </div>
                  <div className="mt-1 text-sm font-medium">{terpilih.label}</div>
                  {terpilih.sub && (
                    <div className="text-xs text-muted-foreground">{terpilih.sub}</div>
                  )}
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
