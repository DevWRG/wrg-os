"use client";

import { useMemo } from "react";

import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";

// F55 — field "Pengganti (Backup PIC)" yang dipakai bersama form tambah cuti,
// edit cuti, dan approve pending. Validasi final (wajib utk cuti yang belum
// selesai, pengganti aktif & tidak ikut cuti) ada di API; di sini cuma petunjuk.

export interface BackupUser {
  am_id: string;
  nama: string;
  panggilan: string | null;
  cabang?: string | null;
  aktif?: boolean;
}

export function BackupPicField({
  id, users, value, onChange, excludeAmId, jenis,
}: {
  id: string;
  users: BackupUser[];
  value: string;
  onChange: (v: string) => void;
  /** Orang yang cuti — tidak bisa jadi pengganti dirinya sendiri. */
  excludeAmId?: string;
  jenis: string;
}) {
  const options = useMemo(
    () =>
      users
        .filter((u) => u.aktif !== false && u.am_id !== excludeAmId)
        .map((u) => ({ value: u.am_id, label: `${u.panggilan ?? u.nama}${u.cabang ? ` — ${u.cabang}` : ""}` })),
    [users, excludeAmId],
  );
  const wajib = jenis === "cuti";
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Pengganti (Backup PIC){wajib ? " *" : ""}</Label>
      <Combobox
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        emptyOption={wajib ? undefined : "— tidak ada —"}
        placeholder="— pilih pengganti —"
        searchPlaceholder="Cari nama / cabang…"
      />
      <p className="text-muted-foreground text-xs">
        {wajib ? "Wajib untuk cuti." : "Opsional untuk sakit/izin."} Grup terkait &amp; pengganti diberi tahu via WA.
      </p>
    </div>
  );
}
