"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { DataTable, type DataColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface AccurateVendor {
  id: string;
  name: string | null;
  branch_name: string | null;
}

interface VendorDetail {
  name: string | null;
  no: string | null;
  branch: string | null;
  email: string | null;
  phone: string | null;
  npwp: string | null;
  address: string | null;
  notes: string | null;
}

const columns: DataColumn<AccurateVendor>[] = [
  { id: "name", header: "Nama Vendor", sortable: true, accessor: (v) => v.name ?? "", cell: (v) => <span className="font-medium">{v.name ?? "—"}</span> },
  { id: "branch", header: "Cabang", sortable: true, accessor: (v) => v.branch_name ?? "", cell: (v) => <span className="text-muted-foreground">{v.branch_name ?? "—"}</span> },
];

function Field({ label, value, full }: { label: string; value: string | null; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : undefined}>
      <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</div>
      <div className="break-words">{value ?? "—"}</div>
    </div>
  );
}

export function SuppliersTable({ vendors }: { vendors: AccurateVendor[] }) {
  const [sel, setSel] = useState<AccurateVendor | null>(null);
  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [err, setErr] = useState(false);

  function openDetail(v: AccurateVendor) {
    setSel(v);
    setDetail(null);
    setErr(false);
    fetch(`/api/vendors/${encodeURIComponent(v.id)}/detail`)
      .then((r) => r.json())
      .then((d: { vendor?: VendorDetail }) => {
        if (d.vendor) setDetail(d.vendor);
        else setErr(true);
      })
      .catch(() => setErr(true));
  }

  return (
    <>
      <DataTable columns={columns} data={vendors} getKey={(v) => v.id} searchPlaceholder="Cari vendor…" pageSize={25} onRowClick={openDetail} />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Supplier</div>
                <DialogTitle className="break-words">{detail?.name ?? sel.name ?? "—"}</DialogTitle>
                {(detail?.no || sel.branch_name) && (
                  <div className="text-muted-foreground text-sm">
                    {[detail?.no, detail?.branch ?? sel.branch_name].filter(Boolean).join(" · ")}
                  </div>
                )}
              </DialogHeader>
              <DialogBody className="text-sm">
                {detail === null && !err ? (
                  <div className="text-muted-foreground flex items-center gap-2 py-2 text-xs">
                    <Loader2 className="size-3.5 animate-spin" /> Memuat rincian…
                  </div>
                ) : err ? (
                  <div className="text-muted-foreground py-2 text-xs">Gagal memuat rincian vendor.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="No. Vendor" value={detail!.no} />
                    <Field label="Cabang" value={detail!.branch} />
                    <Field label="Email" value={detail!.email} />
                    <Field label="Telepon" value={detail!.phone} />
                    <Field label="NPWP" value={detail!.npwp} />
                    <Field label="Alamat" value={detail!.address} full />
                    {detail!.notes && <Field label="Catatan" value={detail!.notes} full />}
                  </div>
                )}
              </DialogBody>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
