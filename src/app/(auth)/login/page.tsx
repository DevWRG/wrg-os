import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Masuk ke dashboard internal WRG OS dengan email perusahaan.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="nama@wahanalifeline.co.id"
            autoComplete="email"
            required
          />
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Lupa password?
            </Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" required />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button className="w-full">Sign in</Button>
        <p className="text-muted-foreground text-center text-xs">
          Belum punya akun?{" "}
          <Link href="/signup" className="text-foreground underline">
            Daftar
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
