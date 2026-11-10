"use client";

import { useState } from "react";
import { Copy, MessageSquareText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/sph/sph-ui";
import { FORMAT_KSO, FORMAT_KSO_TAMBAHAN } from "@/lib/kso-komite-daftar";

import { salinTeks } from "./salin";

/** Tombol bantuan "Format #KSO": templat dua belas isian + cara melengkapi, dengan tombol salin. */
export function TombolFormatKso() {
  const [buka, setBuka] = useState(false);
  const { toast, node } = useToast();
  const salin = async () => {
    if (await salinTeks(FORMAT_KSO)) toast("sukses", "Disalin", "Templat #KSO siap ditempel di WhatsApp.");
    else toast("gagal", "Gagal menyalin", "Pilih teks templat lalu salin manual.");
  };
  return (
    <>
      {node}
      <Button type="button" size="sm" variant="soft" onClick={() => setBuka(true)}>
        <MessageSquareText aria-hidden />Format #KSO
      </Button>
      <Dialog open={buka} onOpenChange={setBuka}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Format #KSO di WhatsApp</DialogTitle>
            <DialogDescription>
              Satu pesan, nama AM sendiri di baris pertama, lalu dua belas isian bernomor — semuanya bisa lengkap sekali kirim.
              Nomor 10 dan 11 pilih satu; baris tambahan hanya bila perlu. Kota tidak perlu ditulis (diambil dari data customer
              atau area AM). Contoh di bawah fiktif.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <pre className="border-border bg-white max-w-full overflow-x-auto rounded-lg border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap dark:bg-card">{FORMAT_KSO}</pre>
            <Button type="button" onClick={salin}><Copy aria-hidden />Salin templat</Button>
            <dl className="space-y-2 text-sm">
              {FORMAT_KSO_TAMBAHAN.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-medium">{k}</dt>
                  <dd className="text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-muted-foreground text-xs">Voice note dan teks bebas tidak diproses untuk #KSO.</p>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
