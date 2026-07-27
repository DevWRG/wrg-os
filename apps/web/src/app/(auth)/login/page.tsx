"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "login gagal");
      // "/" → root mengalihkan ke menu pertama yang boleh dilihat user (homePath).
      router.push(params.get("next") || "/");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-center">
      <h1 className="text-3xl font-bold tracking-tight">Halo, Tim 👋</h1>
      <p className="text-muted-foreground mt-2 text-sm">Masuk ke WRG OS</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4 text-left">
        <div className="grid gap-1.5">
          <Label htmlFor="identifier" className="sr-only">Email atau Username</Label>
          <Input
            id="identifier"
            type="text"
            placeholder="Email, panggilan, atau nomor WA"
            autoComplete="username"
            autoCapitalize="off"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="h-11 rounded-xl bg-white"
          />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="password" className="sr-only">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 rounded-xl bg-white"
          />
          <div className="flex justify-end">
            <Link href="/forgot-password" className="text-primary text-xs font-medium hover:underline">
              Lupa password?
            </Link>
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 h-11 w-full rounded-xl font-semibold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60"
          style={{ backgroundImage: "linear-gradient(90deg, #0fa5bc 0%, #0ca6bd 100%)" }}
        >
          {busy ? "Memproses…" : "Login"}
        </button>
      </form>

      <p className="text-muted-foreground mt-6 text-sm">
        Belum punya akun?{" "}
        <Link href="/forgot-password" className="text-primary font-medium hover:underline">
          Hubungi admin
        </Link>
      </p>
      <p className="text-muted-foreground/70 mt-4 text-xs leading-relaxed">
        Password awal: <code className="text-foreground/70">&lt;panggilan&gt;123</code> — segera ganti.
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
