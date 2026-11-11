"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface PromptOpts {
  title: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Isian wajib: tombol konfirmasi nonaktif selama kosong. */
  required?: boolean;
  /** Kotak teks beberapa baris (alasan) — bawaan satu baris. */
  multiline?: boolean;
  destructive?: boolean;
  maxLength?: number;
}

// Hook isian via modal (pengganti window.prompt), pasangan useConfirm. Pakai:
//   const { prompt, dialog } = usePrompt();
//   ...onClick={() => prompt({ title: "Alasan menolak", required: true, multiline: true }, (v) => tolak(v))}
//   ...return (<>{...}{dialog}</>)
// onSubmit menerima teks yang sudah di-trim; Batal / tutup = tidak memanggil apa pun.
export function usePrompt() {
  const [state, setState] = useState<(PromptOpts & { onSubmit: (v: string) => void }) | null>(null);
  const [nilai, setNilai] = useState("");
  const prompt = useCallback((opts: PromptOpts, onSubmit: (v: string) => void) => {
    setNilai(opts.defaultValue ?? "");
    setState({ ...opts, onSubmit });
  }, []);
  const tutup = () => setState(null);
  const kirim = () => {
    if (!state) return;
    const v = nilai.trim();
    if (state.required && !v) return;
    const fn = state.onSubmit;
    setState(null);
    fn(v);
  };
  const dialog = state ? (
    <Dialog open onOpenChange={(o) => { if (!o) tutup(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.description ? <DialogDescription>{state.description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          {state.multiline ? (
            <Textarea autoFocus rows={3} value={nilai} placeholder={state.placeholder} maxLength={state.maxLength}
              onChange={(e) => setNilai(e.target.value)} />
          ) : (
            <Input autoFocus value={nilai} placeholder={state.placeholder} maxLength={state.maxLength}
              onChange={(e) => setNilai(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); kirim(); } }} />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={tutup}>{state.cancelLabel ?? "Batal"}</Button>
          <Button variant={state.destructive ? "destructive" : "default"} disabled={!!state.required && !nilai.trim()} onClick={kirim}>
            {state.confirmLabel ?? "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;
  return { prompt, dialog };
}
