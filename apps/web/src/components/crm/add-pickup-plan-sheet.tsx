"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
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

const besok = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export function AddPickupPlanSheet({ accounts }: { accounts: AccountOption[] }) {
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
  const [kurirName, setKurirName] = useState("");
  const [kurirWa, setKurirWa] = useState("");
  const [catatan, setCatatan] = useState("");

  const dipilih = accounts.find((a) => a.id === accountId) ?? null;

  function pilihAccount(id: string) {
    setAccountId(id);
    const a = accounts.find((x) => x.id === id);
    // Nama ikut terisi dari akun supaya konsisten, tapi tetap boleh diedit
    // (customer_name di DB memang teks bebas).
    if (a) setCustomerName(a.name);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
          kurir_name: kurirName.trim() || null,
          kurir_wa_number: kurirWa.trim() || null,
          catatan: catatan.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setAccountId("");
      setCustomerName("");
      setSjNumber("");
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
              <Label htmlFor="pp-account">Customer (dari daftar akun)</Label>
              <select
                id="pp-account"
                className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                value={accountId}
                onChange={(e) => pilihAccount(e.target.value)}
              >
                <option value="">— pilih akun (opsional) —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.contacts === 0 ? " — belum ada PIC" : ` — ${a.contacts} PIC`}
                  </option>
                ))}
              </select>
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
              <Input id="pp-sj" value={sjNumber} onChange={(e) => setSjNumber(e.target.value)} placeholder="SJ/2026/07/0001" />
              <p className="text-muted-foreground text-xs">Trip tagih biasanya tanpa SJ — boleh dikosongkan.</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-cabang">Cabang / station *</Label>
              <Input id="pp-cabang" required value={cabang} onChange={(e) => setCabang(e.target.value)} placeholder="Surabaya" />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-kurir">Nama kurir *</Label>
              <Input id="pp-kurir" required value={kurirName} onChange={(e) => setKurirName(e.target.value)} placeholder="Munir" />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="pp-kurir-wa">Nomor WA kurir *</Label>
              <Input id="pp-kurir-wa" required value={kurirWa} onChange={(e) => setKurirWa(e.target.value)} placeholder="628…" />
              <p className="text-muted-foreground text-xs">
                Tujuan hasil cek H-1. Belum ada form edit setelah disimpan — pastikan benar sebelum submit.
              </p>
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
