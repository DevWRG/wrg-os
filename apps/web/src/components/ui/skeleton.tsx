import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // Warna + animasinya dipegang `skeleton-sheen` (globals.css) yang memakai
      // token --skeleton, BUKAN bg-muted: di tema terang --muted (#f1f5f9)
      // hampir sama dengan --background (#f0f4f8), jadi rangkanya tak terlihat
      // dan layar muat terbaca blank.
      className={cn("skeleton-sheen rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
