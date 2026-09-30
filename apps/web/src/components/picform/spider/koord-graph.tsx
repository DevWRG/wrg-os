"use client";

import { useCallback, useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ForceGraf, type GarisViz, type SimpulViz } from "./force-canvas";
import type { KoordGraf, PohonPekerjaan } from "./types";
import { warnaGrup } from "./viz";

// Graf koordinasi antar divisi / antar posisi (Tabel C form PIC), DENGAN
// sub-tree yang bisa dibuka di tiap simpul.
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
// SUB-TREE DAN KOORDINASI ADALAH DUA JENIS GARIS YANG BERBEDA, dan digambar
// berbeda dengan sengaja: garis koordinasi berpanah & setebal jumlah barisnya
// (relasi, punya arah), garis hierarki tipis tanpa panah (kepemilikan, tak
// punya arah). Menyamakannya akan membuat "divisi punya posisi ini" terbaca
// seperti "divisi berkoordinasi dengan posisi ini".
//
// SATU JEBAKAN YANG DIWARISI DARI SUMBER: di level posisi, node diidentifikasi
// lewat NAMA jabatan. Dua posisi bernama sama di divisi berbeda menyatu jadi
// satu node — begitulah koordinasiGraf() membangunnya, dan sub-tree di sini
// mengikutinya (tugas keduanya digabung) supaya angka di graf dan di panel
// tidak saling bertentangan.

type Mode = "divisi" | "posisi";

const PREFIKS_POSISI = "sub:p:";
const PREFIKS_TUGAS = "sub:t:";

export function KoordGraph({
  graf, labelDivisi, pohon,
}: {
  graf: KoordGraf;
  labelDivisi: Record<string, string>;
  pohon: PohonPekerjaan | null;
}) {
  const [mode, setMode] = useState<Mode>("divisi");
  const [fokus, setFokus] = useState<string | null>(null);
  const [buka, setBuka] = useState<Set<string>>(() => new Set());

  const grupNode = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graf.nodes) m.set(n.id, n.grup);
    return m;
  }, [graf.nodes]);

  const namaDari = useCallback((id: string) => labelDivisi[id] ?? id, [labelDivisi]);

  // Indeks sub-tree dari muatan /picform/pohon.
  const sub = useMemo(() => {
    const posisiPerDivisi = new Map<string, PohonPekerjaan["divisi"][number]["posisi"]>();
    const posisiPerId = new Map<string, { nama: string; divisi: string; jumlah: number | null; tugas: { id: number; uraian: string; frekuensi: string | null; pj: string | null; kpi: string | null }[] }>();
    const tugasPerNamaPosisi = new Map<string, { id: number; uraian: string; frekuensi: string | null; pj: string | null; kpi: string | null }[]>();
    const tugasPerId = new Map<string, { uraian: string; frekuensi: string | null; pj: string | null; kpi: string | null; posisi: string }>();

    for (const d of pohon?.divisi ?? []) {
      posisiPerDivisi.set(d.key, d.posisi);
      for (const p of d.posisi) {
        const tugas = p.tugas.map((t) => ({
          id: t.id, uraian: t.uraian,
          frekuensi: t.frekuensi ?? t.frekuensi_raw ?? null,
          pj: t.pj_key ?? t.pj_raw ?? null,
          kpi: t.kpi_target ?? null,
        }));
        posisiPerId.set(String(p.id), { nama: p.nama, divisi: d.label, jumlah: p.jumlah_orang, tugas });
        tugasPerNamaPosisi.set(p.nama, [...(tugasPerNamaPosisi.get(p.nama) ?? []), ...tugas]);
        for (const t of tugas) {
          tugasPerId.set(String(t.id), { ...t, posisi: p.nama });
        }
      }
    }
    return { posisiPerDivisi, posisiPerId, tugasPerNamaPosisi, tugasPerId };
  }, [pohon]);

  /** anak sebuah simpul, apa pun jenisnya — kosong artinya tak bisa dibuka */
  const anakDari = useCallback((id: string): { id: string; label: string; jenis: "posisi" | "tugas" }[] => {
    if (id.startsWith(PREFIKS_TUGAS)) return [];
    if (id.startsWith(PREFIKS_POSISI)) {
      const p = sub.posisiPerId.get(id.slice(PREFIKS_POSISI.length));
      return (p?.tugas ?? []).map((t) => ({ id: `${PREFIKS_TUGAS}${t.id}`, label: t.uraian, jenis: "tugas" as const }));
    }
    // simpul koordinasi: divisi → posisinya; posisi (mode per-posisi) → tugasnya
    const divisi = sub.posisiPerDivisi.get(id);
    if (divisi) {
      return divisi.map((p) => ({ id: `${PREFIKS_POSISI}${p.id}`, label: p.nama, jenis: "posisi" as const }));
    }
    const tugas = sub.tugasPerNamaPosisi.get(id);
    if (tugas && mode === "posisi") {
      return tugas.map((t) => ({ id: `${PREFIKS_TUGAS}${t.id}`, label: t.uraian, jenis: "tugas" as const }));
    }
    return [];
  }, [sub, mode]);

  const { simpul, garis, derajatPer } = useMemo(() => {
    const derajat = new Map<string, number>();
    const inti = new Map<string, SimpulViz>();
    const gs: GarisViz[] = [];

    const sumber = mode === "divisi" ? graf.edges_divisi : graf.edges;
    for (const e of sumber) {
      derajat.set(e.from, (derajat.get(e.from) ?? 0) + e.bobot);
      derajat.set(e.to, (derajat.get(e.to) ?? 0) + e.bobot);
    }
    const jari = (id: string) => 7 + Math.min(11, Math.sqrt(derajat.get(id) ?? 1) * 2.2);
    const bentukDari = (id: string, asalPosisi: boolean): SimpulViz["bentuk"] => {
      if (asalPosisi) return "posisi";
      const g = grupNode.get(id);
      if (g === "external") return "luar";
      if (g === "tak-terklasifikasi") return "tak-kenal";
      return id in labelDivisi ? "divisi" : "tak-kenal";
    };
    const pakai = (id: string, asalPosisi: boolean) => {
      if (inti.has(id)) return;
      const bentuk = bentukDari(id, asalPosisi);
      inti.set(id, {
        id, label: namaDari(id), bentuk, depth: 0, jari: jari(id),
        warna: bentuk === "luar" ? warnaGrup("external")
          : bentuk === "tak-kenal" ? null : warnaGrup("internal"),
        punyaAnak: anakDari(id).length > 0,
        terbuka: buka.has(id),
      });
    };

    // Dua cabang terpisah, bukan satu loop atas union bertipe longgar:
    // 'sepihak'/'bolak_balik' HANYA ada di level divisi (di level posisi
    // resiprositas mustahil menyala — asal selalu posisi, tujuan selalu divisi),
    // dan memeriksanya lewat `in` membuat tipenya melebar jadi unknown.
    if (mode === "divisi") {
      for (const e of graf.edges_divisi) {
        pakai(e.from, false);
        pakai(e.to, false);
        gs.push({
          id: `k:${e.from}→${e.to}`, source: e.from, target: e.to, jenis: "koordinasi",
          bobot: e.bobot, sepihak: e.sepihak, bolak_balik: e.bolak_balik,
        });
      }
    } else {
      for (const e of graf.edges) {
        pakai(e.from, true);
        pakai(e.to, false);
        gs.push({
          id: `k:${e.from}→${e.to}`, source: e.from, target: e.to, jenis: "koordinasi",
          bobot: e.bobot, sepihak: false, bolak_balik: false,
        });
      }
    }

    // Cabang yang dibuka ditambahkan setelah simpul inti, menelusuri ke bawah
    // selama induknya ikut terbuka.
    const out: SimpulViz[] = [...inti.values()];
    const tambah = (indukId: string, depth: number) => {
      if (!buka.has(indukId)) return;
      for (const a of anakDari(indukId)) {
        out.push({
          id: a.id, label: a.label,
          bentuk: a.jenis === "posisi" ? "posisi" : "tugas",
          depth,
          jari: a.jenis === "posisi" ? 8 : 6,
          warna: a.jenis === "posisi" ? warnaGrup("internal") : null,
          punyaAnak: anakDari(a.id).length > 0,
          terbuka: buka.has(a.id),
        });
        gs.push({ id: `h:${indukId}->${a.id}`, source: indukId, target: a.id, jenis: "hirarki" });
        tambah(a.id, depth + 1);
      }
    };
    for (const id of inti.keys()) tambah(id, 1);

    return { simpul: out, garis: gs, derajatPer: derajat };
  }, [mode, graf, grupNode, labelDivisi, namaDari, buka, anakDari]);

  const klik = (id: string) => {
    setFokus((lama) => (lama === id ? null : id));
    if (anakDari(id).length === 0) return;
    setBuka((lama) => {
      const baru = new Set(lama);
      if (baru.has(id)) {
        // Tutup berantai: cabang di bawahnya ikut tertutup, supaya membukanya
        // lagi tidak meledak ke keadaan lama yang sudah tak diingat siapa pun.
        const tutup = (x: string) => { baru.delete(x); for (const a of anakDari(x)) tutup(a.id); };
        tutup(id);
      } else baru.add(id);
      return baru;
    });
  };

  const rinci = useMemo(() => {
    if (!fokus) return null;
    if (fokus.startsWith(PREFIKS_TUGAS)) {
      const t = sub.tugasPerId.get(fokus.slice(PREFIKS_TUGAS.length));
      return t ? { jenis: "tugas" as const, t } : null;
    }
    if (fokus.startsWith(PREFIKS_POSISI)) {
      const p = sub.posisiPerId.get(fokus.slice(PREFIKS_POSISI.length));
      return p ? { jenis: "posisi" as const, p } : null;
    }
    const keluar = (mode === "divisi" ? graf.edges_divisi : graf.edges).filter((e) => e.from === fokus);
    const masuk = (mode === "divisi" ? graf.edges_divisi : graf.edges).filter((e) => e.to === fokus);
    return { jenis: "node" as const, keluar, masuk };
  }, [fokus, sub, mode, graf]);

  const r = graf.ringkas;
  const adaCabang = buka.size > 0;

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
            divisi ini mencatat koordinasi ke divisi lawan tapi lawannya tidak mencatat baliknya.
            Pihak luar tak pernah ditandai sepihak — mereka tak punya form untuk mengakui balik.
            Klik simpul bercincin putus-putus untuk membuka <strong>sub-tree</strong>-nya: divisi →
            posisi → tugas. Garis tipis tanpa panah = kepemilikan, bukan koordinasi.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <CardContent className="pt-6">
            <ForceGraf
              simpul={simpul}
              garis={garis}
              fokus={fokus}
              onKlik={klik}
              kunciFit={mode}
              toolbar={
                <>
                  <div className="inline-flex rounded-md border p-0.5">
                    {(["divisi", "posisi"] as Mode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => { setMode(m); setFokus(null); setBuka(new Set()); }}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                          mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {m === "divisi" ? "Antar divisi" : "Per posisi"}
                      </button>
                    ))}
                  </div>
                  {adaCabang && (
                    <Button size="sm" variant="outline" onClick={() => setBuka(new Set())}>
                      Tutup cabang
                    </Button>
                  )}
                  {fokus && (
                    <Button size="sm" variant="outline" onClick={() => setFokus(null)}>
                      Lepas sorot
                    </Button>
                  )}
                </>
              }
              legenda={
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
                    tugas / tak terklasifikasi
                  </span>
                  <span>garis putus-putus = sepihak · tebal garis = jumlah baris</span>
                </div>
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            {!rinci ? (
              <p className="text-sm text-muted-foreground">
                Belum ada simpul dipilih. Klik salah satu untuk melihat siapa saja yang
                berkoordinasi dengannya — atau untuk membuka sub-tree posisi &amp; tugasnya.
              </p>
            ) : rinci.jenis === "tugas" ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">tugas</div>
                  <div className="mt-1 text-sm font-medium">{rinci.t.uraian}</div>
                </div>
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Frekuensi</dt>
                    <dd>{rinci.t.frekuensi ?? "— belum diisi"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Penanggung jawab</dt>
                    <dd>{rinci.t.pj ?? "— belum diisi"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Target / KPI</dt>
                    <dd className="whitespace-pre-wrap">{rinci.t.kpi ?? "— belum diisi"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Posisi</dt>
                    <dd>{rinci.t.posisi}</dd>
                  </div>
                </dl>
              </div>
            ) : rinci.jenis === "posisi" ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">posisi</div>
                  <div className="mt-1 text-sm font-medium">{rinci.p.nama}</div>
                  <div className="text-xs text-muted-foreground">
                    {rinci.p.divisi} · {rinci.p.tugas.length} tugas
                    {rinci.p.jumlah !== null ? ` · ${rinci.p.jumlah} orang` : ""}
                  </div>
                </div>
                <ul className="list-inside list-disc space-y-1 text-sm">
                  {rinci.p.tugas.slice(0, 12).map((t) => (
                    <li key={t.id} className="text-xs">{t.uraian}</li>
                  ))}
                </ul>
                {rinci.p.tugas.length > 12 && (
                  <p className="text-xs text-muted-foreground">
                    …{rinci.p.tugas.length - 12} tugas lain — buka cabangnya di graf.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {simpul.find((n) => n.id === fokus)?.bentuk === "luar" ? "pihak luar" : mode === "posisi" ? "node" : "divisi"}
                  </div>
                  <div className="mt-1 text-sm font-medium">{namaDari(fokus!)}</div>
                  <div className="text-xs text-muted-foreground">
                    {derajatPer.get(fokus!) ?? 0} baris koordinasi
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground">
                    Menyatakan koordinasi ke ({rinci.keluar.length})
                  </div>
                  <ul className="mt-1 space-y-1.5 text-sm">
                    {rinci.keluar.length === 0 && <li className="text-muted-foreground">—</li>}
                    {rinci.keluar.map((e) => (
                      <li key={`${e.from}→${e.to}`}>
                        <span className="font-medium">{namaDari(e.to)}</span>{" "}
                        <span className="text-xs text-muted-foreground">
                          · {e.bobot} baris
                          {"sepihak" in e && e.sepihak ? " · sepihak"
                            : "bolak_balik" in e && e.bolak_balik ? " · bolak-balik" : ""}
                        </span>
                        {/* Isi DAN pemicunya, terpisah. "Apa" saja tidak
                            menjelaskan model komunikasinya: yang membedakan
                            koordinasi rutin dari koordinasi kejadian justru
                            ada di kolom pemicu ("Bulanan, tanggal 1" vs
                            "Setiap ada transaksi aset masuk/keluar"). */}
                        {e.rinci.length > 0 && (
                          <ul className="mt-1 space-y-1.5">
                            {e.rinci.map((x, i) => (
                              <li key={i} className="border-l-2 border-border pl-2 text-xs">
                                <div className="text-foreground/90">{x.apa ?? "— tak diisi"}</div>
                                <div className="text-muted-foreground">
                                  <span className="font-medium">Pemicu:</span>{" "}
                                  {x.pemicu ?? "— tak diisi"}
                                </div>
                                {x.dari && (
                                  <div className="text-muted-foreground">
                                    <span className="font-medium">Dinyatakan oleh:</span> {x.dari}
                                  </div>
                                )}
                              </li>
                            ))}
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
                    {rinci.masuk.map((e) => (
                      <li key={`${e.from}→${e.to}`}>
                        {namaDari(e.from)}{" "}
                        <span className="text-xs text-muted-foreground">· {e.bobot} baris</span>
                        {e.rinci.length > 0 && (
                          <ul className="mt-1 space-y-1.5">
                            {e.rinci.map((x, i) => (
                              <li key={i} className="border-l-2 border-border pl-2 text-xs">
                                <div className="text-foreground/90">{x.apa ?? "— tak diisi"}</div>
                                <div className="text-muted-foreground">
                                  <span className="font-medium">Pemicu:</span>{" "}
                                  {x.pemicu ?? "— tak diisi"}
                                </div>
                                {x.dari && (
                                  <div className="text-muted-foreground">
                                    <span className="font-medium">Dinyatakan oleh:</span> {x.dari}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
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
