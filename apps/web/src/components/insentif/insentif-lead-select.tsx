"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { httpErrorMessage } from "@/lib/http-error";

import { LEAD_LABEL } from "./insentif-format";

// Penandaan tipe lead satu invoice — kontrol paling "mahal" di layar ini: memindah
// lead A → C memindahkan 85% insentif baris itu dari AM ke HO Pool.
//
// Yang menentukan boleh/tidaknya tetap SERVER (repo/insentif.ts setLeadType): level
// akses, scope baris, larangan menandai baris sendiri, dan status rekap yang sudah
// terkunci. Komponen ini hanya menyembunyikan kontrolnya supaya tak memancing klik —
// bukan sebagai gerbang izin.
//
// Setelah sukses: router.refresh() — angka MR, insentif baris, dan kartu rekap di atas
// semuanya ikut berubah, jadi menambal state lokal satu sel akan membuat layar
// setengah basi (AM-nya berubah, total di kartu tidak).

export function InsentifLeadSelect({
  amId,
  periode,
  invoiceNo,
  value,
  bisaUbah,
  alasanKunci,
}: {
  amId: string;
  periode: string;
  invoiceNo: string;
  value: string;
  bisaUbah: boolean;
  alasanKunci?: string;
}) {
  const router = useRouter();
  const [sibuk, setSibuk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const meta = LEAD_LABEL[value] ?? { label: value, porsi: "—", hint: "" };

  if (!bisaUbah) {
    return (
      <span title={alasanKunci ?? meta.hint} className="whitespace-nowrap">
        {meta.label}
      </span>
    );
  }

  async function ubah(baru: string) {
    if (baru === value) return;
    setSibuk(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/insentif/${encodeURIComponent(amId)}/lead?periode=${encodeURIComponent(periode)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ invoice_no: invoiceNo, lead_type: baru }),
        },
      );
      if (!res.ok) {
        setErr(await httpErrorMessage(res, "gagal menandai lead"));
        return;
      }
      router.refresh();
    } catch {
      setErr("jaringan gagal");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Select value={value} onValueChange={(v) => void ubah(String(v))} disabled={sibuk}>
        <SelectTrigger size="sm" className="w-[132px]" aria-label={`Tipe lead ${invoiceNo}`}>
          {/* Base UI menampilkan value MENTAH tanpa render function — di sini kita
              memang mau labelnya, bukan huruf "A" telanjang. */}
          <SelectValue>{(v) => LEAD_LABEL[String(v)]?.label ?? String(v)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(LEAD_LABEL).map(([kode, l]) => (
            <SelectItem key={kode} value={kode}>
              {l.label} · {l.porsi}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {err ? <span className="text-destructive text-xs">{err}</span> : null}
    </div>
  );
}
