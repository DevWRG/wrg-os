"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        // Wadah tab dibikin seperti KARTU (putih + bingkai + bayangan, pola
        // yang sama dengan components/ui/card.tsx), bukan `bg-muted`.
        //
        // KENAPA: di terang `--muted` #f1f5f9 dan `--background` #f0f4f8 cuma
        // beda 1–2 per kanal, jadi bilah tab melebur ke halaman dan tak terbaca
        // sebagai kontrol sama sekali. Ini persis penyakit yang sudah pernah
        // kena pada rangka muat (lihat catatan --skeleton di globals.css):
        // apa pun yang mengandalkan --muted untuk menonjol di atas --background
        // akan tak terlihat di mode terang. Di gelap keduanya memang berbeda
        // (#1a2237 vs #0b1120), jadi bug ini hanya tampak di terang — dan itu
        // sebabnya lolos sekian lama.
        default: "bg-card border border-border shadow-[var(--shadow-card)]",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        // Tab aktif = chip --primary-soft BERBINGKAI --primary-dark.
        //
        // Sebelumnya `bg-background`: di terang itu #f0f4f8 di atas bilah
        // #f1f5f9 — 1,01:1, jadi satu-satunya penanda "ini yang aktif" tinggal
        // bayangan tipis. Chip saja belum cukup (1,11:1 vs wadah putih, masih
        // di bawah ambang komponen UI 3:1); yang membawa kontrasnya adalah
        // BINGKAI: --primary-dark #0a8a9e = 4,08:1 vs putih (--primary #0ca6bd
        // cuma 2,91:1 — nyaris, tapi belum lulus).
        //
        // Teksnya TETAP text-foreground, bukan warna brand: #0ca6bd di atas
        // chip #e0f7fb hanya 2,62:1, jauh di bawah ambang teks 4,5:1.
        "data-active:border-primary-dark data-active:bg-primary-soft data-active:text-foreground dark:data-active:border-primary dark:data-active:bg-primary-soft dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
