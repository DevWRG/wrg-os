import Link from "next/link";
import { AtSign, Lock, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">Create account</h1>
      <p className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
        Pendaftaran user dilakukan oleh admin. Hubungi tim IT untuk request akses.
      </p>

      <div className="mt-8 space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="name">Full Name</Label>
          <div className="relative">
            <UserRound className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input id="name" placeholder="Nama lengkap" required className="pl-9" />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <AtSign className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input id="email" type="email" placeholder="nama@wahanalifeline.co.id" required className="pl-9" />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Lock className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input id="password" type="password" placeholder="••••••••" required className="pl-9" />
          </div>
        </div>
        <Button className="w-full">Create account</Button>
      </div>

      <p className="text-muted-foreground mt-6 text-sm">
        Sudah punya akun?{" "}
        <Link href="/login" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
