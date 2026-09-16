"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";

// Pemilih dari katalog Accurate — nilainya ID, bukan teks bebas.
//
// Bedanya dari `Combo` di deal-form-modal.tsx: di sana nilai = teks bebas (boleh
// di luar daftar, mis. brand baru). Di sini justru sebaliknya — F22 mewajibkan
// alat & customer BERASAL dari katalog, jadi input teks cuma alat pencari;
// nilai yang tersimpan selalu id hasil klik. Kalau belum ada yang diklik,
// `value` tetap null dan form tak bisa disubmit.
//
// Pencarian dikirim ke server (?q=), TIDAK menyaring di klien. Katalog prod
// ~5.800 item; menariknya semua lalu memfilter di browser berarti setiap
// pembukaan sheet menarik ribuan baris, dan tanpa `q` urutan dari API adalah
// `last_synced_at DESC` — potongan arbitrer yang bisa TIDAK memuat barang yang
// dicari, lalu dropdown melapor "tak ketemu" untuk barang yang sebenarnya ada.

export interface CatalogChoice {
  id: number;
  label: string;
}

interface Props {
  entity: "items" | "customers";
  value: CatalogChoice | null;
  onChange: (v: CatalogChoice | null) => void;
  placeholder?: string;
  inputId?: string;
  required?: boolean;
}

interface MirrorRow {
  id: number | string;
  no?: string | null;
  name?: string | null;
}

export function CatalogPicker({ entity, value, onChange, placeholder, inputId, required }: Props) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MirrorRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Tutup saat klik di luar — sama seperti Combo yang sudah ada.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Debounce 250ms: tiap ketikan memukul DB, jadi jangan per-karakter.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setLoading(true);
      setErr(null);
      const qs = new URLSearchParams({ entity, limit: "50" });
      if (q.trim()) qs.set("q", q.trim());
      fetch(`/api/accurate-catalog?${qs.toString()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => setRows(Array.isArray(d?.rows) ? d.rows : []))
        .catch(() => setErr("gagal memuat katalog"))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q, entity, open]);

  const labelOf = (r: MirrorRow) => {
    // Nama mirror bisa empty-string (bukan NULL) — fallback ke `no` supaya opsi
    // tak pernah tampil kosong dan tak bisa diklik secara membingungkan.
    const nama = String(r.name ?? "").trim();
    const no = String(r.no ?? "").trim();
    if (nama && no) return `${nama} (${no})`;
    return nama || no || `#${r.id}`;
  };

  // Sudah terpilih → tampilkan pilihannya, bukan kotak cari. Mengganti pilihan
  // harus lewat "Ganti" yang eksplisit, supaya id tak ikut hilang tanpa sengaja
  // saat orang mengetik ulang di kotak yang sama.
  if (value) {
    return (
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate rounded-md border border-input bg-muted/40 px-2 py-1.5 text-sm">
          {value.label}
        </span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline"
          onClick={() => {
            onChange(null);
            setQ("");
            setRows([]);
            setOpen(true);
          }}
        >
          Ganti
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        id={inputId}
        value={q}
        placeholder={placeholder ?? "cari lalu pilih dari daftar…"}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {/* Input tersembunyi ber-required: pesan "wajib" bawaan browser tetap
          muncul kalau belum ada yang dipilih — mengetik saja tidak cukup. */}
      {required && <input type="text" required value="" onChange={() => {}} className="sr-only" tabIndex={-1} aria-hidden />}
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-card shadow-md">
          {loading && <p className="text-muted-foreground px-2 py-1.5 text-xs">memuat…</p>}
          {err && <p className="text-destructive px-2 py-1.5 text-xs">{err}</p>}
          {!loading && !err && rows.length === 0 && (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              {q.trim()
                ? "tak ada yang cocok — kalau ini data baru, sinkronkan katalog Accurate dulu"
                : "ketik untuk mencari"}
            </p>
          )}
          {rows.map((r) => (
            <button
              key={String(r.id)}
              type="button"
              className="hover:bg-accent block w-full truncate px-2 py-1.5 text-left text-sm"
              onClick={() => {
                onChange({ id: Number(r.id), label: labelOf(r) });
                setOpen(false);
              }}
            >
              {labelOf(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
