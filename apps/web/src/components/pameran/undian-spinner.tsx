"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// F173 — spinner undian layar penuh (gaya mesin slot): kupon peserta bergulir cepat, melambat,
// lalu berhenti di pemenang. TAMPILAN saja — pemenang SUDAH dipilih acak di server
// (kocokPemenang, crypto) sebelum animasi dimulai; animasi tak bisa mengubah hasil.
// Mesin slot, bukan roda: dengan ±1.800 peserta, roda berisi 1.800 irisan tak terbaca.

export interface KuponPeserta { kode_kupon: string; nama: string }
export interface PemenangUndian { id: number; kode_kupon: string; nama: string; institusi: string }

/** Jeda antar-pergantian kupon (ms): cepat & rata dulu, lalu melambat geometris sampai berhenti.
 * Total ±5 detik — cukup untuk tegang di panggung, tak terlalu lama untuk banyak hadiah. */
export function jadwalPutar(cepatMs = 2200, awal = 45, faktor = 1.13, akhir = 480): number[] {
  const j: number[] = [];
  let t = 0;
  while (t < cepatMs) { j.push(awal); t += awal; }
  for (let d = awal; d < akhir; d *= faktor) j.push(Math.round(d));
  return j;
}

type Fase = "siap" | "putar" | "berhenti";

export function UndianSpinner({ hadiah, pemenang, sampel, onTutup }: {
  hadiah: string; pemenang: PemenangUndian[]; sampel: KuponPeserta[]; onTutup: () => void;
}) {
  const wadah = useRef<HTMLDivElement>(null);
  const [ke, setKe] = useState(0);              // pemenang ke berapa yang sedang diputar
  const [fase, setFase] = useState<Fase>("siap");
  const [tampil, setTampil] = useState<KuponPeserta>({ kode_kupon: "• • • • •", nama: "" });
  const [terungkap, setTerungkap] = useState<PemenangUndian[]>([]);
  const waktu = useRef<ReturnType<typeof setTimeout> | null>(null);

  const putar = useCallback((i: number) => {
    const target = pemenang[i];
    if (!target) return;
    setFase("putar");
    const kolam = sampel.length ? sampel : pemenang.map((p) => ({ kode_kupon: p.kode_kupon, nama: p.nama }));
    const hemat = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const jadwal = hemat ? [] : jadwalPutar();
    let n = 0;
    const langkah = () => {
      if (n >= jadwal.length) {
        setTampil({ kode_kupon: target.kode_kupon, nama: target.nama });
        setTerungkap((t) => [...t, target]);
        setFase("berhenti");
        return;
      }
      setTampil(kolam[Math.floor(Math.random() * kolam.length)]);
      waktu.current = setTimeout(langkah, jadwal[n++]);
    };
    langkah();
  }, [pemenang, sampel]);

  useEffect(() => () => { if (waktu.current) clearTimeout(waktu.current); }, []);

  const berikut = () => { const i = ke + 1; setKe(i); putar(i); };
  const sisa = pemenang.length - terungkap.length;
  const menang = fase === "berhenti" ? pemenang[ke] : null;

  return (
    <div ref={wadah} className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-[3vmin] overflow-hidden bg-gradient-to-br from-[#086f80] via-[#0ca6bd] to-[#2bd4a8] p-[4vmin] text-white">
      <div className="absolute top-4 right-4 flex gap-2">
        <button type="button" className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur hover:bg-white/25"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wadah.current?.requestFullscreen?.())?.catch?.(() => {})}>
          Layar penuh
        </button>
        {fase !== "putar" && (
          <button type="button" className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur hover:bg-white/25"
            onClick={() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); onTutup(); }}>
            Tutup
          </button>
        )}
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/wahana-lifeline-white.png" alt="Wahana LifeLine" className="h-[5vmin] w-auto drop-shadow" />
      <p className="text-[2.6vmin] font-semibold tracking-[0.25em] text-white/80 uppercase">Undian doorprize</p>
      <h2 className="text-center text-[6vmin] leading-tight font-bold">{hadiah}</h2>
      {pemenang.length > 1 && (
        <p className="text-[2.4vmin] text-white/85">Pemenang {Math.min(ke + 1, pemenang.length)} dari {pemenang.length}</p>
      )}

      <div className={`w-[min(86vw,120vmin)] rounded-[3vmin] bg-white px-[4vmin] py-[4vmin] text-center text-[#0b3d45] shadow-2xl transition-transform duration-500 ${menang ? "scale-105 ring-[1vmin] ring-amber-300" : ""}`}>
        <p className={`font-mono text-[13vmin] leading-none font-extrabold tracking-[0.12em] tabular-nums ${fase === "putar" ? "opacity-80 blur-[1px]" : ""}`}>
          {tampil.kode_kupon}
        </p>
        <p className="mt-[2vmin] min-h-[5vmin] truncate text-[4.2vmin] font-semibold">{fase === "putar" ? tampil.nama : menang?.nama ?? ""}</p>
        {menang && <p className="text-[2.8vmin] text-slate-600">{menang.institusi}</p>}
      </div>

      <div className="flex min-h-[8vmin] items-center gap-3">
        {fase === "siap" && (
          <button type="button" onClick={() => putar(0)} className="rounded-2xl bg-amber-300 px-[5vmin] py-[2vmin] text-[3.4vmin] font-bold text-amber-950 shadow-lg hover:bg-amber-200">
            Putar!
          </button>
        )}
        {fase === "berhenti" && sisa > 0 && (
          <button type="button" onClick={berikut} className="rounded-2xl bg-amber-300 px-[5vmin] py-[2vmin] text-[3.4vmin] font-bold text-amber-950 shadow-lg hover:bg-amber-200">
            Putar pemenang berikutnya
          </button>
        )}
        {fase === "berhenti" && sisa === 0 && <p className="text-[3.4vmin] font-bold">Selamat kepada para pemenang! 🎉</p>}
      </div>

      {terungkap.length > 1 && (
        <ul className="flex max-w-[90vw] flex-wrap justify-center gap-2">
          {terungkap.map((p) => (
            <li key={p.id} className="rounded-lg bg-white/15 px-3 py-1 text-[2vmin] backdrop-blur"><span className="font-mono font-bold">{p.kode_kupon}</span> · {p.nama}</li>
          ))}
        </ul>
      )}
      <p className="absolute bottom-3 text-[1.6vmin] text-white/60">Pemenang dipilih acak oleh sistem sebelum putaran dimulai.</p>
    </div>
  );
}
