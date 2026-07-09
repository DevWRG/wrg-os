"use client";

import { useCallback, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface ConfirmOpts {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

// Hook konfirmasi via modal (pengganti window.confirm). Pakai:
//   const { confirm, dialog } = useConfirm();
//   ...onClick={() => confirm({ title, destructive: true }, () => doDelete())}
//   ...return (<>{...}{dialog}</>)
export function useConfirm() {
  const [state, setState] = useState<(ConfirmOpts & { onConfirm: () => void }) | null>(null);
  const confirm = useCallback((opts: ConfirmOpts, onConfirm: () => void) => setState({ ...opts, onConfirm }), []);
  const dialog = state ? (
    <ConfirmDialog
      open
      onOpenChange={(v) => { if (!v) setState(null); }}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      destructive={state.destructive}
      onConfirm={state.onConfirm}
    />
  ) : null;
  return { confirm, dialog };
}
