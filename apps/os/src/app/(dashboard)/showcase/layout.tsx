"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const tabs = [
  { href: "/showcase", label: "Overview" },
  { href: "/showcase/buttons", label: "Buttons" },
  { href: "/showcase/forms", label: "Forms" },
  { href: "/showcase/tables", label: "Tables" },
  { href: "/showcase/cards", label: "Cards" },
  { href: "/showcase/charts", label: "Charts" },
  { href: "/showcase/icons", label: "Icons" },
  { href: "/showcase/typography", label: "Typography" },
];

export default function ShowcaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">UI Showcase</h1>
        <p className="text-muted-foreground text-sm">
          Komponen reference Adminator-style untuk develop page baru.
        </p>
      </div>

      <div className="border-b">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => {
            const active =
              t.href === "/showcase"
                ? pathname === "/showcase"
                : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "inline-flex shrink-0 items-center border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col gap-6">{children}</div>
    </div>
  );
}
