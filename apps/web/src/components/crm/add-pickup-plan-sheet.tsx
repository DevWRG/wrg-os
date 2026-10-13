"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export interface AccountOption {
  id: string;
  name: string;
  contacts: number;
}

export interface PickupOptions {
  kurir: { wa_number: string; nama: string; cabang: string | null }[];
  sj: { number: string; trans_date: string; customer_name: string | null; account_id: number | null }[];
  sj_window_days: number;
}

const besok = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export function AddPickupPlanSheet({ accounts, options }: { accounts: AccountOption[]; options: PickupOptions }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tanggal, setTanggal] = useState(besok());
  // accountId dipilih di sini SEKALI dan disimpan ke DB — cron TIDAK fuzzy-match
  // nama customer (lihat komentar migrasi 081: faskes bisa bernama sama persis).
  const [accountId, setAccountId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [cabang, setCabang] = useState("");
  const [tujuan, setTujuan] = useState("kirim");
  const [sjNumber, setSjNumber] = useState("");
  // Nilai = nomor WA roster; nama & nomor disimpan server dari master_user.
  const [kurirWa, setKurirWa] = useState("");
  const [catatan, setCatatan] = useState("");

  const dipilih = accounts.find((a) => a.id === accountId) ?? null;
  const sjDipilih = options.sj.find((d) => d.number === sjNumber) ?? null;

  const kurirOpsi = useMemo(
    () => options.kurir.map((k) => ({ value: k.wa_number, label: k.cabang ? `${k.nama} — ${k.cabang}` : k.nama })),
    [options.kurir],
  );
  const sjOpsi = useMemo(
    () => options.sj.map((d) => ({ value: d.number, label: `${d.number} · ${d.trans_date} · ${d.customer_name ?? "?"}` })),
    [options.sj],
  );
  // Akun dari SJ bisa di luar daftar akun ber-scope milik user — tetap tampilkan
  // supaya pemicu combobox tak kosong padahal account_id terisi.
  const akunOpsi = useMemo(() => {
    const o = accounts.map((a) => ({
      value: a.id,
      label: `${a.name}${a.contacts === 0 ? " — belum ada PIC" : ` — ${a.contacts} PIC`}`,
    }));
    if (sjDipilih?.account_id != null && !accounts.some((a) => a.id === String(sjDipilih.account_id))) {
      o.unshift({ value: String(sjDipilih.account_id), label: sjDipilih.customer_name ?? `Akun ${sjDipilih.account_id}` });
    }
    return o;
  }, [accounts, sjDipilih]);

  function pilihKurir(wa: string) {
    setKurirWa(wa);
    const k = options.kurir.find((x) => x.wa_number === wa);
    // Cabang mengikuti cabang kurir di roster — tetap boleh diubah.
    if (k?.cabang) setCabang(k.cabang);
  }

  function pilihSj(no: string) {
    setSjNumber(no);
    const d = options.sj.find((x) => x.number === no);
    if (!d) return;
    // Customer ikut DO Accurate → PIC tercek tanpa menebak dari nama.
    if (d.account_id != null) setAccountId(String(d.account_id));
    if (d.customer_name) setCustomerName(d.customer_name);
  }

  function pilihAccount(id: string) {
    setAccountId(id);
    const a = accounts.find((x) => x.id === id);
    // Nama ikut terisi dari akun supaya konsisten, tapi tetap boleh diedit
    // (customer_name di DB memang teks bebas).
    if (a) setCustomerName(a.name);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kurirWa) {
      setError("Pilih kurir dulu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pickup-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tanggal,
          customer_name: customerName.trim(),
          account_id: accountId ? Number(accountId) : null,
          cabang: cabang.trim() || null,
          tujuan,
          sj_number: sjNumber.trim() || null,
          kurir_wa_number: kurirWa || null,
          catatan: catatan.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setAccountId("");
      setCustomerName("");
      setSjNumber("");
      setKurirWa("");
      setCabang("");
      setCatatan("");
      setTanggal(besok());
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" />}>
        <Plus /> Tambah jadwal
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah jadwal trip</SheetTitle>
          <SheetDescription>
            Trip Kirim-Tagih. Sistem mengecek hari libur & PIC H-1 (sore hari sebelumnya).
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="pp-tanggal">Tanggal trip *</Label>
              <Input id="pp-tanggal" type="date" required value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-tujuan">Tujuan trip *</Label>
              <select
                id="pp-tujuan"
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                value={tujuan}
                onChange={(e) => setTujuan(e.target.value)}
              >
                <option value="kirim">Kirim barang</option>
                <option value="tagih">Tagih / ambil faktur</option>
                <option value="kirim+tagih">Kirim + tagih</option>
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-sj">No. SJ (opsional)</Label>
              <Combobox
                id="pp-sj"
                value={sjNumber}
                onChange={pilihSj}
                options={sjOpsi}
                emptyOption="— tanpa SJ —"
                placeholder="— pilih SJ —"
                searchPlaceholder="Cari nomor SJ / customer…"
              />
              <p className="text-muted-foreground text-xs">
                SJ dari DO Accurate {options.sj_window_days} hari terakhir yang belum #TERIMA/#BAST dan belum
                dijadwalkan. Memilih SJ mengisi customer otomatis. Trip tagih boleh tanpa SJ.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-account">Customer (dari daftar akun)</Label>
              <Combobox
                id="pp-account"
                value={accountId}
                onChange={pilihAccount}
                options={akunOpsi}
                emptyOption="— tanpa akun —"
                placeholder="— pilih akun (opsional) —"
                searchPlaceholder="Cari faskes…"
              />
              <p className="text-muted-foreground text-xs">
                Pilih dari daftar supaya PIC & backup-nya bisa ikut dicek. Kalau dikosongkan, verifikasi
                PIC dilewati — sistem sengaja tidak menebak akun dari nama.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-customer">Nama customer *</Label>
              <Input
                id="pp-customer"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="RS Umum Daerah …"
              />
              {dipilih && dipilih.contacts === 0 && (
                <p className="text-warning text-xs">
                  Akun ini belum punya kontak PIC — tambahkan dulu di menu Accounts kalau mau ikut dicek.
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-kurir">Kurir *</Label>
              <Combobox
                id="pp-kurir"
                value={kurirWa}
                onChange={pilihKurir}
                options={kurirOpsi}
                placeholder={kurirOpsi.length ? "— pilih kurir —" : "Roster Kirim Tagih kosong"}
                searchPlaceholder="Cari nama / cabang…"
                disabled={!kurirOpsi.length}
              />
              <p className="text-muted-foreground text-xs">
                Dari roster karyawan Kirim Tagih. Hasil cek H-1 dikirim ke WA kurir yang tercatat di roster.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-cabang">Cabang / station *</Label>
              <Input id="pp-cabang" required value={cabang} onChange={(e) => setCabang(e.target.value)} placeholder="Terisi dari cabang kurir" />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-catatan">Catatan</Label>
              <Textarea id="pp-catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} />
            </div>

            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
