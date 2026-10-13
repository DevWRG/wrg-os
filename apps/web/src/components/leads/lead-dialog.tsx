"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { ISIAN_KOSONG, LeadForm, keBody, selCls, type IsianLead } from "./lead-form";
import { BANT_LOLOS, STATUS_CLS, STATUS_LABEL, SUMBER_LABEL, kirim, type AmOpsi, type Duplikat, type Lead, type SumberLead } from "./types";

const keIsian = (l: Lead): IsianLead => ({
  facility_name: l.facility_name, city: l.city ?? "", kebutuhan: l.kebutuhan ?? "", brand: l.brand ?? "",
  product: l.product ?? "", product_category: l.product_category ?? "", estimate_amount: l.estimate_amount == null ? "" : String(l.estimate_amount),
  purchase_month: l.purchase_month == null ? "" : String(l.purchase_month), purchase_year: l.purchase_year == null ? "" : String(l.purchase_year),
  contact_name: l.contact_name ?? "", contact_role: l.contact_role ?? "", contact_phone: l.contact_phone ?? "",
  notes: l.notes ?? "", source_detail: l.source_detail ?? "",
  bant_budget: l.bant_budget, bant_authority: l.bant_authority, bant_need: l.bant_need, bant_timeline: l.bant_timeline,
});

// ── Tambah ──────────────────────────────────────────────────────────────────

export function TambahLeadDialog({ open, onClose, amOpsi }: { open: boolean; onClose: () => void; amOpsi: AmOpsi[] }) {
  const router = useRouter();
  const [f, setF] = useState<IsianLead>(ISIAN_KOSONG);
  const [sumber, setSumber] = useState<SumberLead>("web");
  const [am, setAm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function simpan() {
    setBusy(true);
    setErr(null);
    try {
      const d = await kirim<{ lead: Lead; duplikat: Duplikat[]; terlihat: boolean }>("/api/leads", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...keBody(f), source: sumber, am_id: am || null }),
      });
      router.refresh();
      const pesan = [
        `Lead ${d.lead.kode} tercatat${d.lead.am_nama ? ` — AM ${d.lead.am_nama}` : " — belum ber-AM"}.`,
        d.duplikat.length ? `Mirip yang masih terbuka: ${d.duplikat.map((x) => (x.jenis === "lead" ? x.ref : `deal ${x.nama}`)).join(", ")}.` : null,
        !d.terlihat ? "Lead ini ter-routing ke cabang di luar tim Anda, jadi tidak akan muncul di daftar Anda." : null,
      ].filter(Boolean).join(" ");
      if (d.duplikat.length || !d.terlihat) { setInfo(pesan); setF(ISIAN_KOSONG); setAm(""); } else onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah lead</DialogTitle>
          <DialogDescription>Isi kota supaya sistem bisa menentukan AM-nya dari peta wilayah. Lead dari WhatsApp cukup lewat #LEADS.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {info && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">{info}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="ld-sumber">Sumber</Label>
              <select id="ld-sumber" className={selCls} value={sumber} onChange={(e) => setSumber(e.target.value as SumberLead)}>
                {(Object.keys(SUMBER_LABEL) as SumberLead[]).filter((s) => s !== "wa").map((s) => <option key={s} value={s}>{SUMBER_LABEL[s]}</option>)}
              </select></div>
            {amOpsi.length > 0 && (
              <div className="space-y-1"><Label htmlFor="ld-am">AM (opsional)</Label>
                <select id="ld-am" className={selCls} value={am} onChange={(e) => setAm(e.target.value)}>
                  <option value="">Tentukan dari kota</option>
                  {amOpsi.map((a) => <option key={a.am_id} value={a.am_id}>{a.nama}{a.cabang ? ` · ${a.cabang}` : ""}</option>)}
                </select></div>
            )}
          </div>
          <LeadForm f={f} setF={setF} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{info ? "Tutup" : "Batal"}</Button>
          <Button onClick={simpan} disabled={busy || !f.facility_name.trim()}>{busy ? "Menyimpan…" : "Simpan lead"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail / ubah / konversi ────────────────────────────────────────────────

export function LeadDialog({ id, onClose, amOpsi, bolehUbah }: { id: string | null; onClose: () => void; amOpsi: AmOpsi[]; bolehUbah: boolean }) {
  const router = useRouter();
  const [lead, setLead] = useState<(Lead & { duplikat: Duplikat[] }) | null>(null);
  const [f, setF] = useState<IsianLead>(ISIAN_KOSONG);
  const [am, setAm] = useState("");
  const [tolak, setTolak] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let batal = false;
    kirim<Lead & { duplikat: Duplikat[] }>(`/api/leads/${id}`)
      .then((d) => { if (!batal) { setLead(d); setF(keIsian(d)); setAm(d.am_id ?? ""); } })
      .catch((e) => { if (!batal) setErr((e as Error).message); });
    return () => { batal = true; };
  }, [id]);

  const terkunci = !bolehUbah || lead?.status === "dikonversi";
  const skor = [f.bant_budget, f.bant_authority, f.bant_need, f.bant_timeline].filter(Boolean).length;

  async function aksi(body: Record<string, unknown>, url = `/api/leads/${id}`, method = "PATCH") {
    setBusy(true);
    setErr(null);
    try {
      const d = await kirim<Lead | { lead: Lead; deal_id: string }>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      router.refresh();
      const l = "lead" in d ? d.lead : d;
      setLead((x) => (x ? { ...x, ...l } : x));
      setF(keIsian(l));
      setAm(l.am_id ?? "");
      setTolak(null);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const simpan = () => aksi({ ...keBody(f), ...(amOpsi.length && am !== (lead?.am_id ?? "") ? { am_id: am || null } : {}) });
  // Konversi memakai isian yang SEDANG tampil: simpan dulu, baru konversi —
  // supaya centang BANT yang baru diklik ikut terhitung.
  const konversi = async () => { if (await simpan()) await aksi({}, `/api/leads/${id}/konversi`, "POST"); };

  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) { setLead(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lead ? `${lead.kode} · ${lead.facility_name}` : "Lead"}</DialogTitle>
          {lead && (
            <DialogDescription>
              <span className={cn("mr-2 rounded px-1.5 py-0.5 text-xs font-semibold", STATUS_CLS[lead.status])}>{STATUS_LABEL[lead.status]}</span>
              {SUMBER_LABEL[lead.source]}{lead.source_detail ? ` — ${lead.source_detail}` : ""} · dicatat {lead.created_by ?? "—"}
              {lead.account_id ? " · sudah pelanggan di Accurate" : ""}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogBody className="space-y-3">
          {err && <p className="text-destructive text-sm">{err}</p>}
          {!lead && !err && <p className="text-muted-foreground text-sm">Memuat…</p>}
          {lead && (
            <>
              {lead.status === "dikonversi" && (
                <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
                  Sudah jadi deal di Pipeline. Perubahan berikutnya dilakukan di kartu deal-nya.
                </p>
              )}
              {lead.status === "ditolak" && (
                <p className="rounded-md border px-3 py-2 text-sm">Ditolak: <span className="font-medium">{lead.alasan_tolak}</span></p>
              )}
              {lead.basi && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  Sudah {lead.hari_kerja_baru} hari kerja berstatus Baru — hubungi faskesnya lalu tandai Dihubungi.
                </p>
              )}
              {lead.duplikat.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                  Mirip yang masih terbuka:
                  <ul className="ml-4 list-disc">{lead.duplikat.map((d) => <li key={d.jenis + d.ref}>{d.jenis === "lead" ? `lead ${d.ref}` : "deal di Pipeline"} — {d.nama} ({d.status})</li>)}</ul>
                  Kalau ternyata faskes & kebutuhan yang sama, tolak lead ini dengan alasan duplikat.
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label>AM</Label>
                  {amOpsi.length > 0 && !terkunci ? (
                    <select className={selCls} value={am} onChange={(e) => setAm(e.target.value)}>
                      <option value="">— belum ada —</option>
                      {amOpsi.map((a) => <option key={a.am_id} value={a.am_id}>{a.nama}{a.cabang ? ` · ${a.cabang}` : ""}</option>)}
                    </select>
                  ) : <div className="flex h-9 items-center text-sm">{lead.am_nama ?? <span className="text-muted-foreground">Belum ada</span>}</div>}
                </div>
                <div className="space-y-1"><Label>Cabang · HoD</Label>
                  <div className="flex h-9 items-center text-sm">{[lead.cabang, lead.pic_hod_nama ?? lead.pic_hod].filter(Boolean).join(" · ") || "—"}</div></div>
                <div className="space-y-1"><Label>Ditentukan dari</Label>
                  <div className="flex h-9 items-center text-sm">{({ wilayah: "Peta wilayah (kota)", pengirim: "AM pelapor", manual: "Ditunjuk manual", "tak-terpetakan": "Belum terpetakan" } as Record<string, string>)[lead.routing_via] ?? lead.routing_via}</div></div>
              </div>
              <LeadForm f={f} setF={setF} disabled={terkunci} />
              {tolak !== null && (
                <div className="space-y-1"><Label htmlFor="ld-tolak">Alasan menolak *</Label>
                  <Input id="ld-tolak" value={tolak} onChange={(e) => setTolak(e.target.value)} placeholder="mis. duplikat LD-0012 / bukan target / sudah pakai kompetitor kontrak 5 tahun" /></div>
              )}
            </>
          )}
        </DialogBody>
        {lead && bolehUbah && lead.status !== "dikonversi" && (
          <DialogFooter className="flex-wrap gap-2">
            {lead.status === "ditolak" ? (
              <Button variant="soft" disabled={busy} onClick={() => aksi({ status: "baru" })}>Buka lagi</Button>
            ) : tolak === null ? (
              <Button variant="ghost" disabled={busy} onClick={() => setTolak("")}>Tolak…</Button>
            ) : (
              <Button variant="ghost" disabled={busy || !tolak.trim()} onClick={() => aksi({ status: "ditolak", alasan_tolak: tolak })}>Simpan penolakan</Button>
            )}
            {lead.status === "baru" && <Button variant="soft" disabled={busy} onClick={() => aksi({ ...keBody(f), status: "dihubungi" })}>Tandai dihubungi</Button>}
            {lead.status !== "ditolak" && <Button variant="soft" disabled={busy || !f.facility_name.trim()} onClick={() => void simpan()}>Simpan</Button>}
            {lead.status !== "ditolak" && (
              <Button disabled={busy || skor < BANT_LOLOS || !(am || lead.am_id)} onClick={() => void konversi()}
                title={skor < BANT_LOLOS ? `BANT ${skor}/4 — perlu minimal ${BANT_LOLOS}` : !(am || lead.am_id) ? "Tunjuk AM dulu" : undefined}>
                Konversi jadi deal
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
