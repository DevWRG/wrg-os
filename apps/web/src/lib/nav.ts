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
  Target, MapPinned, Contact, UserRound, Award, UserCheck, Crown, BookOpen, Calculator,
  Archive,
  type LucideIcon,
} from "lucide-react";

import { can, canOrLegacy, hasPerms } from "@/lib/perms";
import { canEditPricelistSetup, canViewPricelist, type AccessUser } from "@/lib/pricelist-access";
import { canViewPricebook, canViewPricebookSummary } from "@/lib/pricebook-access";
import { canViewKlasifikasi } from "@/lib/klasifikasi-access";
import { canViewRaportList } from "@/lib/raport-access";
import { canViewExecutive } from "@/lib/executive-access";
import { canViewKso } from "@/lib/kso-access";

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
  // Fitur RBAC LAIN yang dilayani menu ini — dipakai saat beberapa menu dilebur
  // jadi tab di satu route (mis. Pricelist + Pricelist Setup masuk Price Book).
  // Dua efeknya, dua-duanya wajib:
  //   1. navVisible: menu tampil kalau SALAH SATU fitur diizinkan. Tanpa ini, AM
  //      yang cuma diizinkan 'pricelist' ikut terbentur gate 'pricebook'.
  //   2. featureCatalog: key-nya tetap disemai ke katalog. Tanpa ini "Sync Fitur"
  //      menonaktifkan fitur yang menunya sudah lebur (dianggap zombie) → izin
  //      grup hilang tanpa satu pun pesan.
  features?: { key: string; name: string }[];
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
      // Simulator KSO — running cost alat lab per test, hasil penggabungan
      // aplikasi terpisah `runningcost-zybio` jadi satu menu di sini. Beda dari
      // Price Book: itu harga JUAL barang, ini biaya operasional alat yang
      // dipakai sales menyusun skema KSO/CPRR di depan faskes. Master datanya
      // migrasi 074, rumusnya apps/web/src/lib/kso/formula.ts.
      { title: "Simulator KSO", url: "/kso-simulator", icon: Calculator, badge: "NEW", show: canViewKso },
      // Harga jual dibagi per PEMBACA, bukan per tabel:
      //   /pricebook            sales & AM — katalog + harga terpublikasi (071/043)
      //   /pricebook/ringkasan  Direktur + HoD — bacaan portofolio
      //   /pricebook/setup      HoD Business + Purchasing — HPP & margin (043/073)
      // Menu terpisah (bukan tab) supaya tiap muka punya baris izinnya sendiri di
      // matriks Akses Grup — sebuah tab tidak bisa dicentang sendiri.
      // Tabelnya tetap TIDAK digabung: HPP/margin wajib pisah dari tabel yang
      // dibaca sales — lihat komentar migrasi 073.
      {
        title: "Price Book & Pricelist", url: "/pricebook", icon: BookOpen, badge: "NEW", exact: true,
        show: (me) => canViewPricebook(me) || canViewPricelist(me),
        // Bekas menu "Pricelist" jadi tab di sini; key-nya harus tetap hidup, kalau
        // tidak Sync Fitur mematikannya sebagai zombie dan AM kehilangan akses.
        features: [{ key: "pricelist", name: "Pricelist (tab di Price Book)" }],
      },
      {
        title: "Ringkasan Price Book", url: "/pricebook/ringkasan", icon: BarChart3, badge: "NEW",
        show: canViewPricebookSummary,
      },
      {
        // feature override: pertahankan key lama 'pricelist-setup' walau route-nya
        // pindah, supaya izin grup yang sudah dicentang tidak perlu di-grant ulang.
        title: "Setup Harga", url: "/pricebook/setup", icon: SlidersHorizontal,
        feature: "pricelist-setup", show: canEditPricelistSetup,
      },
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
    // Domain GA (General Affairs) per arahan Direktur soal domain grouping
    // sidebar (sama pola Aftersales/Shipping/Purchasing). F132 Aset Master —
    // single source of truth aset kantor, fondasi F133 (assignment/transfer)
    // & F137 (maintenance) yang menyusul di atas branch ini.
    label: "GA",
    items: [
      { title: "Aset GA", url: "/ga-aset", icon: Archive, badge: "NEW" },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Products", url: "/products", icon: Package },
      // Master klasifikasi 4 level + penerbit kode produk KK.PP.CC.SSS.NNNN
      // (migrasi 072). Beda dari Products: Products itu mirror item Accurate,
      // menu ini yang MENENTUKAN kode produknya sebelum masuk Accurate.
      { title: "Klasifikasi Produk", url: "/klasifikasi-produk", icon: Tags, badge: "NEW", show: canViewKlasifikasi },
      { title: "Inventory", url: "/inventory", icon: Boxes },
      { title: "Orders", url: "/orders", icon: ShoppingCart },
      { title: "Shipments", url: "/shipments", icon: Truck },
      { title: "Suppliers", url: "/suppliers", icon: Factory },
      { title: "HITL Review", url: "/hitl", icon: ClipboardCheck },
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
//   5. Menu hasil peleburan (`features`) tampil kalau SALAH SATU fitur yang
//      dilayaninya diizinkan — kalau tidak, orang yang cuma diizinkan fitur lama
//      (mis. AM dengan 'pricelist') terbentur gate fitur induknya.
export function navVisible(me: AccessUser | null, it: NavItem): boolean {
  const key = it.feature ?? featureKey(it.url);
  if (!hasPerms(me)) return it.show ? it.show(me) : true;
  if (canOrLegacy(me, key, it.show ? it.show(me) : false)) return true;
  return (it.features ?? []).some((f) => can(me, f.key));
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
      // Fitur yang menunya sudah lebur jadi tab tetap ikut disemai — kalau tidak,
      // Sync Fitur menganggapnya zombie dan mematikannya (izin grup hilang senyap).
      for (const f of it.features ?? []) {
        rows.push({ key: f.key, name: f.name, section: g.label, path: it.url, sort });
        sort += 10;
      }
    }
  }
  return rows;
}
