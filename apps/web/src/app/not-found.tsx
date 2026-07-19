import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-full">
        <FileQuestion className="size-8" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">404</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          Halaman yang lo cari ga ketemu. Mungkin URL salah atau halamannya sudah dipindah.
        </p>
      </div>
      <Button render={<Link href="/overview" />} nativeButton={false}>Back to overview</Button>
    </div>
  );
}
