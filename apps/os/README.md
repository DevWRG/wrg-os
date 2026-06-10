# WRG OS

Internal operations dashboard untuk **Wahana Lifeline** — perusahaan distribusi alat kesehatan B2B.

Port dari template [Adminator](https://github.com/puikinsh/Adminator-admin-dashboard) ke stack modern.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (base-nova preset, zinc theme) + **Base UI** primitives
- **lucide-react** icons
- **pnpm** package manager

## Modules

| Section | Pages |
|---|---|
| Operations | Dashboard, Customers, Products, Inventory, Orders, Shipments, Suppliers |
| Analytics | Reports, Settings |

Semua data masih mock — backend integration menyusul.

## Getting Started

```bash
pnpm install
pnpm dev
```

Buka http://localhost:3000 — auto-redirect ke `/dashboard`.

## Scripts

```bash
pnpm dev     # Next dev server (Turbopack)
pnpm build   # Production build
pnpm start   # Run production build
pnpm lint    # ESLint
```

## Project Structure

```
src/
  app/
    (dashboard)/           # Route group with sidebar+topbar layout
      dashboard/page.tsx
      customers/page.tsx
      products/page.tsx
      inventory/page.tsx
      orders/page.tsx
      shipments/page.tsx
      suppliers/page.tsx
      reports/page.tsx
      settings/page.tsx
      layout.tsx
    layout.tsx             # Root layout (fonts, TooltipProvider)
    page.tsx               # Redirects to /dashboard
    globals.css            # Tailwind + shadcn theme tokens
  components/
    layout/                # AppSidebar, Topbar, UserMenu
    dashboard/             # StatCard, PageHeader
    ui/                    # shadcn primitives
  lib/
    utils.ts               # cn() helper
  hooks/
    use-mobile.ts
```
