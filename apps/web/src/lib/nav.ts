// Katalog menu = SATU sumber kebenaran untuk: (a) render sidebar, (b) katalog
// fitur RBAC (tombol "Sync Fitur" → upsert ke tabel `feature`). Tambah item di
// sini → muncul di sidebar DAN bisa langsung di-sync jadi fitur yg bisa di-gate.
// feature.key = slug route (lihat featureKey()), selaras infra/postgres/init/044_rbac.sql.

import {
  LayoutDashboard, LayoutGrid, Building2, Package, Boxes, ShoppingCart, Truck,
  Factory, Workflow, Receipt, BarChart3, ClipboardCheck, History, Settings,
  Sparkles, Send, FileText, ScrollText, GraduationCap, UsersRound, Network,
  Bell, MapPin, ListChecks, Swords, CalendarOff, CalendarDays, CalendarRange,
  Users, KeyRound, ShieldCheck, MessagesSquare, Gauge, Tags, SlidersHorizontal, Microscope,
  Target, MapPinned, Contact, UserRound, Award, UserCheck, Crown, BookOpen, Calculator,
  Wallet, Coins, Route, Radio, Printer, ScanText,
  Wrench,
  CalendarClock,
  Ticket,
  PackageCheck,
  PenLine,
  PackagePlus, PackageMinus,
  CalendarCheck,
  Hourglass,
  FileCheck2,
  Car,
  ArrowLeftRight,
  Archive,
  Handshake,
  ClipboardList,
  HardHat,
  TrendingUpDown,
  type LucideIcon,
} from "lucide-react";

import { can, canOrLegacy, hasPerms } from "@/lib/perms";
import { canEditPricelistSetup, canViewPricelist, type AccessUser } from "@/lib/pricelist-access";
import { canViewPricebook, canViewPricebookSummary } from "@/lib/pricebook-access";
import { canViewKlasifikasi } from "@/lib/klasifikasi-access";
import { canViewRaportList } from "@/lib/raport-access";
import { canViewExecutive } from "@/lib/executive-access";
import { canViewKso } from "@/lib/kso-access";
import { canViewNpkAm, canViewNpkAmSelf } from "@/lib/npk-access";
import { canViewInsentifTim } from "@/lib/insentif-access";
import { canViewDanaOps } from "@/lib/dana-ops-access";
import { canViewInventoryRelocation } from "@/lib/inventory-relocation-access";
import { canViewVendorManagement } from "@/lib/vendor-management-access";
import { canViewGaReporting } from "@/lib/ga-reporting-access";
import { canViewPurchaseForecast } from "@/lib/purchase-forecast-access";

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
      // F67 Insentif. Menu terpisah dari /insentif/tim karena PERTANYAANNYA beda:
      // ini "berapa insentif saya", itu batch payroll — bukan sekadar barisnya
      // lebih sedikit. Self-only untuk SEMUA peran, termasuk Direktur, jadi tak
      // perlu gate identitas di sini; yang menjaga barisnya adalah scope server
      // (PRD §E).
      { title: "Insentif Saya", url: "/insentif", icon: Wallet, badge: "NEW", exact: true },
      // Menu tim: SATU route untuk HoD + Finance + Direktur, dibedakan scope SERVER
      // (resolveAkses), bukan route terpisah — rancangan /insentif/hod +
      // /insentif/finance dibatalkan karena dua route = dua jalur query, dan yang
      // versi "semua" itu yang berbahaya. AM murni tak boleh melihat menu ini sama
      // sekali (§E.2.8: yang dibandingkan di sini angka penghasilan orang).
      //
      // Beda dari "Insentif Saya" di atas: item ini PUNYA `show`, supaya sebelum
      // grup dicentang di Akses Grup fallback-nya masih masuk akal (HoD/Direktur)
      // dan bukan tertutup untuk semua orang.
      { title: "Insentif Tim", url: "/insentif/tim", icon: Coins, badge: "NEW", show: canViewInsentifTim },
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
      // Produktivitas KSO — sisi lain dari Simulator: bukan menghitung skema di
      // depan faskes, tapi membaca hasilnya. Realisasi tes (spreadsheet master
      // aset) disandingkan dengan revenue Accurate untuk menghasilkan Rp/tes per
      // faskes. Data & aturan atribusinya di view kso_asset_produktivitas_v
      // (migrasi 097-105), bukan di TypeScript.
      //
      // Gate sama dengan Simulator atas keputusan user 2026-08-18 — perlu diingat
      // halaman ini memuat REVENUE PER FASKES, bukan sekadar harga alat.
      //
      // feature: "kso-simulator" — SENGAJA menumpang kunci izin Simulator, bukan
      // memakai slug rutenya sendiri. Tanpa override ini navVisible memakai
      // featureKey(url) = "kso-produktivitas"; begitu Sync Fitur menyemai baris
      // izin untuk kunci itu (deny bagi semua grup), menu hilang dari sidebar dan
      // layout dashboard menutup rutenya — padahal halaman & BFF meng-gate dengan
      // canViewKso yang terikat 'kso-simulator'. Hasilnya satu fitur butuh DUA
      // centang, dan yang kedua tidak pernah diminta.
      //
      // Kalau kelak akses ini dipisah dari Simulator (halaman ini memuat revenue
      // per faskes, Simulator tidak), hapus override ini DAN ganti gate di
      // apps/web/src/lib/kso-access.ts serta BFF — tiga tempat harus ikut, kalau
      // tidak menu dan halaman kembali menilai dengan kunci berbeda.
      //
      // SATU menu, dua TAB (Tabel per faskes | Ringkasan) — keputusan user 2026-08-18.
      // Ringkasan sempat berdiri sebagai menu sendiri (#911/#913) lalu digabung.
      // Aman dijadikan tab justru karena keduanya memakai kunci izin yang SAMA:
      // keberatan biasa terhadap tab — "tidak bisa dicentang sendiri di matriks Akses
      // Grup", seperti pada /pricebook — tidak berlaku di sini, tidak ada izin yang
      // hilang karena tidak pernah ada dua izin. Rute lamanya dipertahankan sebagai
      // redirect ke ?tab=ringkasan (lihat berkas page.tsx-nya).
      { title: "Produktivitas KSO", url: "/kso-produktivitas", icon: Microscope, badge: "NEW",
        feature: "kso-simulator", show: canViewKso },
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
      // NPK level AM (078): matrix semua AM untuk Direktur+HoD, self-view untuk staff AM.
      { title: "NPK AM", url: "/npk/am", icon: Award, badge: "NEW", exact: true, show: canViewNpkAm },
      { title: "NPK Saya (AM)", url: "/npk/am-self", icon: UserCheck, badge: "NEW", show: canViewNpkAmSelf },
      { title: "Karyawan 360", url: "/karyawan", icon: UsersRound, badge: "NEW", show: canViewRaportList },
      { title: "RACI Matrix", url: "/people/raci", icon: Workflow, badge: "NEW" },
      { title: "Org Chart", url: "/people/org", icon: Building2, badge: "NEW" },
      { title: "Voice of Employee", url: "/people/voice", icon: MessagesSquare, badge: "NEW" },
      { title: "Spider Network", url: "/network", icon: Network },
      { title: "Executive Briefings", url: "/briefings", icon: ScrollText },
      { title: "Coaching Notes", url: "/coaching", icon: GraduationCap },
      { title: "Reports", url: "/reports", icon: BarChart3 },
      // Revenue per lini produk — dasar metric `revstream` (kartu Fafa, WatchPoint).
      { title: "Revenue per Lini", url: "/revenue-stream", icon: Coins, badge: "NEW" },
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
    label: "Aftersales",
    items: [
      // F23 — klaim internal saat alat + cartridge menunjukkan error pembacaan
      // RFID. Role min Karyawan (kerja teknisi lapangan sehari-hari, bukan data
      // finansial sensitif), tanpa `show` gate (default tampil ke semua login).
      { title: "RFID/Cartridge Error Claim", url: "/rfid-cartridge-claims", icon: Radio, badge: "NEW" },
      { title: "Instalasi Alat", url: "/installations", icon: Wrench, badge: "NEW" },
      { title: "Service Tickets", url: "/service-tickets", icon: Ticket, badge: "NEW" },
      { title: "PM & Kalibrasi", url: "/maintenance", icon: CalendarClock, badge: "NEW" },
      // F25 Uji Profisiensi Document Registry — sertifikat per RS, tracking
      // ED (annual renewal). Role min Karyawan, tanpa `show` (semua role login
      // boleh), pola sama dgn F39/F134.
      { title: "Uji Profisiensi", url: "/proficiency-tests", icon: FileCheck2, badge: "NEW" },
      { title: "Readiness Board", url: "/readiness-board", icon: HardHat, badge: "NEW" },
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
      { title: "Kendaraan Operasional", url: "/vehicles", icon: Car, badge: "NEW" },
    ],
  },
  {
    // Domain Shipping (F43/F44) — standalone, tidak tergantung shipment_tracking/
    // pickup_plan (branch F12/F42/F45/F93 belum merge ke dev). Role min
    // Karyawan: semua tim boleh mencatat & lihat performa pengiriman /
    // mendefinisikan standar cetak dokumen.
    label: "Shipping",
    items: [
      { title: "Kurir/Ekspedisi Performance", url: "/courier-performance", icon: Route, badge: "NEW" },
      { title: "Spesifikasi Cetak Dokumen", url: "/print-spec", icon: Printer, badge: "NEW" },
      { title: "Tracking Pengiriman", url: "/shipment-tracking", icon: Route, badge: "NEW" },
      // F45 — rencana trip kurir + cek H-1 (libur & PIC). Beda dari Shipments
      // (mirror delivery-order Accurate, sudah terjadi): ini jadwal KE DEPAN.
      { title: "Jadwal Kirim-Tagih", url: "/pickup-plan", icon: CalendarCheck, badge: "NEW" },
    ],
  },
  {
    // Domain PURCHASING per board Roadmap — dipisah dari "Operations" (keranjang
    // mirror Accurate) atas arahan Direktur, supaya sidebar cermin domain fitur.
    label: "Purchasing",
    items: [
      // F37 — route berdiri sendiri, dipisah dari /inventory (yang dulu 1
      // halaman 2 tab). Key RBAC-nya sendiri (`stok-gudang`, auto dari URL),
      // jadi bisa digrant terpisah dari izin Inventory di Akses Grup.
      { title: "Stok Gudang", url: "/stok-gudang", icon: Boxes, badge: "NEW" },
      { title: "Supplier ETA", url: "/supplier-eta", icon: CalendarClock, badge: "NEW" },
      { title: "Inbound Receiving", url: "/inbound-receiving", icon: PackageCheck, badge: "NEW" },
      // F38 — sama perlakuan spt Stok Gudang: dulu tab ketiga di /inventory,
      // sekarang route sendiri dgn key RBAC sendiri (`ed-watch`).
      { title: "ED & Kedaluwarsa", url: "/ed-watch", icon: Hourglass, badge: "NEW" },
      // F40 Inventory Relocation Request — log permintaan pemindahan barang
      // antar cabang. Role min HOD (beda dari F25/F39/F134 yg Karyawan) —
      // `show` di sini cuma fallback identitas (gate nyata di BFF lewat
      // requireHodOrAdmin(), lihat app/api/inventory-relocations/**), pola
      // sama dgn F51 Dana Ops/Karyawan 360.
      { title: "Relokasi Inventaris", url: "/inventory-relocations", icon: ArrowLeftRight, badge: "NEW", show: canViewInventoryRelocation },
      // F13 PO Tracker + Sistem Barang Masuk — satu PO ke vendor + riwayat
      // penerimaan barang per item (migrasi 078), bukan Accurate mirror.
      { title: "PO Tracker", url: "/purchase-orders", icon: ClipboardList, badge: "NEW" },
      // F41 Forecast vs Actual PO Gap Report — role min Management di board
      // (MAGANG-FEATURES.md), gate Direktur/HoD/admin (bukan executive-access.ts,
      // ini laporan Purchasing biasa — lihat purchase-forecast-access.ts).
      { title: "Forecast vs Actual PO", url: "/purchase-forecast", icon: TrendingUpDown, badge: "NEW", show: canViewPurchaseForecast },
    ],
  },
  {
    // DOC #KLAIM (FR-DOC-01) — domain board literally "DOC", tak cocok masuk
    // grup existing manapun, grup sendiri (pola sama F139 bikin grup "GA").
    label: "DOC",
    items: [
      { title: "Klaim OCR", url: "/doc-klaim", icon: ScanText, badge: "NEW" },
    ],
  },
  {
    label: "General Affairs",
    items: [
      { title: "Dana Ops", url: "/dana-ops", icon: Wallet, badge: "NEW", show: canViewDanaOps },
      { title: "ATK Master", url: "/atk-master", icon: PenLine, badge: "NEW" },
      // F49 sengaja 2 menu/feature-key terpisah (bukan 1 halaman gabungan):
      // Stock In = tim GA (pencatatan pembelian/penerimaan), Stock Out = tim
      // mana pun (self-service pengambilan barang). Belum di-gate identitas
      // ("show") krn sistem ini belum punya konsep departemen/tim di data
      // user — Direktur atur siapa boleh apa lewat Akses Grup (feature key
      // "atk-stock-in" vs "atk-stock-out", auto dari url).
      { title: "ATK Stock In", url: "/atk-stock-in", icon: PackagePlus, badge: "NEW" },
      { title: "ATK Stock Out", url: "/atk-stock-out", icon: PackageMinus, badge: "NEW" },
      // F136: hitung fisik vs stok sistem. Penyesuaian selisih dibuat lewat
      // FORM YANG SAMA dgn Stock In/Out (AddAtkStockMovementSheet), bukan form
      // baru — menu ini cuma beda submenu/konteks.
      { title: "ATK Stock Opname", url: "/atk-stock-opname", icon: ListChecks, badge: "NEW" },
      // F140 Vendor Management + Contract Expiry Alerts — master vendor/partner
      // lokal + riwayat kontrak, status masa berlaku computed di query (tanpa
      // WA/cron — dikonfirmasi user). Role min HOD (data komersial vendor),
      // `show` di sini fallback identitas, gate nyata di BFF requireHodOrAdmin().
      { title: "Vendor Management", url: "/vendor-management", icon: Handshake, badge: "NEW", show: canViewVendorManagement },
      // F141 — konsolidasi laporan 6 modul GA (F49 ATK+F54 Materai, F50
      // Kendaraan, F51 Dana Ops, F52 IT Asset, F53 Stiker Aset). Role min HOD
      // (disamakan dgn gate paling ketat di antara modul sumber, F51 Dana Ops)
      // krn agregasi menaikkan sensitivitas data yg sebagian sumbernya terbuka.
      { title: "GA Reporting & Analytics", url: "/ga-reporting", icon: BarChart3, badge: "NEW", show: canViewGaReporting },
    ],
  },
  {
    // Domain GA (General Affairs) per arahan Direktur soal domain grouping
    // sidebar (sama pola Aftersales/Shipping/Purchasing). F132 Aset Master —
    // single source of truth aset kantor, fondasi F133 (assignment/transfer)
    // & F137 (maintenance) yang menyusul di atas branch ini.
    label: "GA",
    items: [
      // 1 menu, 3 tab (Aset/Kategori/Tiket IT) — arahan Direktur eksplisit
      // F52 gabung ke F132 juga di level MENU, bukan cuma tabel. Tab Tiket
      // IT dilayani /ga-assets & /it-tickets sekaligus (lihat `features`).
      {
        title: "Aset GA", url: "/ga-aset", icon: Archive, badge: "NEW",
        features: [{ key: "it-asset", name: "Tiket IT (tab di Aset GA)" }],
      },
      { title: "Helpdesk GA", url: "/ga-helpdesk", icon: Ticket, badge: "NEW" },
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
  // Satu kunci cukup SEKALI. Dua item menu boleh menumpang kunci izin yang sama
  // lewat override `feature` (mis. Produktivitas KSO menumpang 'kso-simulator'),
  // dan tanpa dedup ini keduanya terkirim ke /admin/access/features/sync. Di sana
  // upsert-nya berurutan dengan DO UPDATE SET name/path, jadi item yang BELAKANGAN
  // menimpa nama & path milik yang duluan — baris "Simulator KSO" di matriks Akses
  // Grup berganti nama jadi "Produktivitas KSO" tanpa ada yang meminta.
  // Kemunculan PERTAMA yang dipertahankan: itu item pemilik kunci aslinya.
  const seen = new Set<string>();
  const push = (r: FeatureCatalogRow) => { if (!seen.has(r.key)) { seen.add(r.key); rows.push(r); } };
  let sort = 10;
  for (const g of NAV) {
    for (const it of g.items) {
      push({ key: it.feature ?? featureKey(it.url), name: it.title, section: g.label, path: it.url, sort });
      sort += 10;
      // Fitur yang menunya sudah lebur jadi tab tetap ikut disemai — kalau tidak,
      // Sync Fitur menganggapnya zombie dan mematikannya (izin grup hilang senyap).
      for (const f of it.features ?? []) {
        push({ key: f.key, name: f.name, section: g.label, path: it.url, sort });
        sort += 10;
      }
    }
  }
  return rows;
}
