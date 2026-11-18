"use client";

import { Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { LABEL_KOMITE, kirim, waktu, type Komite, type Susunan } from "./types";

// Susunan Komite (migrasi 242): siapa menjabat apa — diisi dari layar ini, tidak pernah di kode.
// 18 Nov 2026 (permintaan user): bukan lagi panel lebar di atas tab, melainkan tombol "Susunan Komite" (ikon setelan) di samping
// Format #KSO yang membuka modal. Data dimuat saat modal dibuka. Pemegang centang kso-komite-susunan (API menentukan lewat
// `bolehUbah`, dan memeriksa ulang setiap simpan) langsung mendapat form ubah; yang lain melihat daftar baca-saja.
export function TombolSusunan() {
  const [buka, setBuka] = useState(false);
  const [d, setD] = useState<Susunan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const muat = useCallback(() => {
    kirim<Susunan>("/api/kso-komite/susunan").then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { if (buka) muat(); }, [buka, muat]);
  return (
    <>
      <Button type="button" size="sm" variant="soft" onClick={() => setBuka(true)}>
        <Settings aria-hidden />Susunan Komite
      </Button>
      <Dialog open={buka} onOpenChange={setBuka}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Susunan Komite</DialogTitle>
            <DialogDescription>
              {d?.bolehUbah
                ? "Ganti orang = pilih akun baru + tanggal mulai. Pemegang lama otomatis ditutup; riwayatnya tetap tersimpan."
                : "Jabatan KSO Forum dan Product Development beserta pemegangnya. Judul agenda WhatsApp menyebut Ketua dan Sekretaris dari sini."}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {err && <p className="text-destructive text-sm">{err}</p>}
            {!d ? (!err && <p className="text-muted-foreground text-sm">Memuat…</p>)
              : d.bolehUbah ? <AturSusunan d={d} onBerubah={muat} /> : <DaftarSusunan d={d} />}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

function DaftarSusunan({ d }: { d: Susunan }) {
  const aktif = d.jabatan.filter((j) => j.aktif);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(Object.keys(LABEL_KOMITE) as Komite[]).map((k) => (
        <div key={k}>
          <div className="text-muted-foreground text-xs font-medium uppercase">{LABEL_KOMITE[k]}</div>
          <ul className="mt-1 space-y-1 text-sm">
            {aktif.filter((j) => j.komite === k).map((j) => (
              <li key={j.kode}>
                {j.label}: {j.pemegang
                  ? <b>{j.pemegang.nama ?? "akun tidak dikenal"}</b>
                  : <span className="text-amber-700 dark:text-amber-400">belum diisi</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const hariIni = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

function AturSusunan({ d, onBerubah }: { d: Susunan; onBerubah: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const simpan = async (jenis: "pemegang" | "jabatan", body: Record<string, unknown>) => {
    setSibuk(true); setErr(null);
    try {
      await kirim(`/api/kso-komite/susunan/${jenis}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      onBerubah();
    } catch (e) { setErr((e as Error).message); } finally { setSibuk(false); }
  };
  const opsi = d.akun.map((a) => ({ value: a.id, label: a.name }));
  return (
    <>
      {err && <p className="text-destructive text-sm">{err}</p>}
      {d.jabatan.map((j) => (
        <BarisJabatan key={`${j.kode}-${j.pemegang?.user_id ?? "-"}-${j.label}-${j.aktif}`} j={j} opsi={opsi} sibuk={sibuk} simpan={simpan} />
      ))}
      <JabatanBaru sibuk={sibuk} simpan={simpan} />
      {d.riwayat.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold">Riwayat</h3>
          <ul className="space-y-0.5 text-xs">
            {d.riwayat.map((r, i) => (
              <li key={i}>{r.label}: <b>{r.nama ?? r.user_id}</b> · {r.mulai} s/d {r.selesai ?? "sekarang"}
                <span className="text-muted-foreground"> · dicatat {r.dicatat_oleh ?? "—"} {waktu(r.dicatat_at)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

type Simpan = (jenis: "pemegang" | "jabatan", body: Record<string, unknown>) => Promise<void>;

function BarisJabatan({ j, opsi, sibuk, simpan }: { j: Susunan["jabatan"][number]; opsi: { value: string; label: string }[]; sibuk: boolean; simpan: Simpan }) {
  const [akun, setAkun] = useState(j.pemegang?.user_id ?? "");
  const [mulai, setMulai] = useState(hariIni());
  const [label, setLabel] = useState(j.label);
  const berubahOrang = akun !== (j.pemegang?.user_id ?? "");
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{j.label} <span className="text-muted-foreground text-xs">· {LABEL_KOMITE[j.komite]}{j.aktif ? "" : " · nonaktif"}</span></span>
        {j.pemegang && <span className="text-muted-foreground text-xs">sejak {j.pemegang.mulai}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <div><Label>Pemegang</Label><Combobox value={akun} onChange={setAkun} options={opsi} placeholder="— belum diisi —" /></div>
        <div><Label>Berlaku mulai</Label><Input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></div>
        <Button disabled={!berubahOrang || !akun || sibuk} onClick={() => simpan("pemegang", { jabatan_kode: j.kode, user_id: akun, mulai })}>Simpan</Button>
      </div>
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer text-xs">Ubah nama jabatan / kosongkan / nonaktifkan</summary>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1"><Label>Nama jabatan</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
          <Button variant="outline" disabled={!label.trim() || label === j.label || sibuk}
            onClick={() => simpan("jabatan", { kode: j.kode, label, komite: j.komite, aktif: j.aktif })}>Simpan nama</Button>
          {j.pemegang && <Button variant="outline" disabled={sibuk} onClick={() => simpan("pemegang", { jabatan_kode: j.kode, user_id: null, mulai })}>Kosongkan</Button>}
          <Button variant="outline" disabled={sibuk} onClick={() => simpan("jabatan", { kode: j.kode, label: j.label, komite: j.komite, aktif: !j.aktif })}>
            {j.aktif ? "Nonaktifkan" : "Aktifkan"}
          </Button>
        </div>
      </details>
    </div>
  );
}

function JabatanBaru({ sibuk, simpan }: { sibuk: boolean; simpan: Simpan }) {
  const [label, setLabel] = useState("");
  const [komite, setKomite] = useState<Komite>("kso_forum");
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <span className="font-medium">Tambah jabatan</span>
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <div><Label>Nama jabatan</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. Anggota Komite" /></div>
        <div><Label>Komite</Label>
          <Combobox value={komite} onChange={(v) => setKomite(v as Komite)}
            options={(Object.keys(LABEL_KOMITE) as Komite[]).map((k) => ({ value: k, label: LABEL_KOMITE[k] }))} />
        </div>
        <Button disabled={!label.trim() || sibuk} onClick={async () => { await simpan("jabatan", { label, komite }); setLabel(""); }}>Tambah</Button>
      </div>
    </div>
  );
}
