"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="bg-destructive/10 text-destructive flex size-16 items-center justify-center rounded-full">
        <AlertTriangle className="size-8" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Ada error yang ga ke-handle. Coba refresh, atau hubungi tim IT kalau berulang.
        </p>
        {error.digest ? (
          <p className="text-muted-foreground font-mono text-xs">
            Ref: {error.digest}
          </p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
