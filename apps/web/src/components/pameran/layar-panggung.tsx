"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";

// F173 — mode layar panggung: QR form registrasi sebesar mungkin untuk proyektor/LED,
// jumlah pendaftar naik live (poll 5 dtk). Warna brand eksplisit — layar panggung tak ikut
// tema terang/gelap dashboard. Uji beban 30 Okt: 1.800 penonton scan dalam 5 dtk → 0% gagal.

interface Ringkas { slug: string; link_pendek: string | null; nama: string; lokasi: string | null; jumlah: number; menerima: boolean }

const angka = (n: number) => n.toLocaleString("id-ID");

export function LayarPanggung({ id }: { id: string }) {
  const [d, setD] = useState<Ringkas | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [penuh, setPenuh] = useState(false);

  const muat = useCallback(() => {
    fetch(`/api/pameran/${encodeURIComponent(id)}/layar`, { cache: "no-store" })
      .then(async (r) => {
        const x = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((x as { error?: string }).error ?? `gagal (HTTP ${r.status})`);
        setD(x as Ringkas);
        setErr(null);
      })
      .catch((e: Error) => setErr(e.message)); // data lama tetap tampil — layar tak boleh kosong di tengah acara
  }, [id]);

  useEffect(() => {
    muat();
    const t = setInterval(muat, 5000);
    return () => clearInterval(t);
  }, [muat]);

  const url = d && typeof window !== "undefined" ? (d.link_pendek ?? `${window.location.origin}/daftar/${d.slug}`) : "";
  useEffect(() => {
    if (!url) return;
    QRCode.toDataURL(url, { width: 1400, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0b3d45", light: "#ffffff" } })
      .then(setQr).catch(() => setQr(null));
  }, [url]);

  // Layar jangan meredup/terkunci selama acara.
  useEffect(() => {
    let kunci: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((k) => { kunci = k; }).catch(() => {});
    const onFs = () => setPenuh(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => { kunci?.release().catch(() => {}); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  const host = url.replace(/^https?:\/\//, "");

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center gap-[4vmin] overflow-hidden bg-gradient-to-br from-[#086f80] via-[#0ca6bd] to-[#2bd4a8] p-[4vmin] text-white landscape:flex-row">
      {!penuh && (
        <button
          type="button"
          onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
          className="absolute top-4 right-4 rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur hover:bg-white/25"
        >
          Layar penuh
        </button>
      )}

      <div className="shrink-0 rounded-[3vmin] bg-white p-[2vmin] shadow-2xl">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="QR registrasi pengunjung" className="block size-[min(78vh,46vw)] portrait:size-[min(80vw,52vh)]" />
        ) : (
          <div className="flex size-[min(78vh,46vw)] items-center justify-center text-[2vmin] text-slate-500 portrait:size-[min(80vw,52vh)]">
            {err ?? "Memuat QR…"}
          </div>
        )}
      </div>

      <div className="flex max-w-[48vw] flex-col gap-[2.5vmin] portrait:max-w-[90vw] portrait:items-center portrait:text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wahana-lifeline-white.png" alt="Wahana LifeLine" className="h-[5vmin] w-auto self-start drop-shadow portrait:self-center" />
        <p className="text-[2.6vmin] font-semibold tracking-[0.2em] text-white/80 uppercase">Scan &amp; dapatkan kupon doorprize</p>
        <h1 className="text-[6vmin] leading-tight font-bold">{d?.nama ?? "…"}</h1>
        {d?.lokasi && <p className="text-[3vmin] text-white/85">{d.lokasi}</p>}
        <p className="font-mono text-[2.4vmin] break-all text-white/80">{host}</p>
        {d && !d.menerima && (
          <p className="rounded-xl bg-amber-400/90 px-[2vmin] py-[1vmin] text-[2.6vmin] font-semibold text-amber-950">
            Form sedang ditutup — buka dari menu Pameran
          </p>
        )}
        <div className="mt-[1vmin] rounded-2xl bg-white/15 px-[3vmin] py-[2vmin] backdrop-blur">
          <p className="text-[9vmin] leading-none font-extrabold tabular-nums">{d ? angka(d.jumlah) : "—"}</p>
          <p className="mt-[0.8vmin] text-[2.6vmin] text-white/85">pengunjung sudah terdaftar</p>
        </div>
        {err && d && <p className="text-[1.8vmin] text-white/70">Koneksi tersendat — angka terakhir: {angka(d.jumlah)}</p>}
      </div>
    </main>
  );
}
