"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

interface HasilUpload {
  ok: boolean;
  file_nama?: string | null;
  label_file?: string;
  tanggal?: string;
  status?: string;
  metode?: string;
  jumlah_baris?: number;
  parse_error?: string | null;
  error?: string;
}

/** Setor rekening koran dari menu web (jalur kedua selain WA #KORAN).
 *
 *  Menerima banyak file sekaligus karena kenyataannya begitu: satu hari = 10
 *  rekening = s/d 10 PDF. Hasil per file DITAMPILKAN semua, termasuk yang
 *  gagal — file yang tertahan harus kelihatan di tempat tombolnya, bukan
 *  ditelan lalu muncul entah di mana. */
export function CashinUpload({ onSelesai }: { onSelesai?: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState<HasilUpload[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);

  async function kirim(files: FileList) {
    setSibuk(true);
    setGalat(null);
    setHasil(null);
    try {
      const payload = [];
      for (const f of Array.from(files)) {
        const buf = await f.arrayBuffer();
        let biner = "";
        const bytes = new Uint8Array(buf);
        // Dipotong per 8 KB: String.fromCharCode(...bytes) sekali jalan
        // melempar RangeError untuk PDF ratusan KB (batas argumen fungsi).
        for (let i = 0; i < bytes.length; i += 8192) {
          biner += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        payload.push({ file_nama: f.name, pdf_base64: btoa(biner) });
      }
      const res = await fetch("/api/cashin/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const data = (await res.json()) as { hasil?: HasilUpload[]; error?: string };
      if (!res.ok) {
        setGalat(data.error ?? `gagal (${res.status})`);
        return;
      }
      setHasil(data.hasil ?? []);
      router.refresh();
      onSelesai?.();
    } catch (e) {
      setGalat((e as Error).message);
    } finally {
      setSibuk(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files?.length && kirim(e.target.files)}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={sibuk}>
          {sibuk ? "Memproses…" : "Upload rekening koran"}
        </Button>
        <span className="text-muted-foreground text-xs">
          PDF dari e-banking (boleh banyak file sekaligus). Tanggal &amp; rekening dibaca dari isi dokumen.
        </span>
      </div>

      {galat && <p className="text-destructive text-sm">{galat}</p>}

      {hasil && (
        <ul className="flex flex-col gap-1 text-sm">
          {hasil.map((h, i) => (
            <li key={i} className={h.ok && h.status === "terverifikasi" ? "text-foreground" : "text-destructive"}>
              {h.ok ? (
                <>
                  {h.status === "terverifikasi" ? "✅" : "⚠️"} {h.label_file} {h.tanggal} — {h.jumlah_baris} transaksi
                  {h.metode === "ocr" ? " (dibaca OCR)" : ""}
                  {h.status !== "terverifikasi" && ` · TERTAHAN: ${h.parse_error ?? "belum terverifikasi"}`}
                </>
              ) : (
                <>⚠️ {h.file_nama ?? "(tanpa nama)"} — {h.error}</>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
