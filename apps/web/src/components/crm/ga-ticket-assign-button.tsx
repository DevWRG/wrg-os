"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { AppUserOption } from "./add-ga-ticket-button";

export interface TeknisiOption {
  id: string;
  nama: string;
  aktif: boolean;
}

const NONE = "__none__";

export function GaTicketAssignButton({
  ticketId, currentName, users, teknisi,
}: { ticketId: string; currentName: string | null; users: AppUserOption[]; teknisi: TeknisiOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assignee_user_id: userId || undefined,
          assignee_name_override: userId ? undefined : name.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal assign");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Assign" />}>
        <UserPlus /> {currentName ?? "Assign"}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign tiket</DialogTitle>
          <DialogDescription>Pilih Admin GA/Teknisi cabang penanganan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>User terdaftar</Label>
              <Select value={userId || NONE} onValueChange={(v) => setUserId(v === NONE ? "" : (v ?? ""))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih user">{(v: string) => (v === NONE ? "Pilih user" : users.find((u) => u.id === v)?.name ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— tidak pilih —</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>)}
                </SelectContent>
              </Select>
              {teknisi.length > 0 && (
                <>
                  <p className="text-muted-foreground text-xs">Atau pilih dari roster Teknisi (F8):</p>
                  <select
                    className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setUserId("");
                      setName(teknisi.find((t) => t.id === e.target.value)?.nama ?? "");
                    }}
                  >
                    <option value="">— pilih teknisi —</option>
                    {teknisi.filter((t) => t.aktif).map((t) => (
                      <option key={t.id} value={t.id}>{t.nama}</option>
                    ))}
                  </select>
                </>
              )}
              <p className="text-muted-foreground text-xs">Atau kalau belum terdaftar di keduanya, isi nama bebas:</p>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama bebas" disabled={!!userId} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || (!userId && !name.trim())}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
