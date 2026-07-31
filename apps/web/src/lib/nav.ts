// Katalog menu = SATU sumber kebenaran untuk: (a) render sidebar, (b) katalog
// fitur RBAC (tombol "Sync Fitur" → upsert ke tabel `feature`). Tambah item di
// sini → muncul di sidebar DAN bisa langsung di-sync jadi fitur yg bisa di-gate.
// feature.key = slug route (lihat featureKey()), selaras infra/postgres/init/044_rbac.sql.

import {
  LayoutDashboard, LayoutGrid, Building2, Package, Boxes, ShoppingCart, Truck,
  Factory, Workflow, Receipt, BarChart3, ClipboardCheck, History, Settings,
  Sparkles, Send, FileText, ScrollText, GraduationCap, UsersRound, Network,
  Bell, MapPin, ListChecks, Swords, CalendarOff, CalendarDays, CalendarRange,
  Users, KeyRound, ShieldCheck, MessagesSquare, Gauge, Tags, SlidersHorizontal,
  Target, MapPinned, Contact, UserRound, Award, UserCheck, Crown, PenLine, PackagePlus, PackageMinus, type LucideIcon,
} from "lucide-react";

import { canOrLegacy, hasPerms } from "@/lib/perms";
import { canEditPricelistSetup, canViewPricelist, type AccessUser } from "@/lib/pricelist-access";
import { canViewRaportList } from "@/lib/raport-access";
import { canViewExecutive } from "@/lib/executive-access";

// exact: sorot aktif hanya saat path persis (untuk route induk yg punya child,
// mis. /pricelist vs /pricelist/setup).
// show: gate identitas (title/role/hod_key) sebagai FALLBACK — dipakai selama
// fitur ini belum diatur di matriks Akses Grup. Begitu diatur, matriks yang
// menang (lihat navVisible di bawah + canOrLegacy di lib/perms).
export interface NavItem {
  title: string; url: string; icon: LucideIcon; badge?: string; exact?: boolean;
  show?: (me: AccessUser | null) => boolean;
  // Override key fitur RBAC bila slug route ≠ key `feature` di DB. Contoh: route
  // "/plan-report" tetap pakai feature.key "dashboard" (hindari migrasi & re-grant
  // saat rename route). Default: featureKey(url).
  feature?: string;
}
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Executive", url: "/executive", icon: Crown, badge: "NEW", show: canViewExecutive },
      { title: "Sales Overview", url: "/overview", icon: LayoutGrid, badge: "NEW" },
      { title: "WatchPoint HoD", url: "/watchpoint", icon: Gauge, badge: "NEW" },
    ],
  },
  {
    label: "HR",
    items: [
      { title: "Plan & Report", url: "/plan-report", icon: LayoutDashboard, feature: "dashboard" },
      { title: "Sales TODO", url: "/todos", icon: ListChecks },
      { title: "Visits", url: "/visits", icon: MapPin },
      { title: "Reminders", url: "/reminders", icon: Bell },
      { title: "Holidays", url: "/holidays", icon: CalendarOff },
      { title: "Manage Leave", url: "/leave", icon: CalendarDays },
      { title: "Raport Saya", url: "/raport", icon: Award, exact: true, badge: "NEW" },
    ],
  },
  {
    label: "Sales",
    items: [
      { title: "Sales Calendar", url: "/calendar", icon: CalendarRange },
      { title: "Sales Analytics", url: "/sales-analytics", icon: Target, badge: "NEW" },
      { title: "Sales Alerts", url: "/sales-alerts", icon: Bell, badge: "NEW" },
      { title: "Competitor Intel", url: "/competitor", icon: Swords },
      { title: "Pipeline", url: "/pipeline", icon: Workflow },
      { title: "Kinerja Saya", url: "/me", icon: UserRound, badge: "NEW" },
      { title: "Customers", url: "/customers", icon: Building2 },
      { title: "Accounts", url: "/accounts", icon: Contact, badge: "NEW" },
      { title: "AR Aging", url: "/ar", icon: Receipt },
      { title: "Sales Docs", url: "/sales-docs", icon: FileText },
      { title: "Collection Drafts", url: "/collection-drafts", icon: Send },
      { title: "Pricelist Setup", url: "/pricelist/setup", icon: SlidersHorizontal, show: canEditPricelistSetup },
      { title: "Pricelist", url: "/pricelist", icon: Tags, exact: true, show: canViewPricelist },
    ],
  },
  {
    label: "Analytics",
    items: [
      // NPK (F66) — gate identitas: Direktur = admin/superuser; self-view = HoD (hod_key).
      { title: "NPK Direktur", url: "/npk", icon: Award, badge: "NEW", exact: true, show: (me) => me?.role === "admin" || me?.superuser === true },
      { title: "NPK Saya", url: "/npk/self", icon: UserCheck, badge: "NEW", show: (me) => !!me?.hod_key },
      { title: "Karyawan 360", url: "/karyawan", icon: UsersRound, badge: "NEW", show: canViewRaportList },
      { title: "RACI Matrix", url: "/people/raci", icon: Workflow, badge: "NEW" },
      { title: "Org Chart", url: "/people/org", icon: Building2, badge: "NEW" },
      { title: "Voice of Employee", url: "/people/voice", icon: MessagesSquare, badge: "NEW" },
      { title: "Spider Network", url: "/network", icon: Network },
      { title: "Executive Briefings", url: "/briefings", icon: ScrollText },
      { title: "Coaching Notes", url: "/coaching", icon: GraduationCap },
      { title: "Reports", url: "/reports", icon: BarChart3 },
      { title: "Digest History", url: "/digests", icon: History },
    ],
  },
  {
    label: "Monitor",
    items: [
      { title: "Rekap", url: "/monitor/rekap", icon: MessagesSquare },
      { title: "Resume", url: "/monitor/resume", icon: ScrollText },
      { title: "Pola Komunikasi", url: "/monitor/pola", icon: Network },
      { title: "Members", url: "/monitor/members", icon: Users },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Products", url: "/products", icon: Package },
      { title: "Inventory", url: "/inventory", icon: Boxes },
      { title: "Orders", url: "/orders", icon: ShoppingCart },
      { title: "Shipments", url: "/shipments", icon: Truck },
      { title: "Suppliers", url: "/suppliers", icon: Factory },
      { title: "HITL Review", url: "/hitl", icon: ClipboardCheck },
    ],
  },
  {
    label: "General Affairs",
    items: [
      { title: "ATK Master", url: "/atk-master", icon: PenLine, badge: "NEW" },
      // F49 sengaja 2 menu/feature-key terpisah (bukan 1 halaman gabungan):
      // Stock In = tim GA (pencatatan pembelian/penerimaan), Stock Out = tim
      // mana pun (self-service pengambilan barang). Belum di-gate identitas
      // ("show") krn sistem ini belum punya konsep departemen/tim di data
      // user — Direktur atur siapa boleh apa lewat Akses Grup (feature key
      // "atk-stock-in" vs "atk-stock-out", auto dari url).
      { title: "ATK Stock In", url: "/atk-stock-in", icon: PackagePlus, badge: "NEW" },
      { title: "ATK Stock Out", url: "/atk-stock-out", icon: PackageMinus, badge: "NEW" },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Sales Targets", url: "/sales/targets", icon: Target },
      { title: "AM → Cabang", url: "/am-cabang", icon: MapPinned },
      { title: "Users", url: "/users", icon: Users },
      { title: "User Access", url: "/user-access", icon: KeyRound },
      { title: "Akses Grup", url: "/access-groups", icon: ShieldCheck },
      // F121 HoD Resolver: utilitas data-quality (preview atasan_raw → HoD kanonik),
      // bukan analytics harian → grup Admin, gate admin/superuser.
      { title: "HoD Resolver", url: "/people/hod-resolve", icon: KeyRound, show: (me) => me?.role === "admin" || me?.superuser === true },
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "UI Showcase", url: "/showcase", icon: Sparkles },
    ],
  },
];

// Fitur (RBAC) per item = slug route: /monitor/rekap → "monitor-rekap" (= feature.key).
export const featureKey = (url: string) => url.replace(/^\//, "").replace(/\//g, "-");

// Apakah item menu tampil untuk user ini. Urutan:
//   1. Izin RBAC belum tersedia (auth mati / belum login) → pakai `show`, atau tampil.
//   2. admin/superuser → semua tampil (anti-lockout, lewat can()/canOrLegacy).
//   3. Fitur sudah punya baris izin di grup user → matriks Akses Grup yang menentukan.
//   4. Belum diatur → `show` (gate identitas lama); tanpa `show` → tidak tampil.
// Poin 3 yang bikin centang admin di Akses Grup benar-benar berlaku ke sidebar,
// termasuk untuk item ber-`show` (Pricelist, Executive, Karyawan 360, NPK).
export function navVisible(me: AccessUser | null, it: NavItem): boolean {
  const key = it.feature ?? featureKey(it.url);
  if (!hasPerms(me)) return it.show ? it.show(me) : true;
  return canOrLegacy(me, key, it.show ? it.show(me) : false);
}

// Halaman "rumah" untuk user ini. Default tetap Sales Overview; kalau user tak
// berizin ke situ → item menu pertama yang boleh dia lihat. Dipakai root "/"
// (tujuan setelah login & link logo/breadcrumb): tanpa ini user tanpa izin
// /overview mendarat di halaman "Akses ditolak" tepat setelah login.
const HOME_DEFAULT = "/overview";

export function homePath(me: AccessUser | null): string {
  const items = NAV.flatMap((g) => g.items);
  const fallback = items.find((it) => it.url === HOME_DEFAULT);
  if (fallback && navVisible(me, fallback)) return HOME_DEFAULT;
  return items.find((it) => navVisible(me, it))?.url ?? HOME_DEFAULT;
}

// Item menu yang "memiliki" sebuah pathname — dipakai layout dashboard untuk
// menegakkan izin di level rute (menu tersembunyi = halaman tertutup, termasuk
// bila URL-nya diketik langsung). Cocokkan yang PALING panjang: /pricelist/setup
// harus kena item Pricelist Setup, bukan Pricelist. Rute anak ikut induknya
// (/visits/123 → Visits). Pathname di luar katalog menu → null (tak di-gate).
export function findNavItem(pathname: string): NavItem | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best: NavItem | null = null;
  for (const g of NAV) {
    for (const it of g.items) {
      if (path !== it.url && !path.startsWith(`${it.url}/`)) continue;
      if (!best || it.url.length > best.url.length) best = it;
    }
  }
  return best;
}

export interface FeatureCatalogRow { key: string; name: string; section: string; path: string; sort: number }

// Katalog fitur datar utk Sync (dikirim ke /admin/access/features/sync).
export function featureCatalog(): FeatureCatalogRow[] {
  const rows: FeatureCatalogRow[] = [];
  let sort = 10;
  for (const g of NAV) {
    for (const it of g.items) {
      rows.push({ key: it.feature ?? featureKey(it.url), name: it.title, section: g.label, path: it.url, sort });
      sort += 10;
    }
  }
  return rows;
}
