"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { KATEGORI_LABEL, rupiah, type CashinAccount, type CashinLine } from "./cashin-types";

const KATEGORI_VARIAN: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  uang_masuk_riil: "default",
  afiliasi_grup: "secondary",
  puteran_internal: "outline",
  belum_ditriage: "destructive",
};

const jam = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) : "-";

/** Tabel baris mutasi, mode SERVER.
 *
 *  Paginasi/sort/search dikerjakan backend dan `total_rows` datang dari COUNT di
 *  sana. Mode client akan berbohong di sini: satu hari saja bisa 60 baris
 *  (Mandiri 4 Sep) dan tanpa filter tanggal jumlahnya menumpuk tiap hari, jadi
 *  daftar yang terpotong limit akan menampilkan angka yang tidak utuh. */
export function CashinLinesTable({
  tanggal,
  accounts,
}: {
  tanggal: string;
  accounts: CashinAccount[];
}) {
  const [rows, setRows] = useState<CashinLine[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [kategori, setKategori] = useState("");
  const [akun, setAkun] = useState("");
  const [pending, mulai] = useTransition();

  const ambil = useCallback(async () => {
    const p = new URLSearchParams({ tanggal, limit: String(pageSize), offset: String(page * pageSize) });
    if (q) p.set("q", q);
    if (kategori) p.set("kategori", kategori);
    if (akun) p.set("bank_account_id", akun);
    if (sort) {
      p.set("sort", sort.id);
      p.set("dir", sort.dir);
    }
    const res = await fetch(`/api/cashin/lines?${p.toString()}`);
    if (!res.ok) return;
    const data = (await res.json()) as { rows: CashinLine[]; total_rows: number };
    setRows(data.rows ?? []);
    setTotalRows(data.total_rows ?? 0);
  }, [tanggal, pageSize, page, q, kategori, akun, sort]);

  useEffect(() => {
    mulai(() => {
      void ambil();
    });
  }, [ambil]);

  async function triage(id: string, kat: string) {
    const res = await fetch(`/api/cashin/lines/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kategori: kat }),
    });
    if (res.ok) void ambil();
  }

  const columns: DataColumn<CashinLine>[] = [
    { id: "label_file", header: "Rekening", sortable: true, accessor: (r) => r.label_file },
    { id: "waktu", header: "Jam", sortable: true, accessor: (r) => r.waktu ?? "", cell: (r) => jam(r.waktu) },
    {
      id: "deskripsi",
      header: "Deskripsi",
      sortable: true,
      accessor: (r) => r.deskripsi,
      cell: (r) => (
        <div>
          <div className="max-w-[420px] break-words">{r.deskripsi || "-"}</div>
          {r.referensi && <div className="text-muted-foreground text-xs">Ref: {r.referensi}</div>}
          {r.catatan && <div className="text-muted-foreground text-xs">{r.catatan}</div>}
        </div>
      ),
    },
    {
      id: "kredit",
      header: "Masuk",
      align: "right",
      sortable: true,
      accessor: (r) => Number(r.kredit),
      cell: (r) => (Number(r.kredit) > 0 ? rupiah(r.kredit) : "-"),
    },
    {
      id: "debit",
      header: "Keluar",
      align: "right",
      sortable: true,
      accessor: (r) => Number(r.debit),
      cell: (r) => (Number(r.debit) > 0 ? rupiah(r.debit) : "-"),
    },
    {
      id: "kategori",
      header: "Kategori",
      sortable: true,
      accessor: (r) => r.kategori,
      cell: (r) => (
        <div className="flex flex-col gap-1">
          <Badge variant={KATEGORI_VARIAN[r.kategori] ?? "outline"}>{KATEGORI_LABEL[r.kategori] ?? r.kategori}</Badge>
          {r.kategori_oleh === "manual" && <span className="text-muted-foreground text-xs">ditriage manual</span>}
          {r.pasangan_line_id && <span className="text-muted-foreground text-xs">berpasangan</span>}
        </div>
      ),
    },
    {
      id: "aksi",
      header: "Triage",
      cell: (r) =>
        // Hanya baris yang memang perlu keputusan manusia yang menampilkan
        // aksi. Menawarkan triage untuk semua baris membuat 60 pengeluaran
        // rutin per hari ikut mengundang klik yang tak ada gunanya.
        r.kategori === "belum_ditriage" || r.kategori_oleh === "manual" ? (
          // <select> asli, bukan FilterSelect: komponen itu selalu menambah
          // opsi kosong "Semua" — di sini tidak ada kategori "semua", tiap
          // baris harus punya satu kategori.
          <select
            value={r.kategori}
            onChange={(e) => void triage(r.id, e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
          >
            {Object.entries(KATEGORI_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rows}
      getKey={(r) => r.id}
      searchPlaceholder="Cari deskripsi / referensi…"
      empty="Tidak ada mutasi pada filter ini."
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Kategori"
            value={kategori}
            onChange={(v) => {
              setKategori(v);
              setPage(0);
            }}
            options={Object.entries(KATEGORI_LABEL).map(([value, label]) => ({ value, label }))}
            semua="Semua kategori"
          />
          <FilterSelect
            label="Rekening"
            value={akun}
            onChange={(v) => {
              setAkun(v);
              setPage(0);
            }}
            options={accounts.map((a) => ({ value: a.id, label: a.label_file }))}
            semua="Semua rekening"
          />
        </div>
      }
      server={{
        totalRows,
        page,
        pageSize,
        sort,
        q,
        pending,
        onPageChange: setPage,
        onPageSizeChange: (s) => {
          setPageSize(s);
          setPage(0);
        },
        onSortChange: setSort,
        onSearchChange: (v) => {
          setQ(v);
          setPage(0);
        },
      }}
    />
  );
}
