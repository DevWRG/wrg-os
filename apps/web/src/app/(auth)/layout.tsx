import Link from "next/link";
import { HeartPulse } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-muted/40 flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <Link
        href="/dashboard"
        className="mb-8 flex items-center gap-2 text-sm font-semibold"
      >
        <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md">
          <HeartPulse className="size-4" />
        </div>
        <div className="flex flex-col leading-none">
          <span>WRG OS</span>
          <span className="text-muted-foreground text-xs font-normal">
            Wahana Lifeline
          </span>
        </div>
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
