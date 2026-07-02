"use client";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Modal konfirmasi bergaya (pengganti confirm() bawaan browser). Klik OK →
// modal tutup + jalankan onConfirm. Bisa dipakai bertingkat (nested) di dalam
// Dialog lain karena @base-ui/react/dialog mendukung nested.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "Batal",
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" showCloseButton={false} forceOverlay>
        <div className="flex flex-col gap-1.5 p-4">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{cancelLabel}</DialogClose>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
