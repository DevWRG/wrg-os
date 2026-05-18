import Link from "next/link";
import {
  MousePointerClick,
  FormInput,
  Table as TableIcon,
  LayoutGrid,
  LineChart,
  Sparkles,
  Type,
} from "lucide-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const items = [
  {
    href: "/showcase/buttons",
    title: "Buttons",
    description: "Variant, size, icon, destructive, ghost.",
    icon: MousePointerClick,
  },
  {
    href: "/showcase/forms",
    title: "Forms",
    description: "Input, Textarea, Select, Checkbox, Radio, Switch.",
    icon: FormInput,
  },
  {
    href: "/showcase/tables",
    title: "Tables",
    description: "Basic, striped, dengan badge & action menu.",
    icon: TableIcon,
  },
  {
    href: "/showcase/cards",
    title: "Cards",
    description: "Stat card, content card, header+footer.",
    icon: LayoutGrid,
  },
  {
    href: "/showcase/charts",
    title: "Charts",
    description: "Line, bar, pie pakai Recharts via shadcn chart.",
    icon: LineChart,
  },
  {
    href: "/showcase/icons",
    title: "Icons",
    description: "Lucide icon picks yang dipakai di app.",
    icon: Sparkles,
  },
  {
    href: "/showcase/typography",
    title: "Typography",
    description: "Heading scale, paragraph, list, code.",
    icon: Type,
  },
];

export default function ShowcaseOverviewPage() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="group">
          <Card className="hover:border-primary/40 group-hover:bg-accent/40 h-full transition-colors">
            <CardHeader className="flex flex-row items-start gap-3 space-y-0">
              <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
                <item.icon className="size-5" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
