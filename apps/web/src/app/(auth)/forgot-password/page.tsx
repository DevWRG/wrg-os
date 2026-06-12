import Link from "next/link";
import { AtSign } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Reset password</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
        Masukkan email perusahaan, kami kirim instruksi reset.
      </p>

      <div className="mt-8 space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <AtSign className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input id="email" type="email" placeholder="nama@wahanalifeline.co.id" required className="pl-9" />
          </div>
        </div>
        <Button className="w-full">Send reset link</Button>
      </div>

      <p className="text-muted-foreground mt-6 text-sm">
        <Link href="/login" className="text-primary font-medium hover:underline">
          Kembali ke sign in
        </Link>
      </p>
    </div>
  );
}
