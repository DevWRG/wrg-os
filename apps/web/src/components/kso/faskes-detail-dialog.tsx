"use client";

// Dialog detail satu faskes — dibuka dengan mengklik baris tabel atau tombol
// "Lihat detail". Isinya: ringkasan angka, riwayat bulanan (tes & revenue), dan
// daftar alat beserta capaian targetnya.
//
// Dialog, BUKAN Sheet samping: mengikuti pola detail yang sudah dipakai Orders,
// Shipments, Suppliers, dan Customers (lihat CLAUDE.md).
//
// Data diambil SAAT DIBUKA, bukan ikut payload halaman. Riwayat bulanan seluruh faskes
// berarti ±189 faskes x 20 bulan x 2 skema di tiap muat halaman padahal yang dibuka
// paling banyak beberapa.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";

import { cn } from "@/lib/utils";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  PENANDA, Pilih, Tag, angkaSumbu, awalTahunIni, bulanIni, deretBulan, labelBulan, num, rp,
  rupiahPerAlat, skalaRp, skemaPakaiRpTes, type FaskesRow,
} from "./produktivitas-shared";

interface Detail {
  alat: {
    assetId: number; snKey: string; snRaw: string | null;
    typeAlat: string | null; namaAlat: string | null;
    targetJumlahTes: number | null; totalTes: number | null;
    rataTesBulanan: number | null; capaianTarget: number | null;
  }[];
  tren: { periode: string; jumlahTes: number | null; alatLapor: number | null; revenueNetto: number | null }[];
  trenAlat: { assetId: number; periode: string; jumlahTes: number | null }[];
  reagen: {
    itemId: number | null; itemNo: string | null; itemNama: string | null;
    jenisAlat: string | null; kategori: string; unit: string;
    qty: number | null; nilaiNetto: number | null; jumlahFaktur: number | null;
    dalamSkema: boolean;
    penagihanTes: boolean;
  }[];
}

const cfg = {
  tes: { label: "Realisasi", color: "var(--chart-2)" },
  // Target digambar dengan warna NETRAL dan garis putus-putus, bukan warna seri kedua:
  // ia patokan, bukan pengukuran yang setara. Bentuknya (putus-putus, datar) yang
  // membedakan, sehingga tetap terbaca oleh mata yang sulit membedakan warna.
  target: { label: "Target", color: "var(--muted-foreground)" },
  revenue: { label: "Revenue netto", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function FaskesDetailDialog({ g, median, onClose }: {
  g: FaskesRow | null; median: number | null; onClose: () => void;
}) {
  // Hasil disimpan BERSAMA kuncinya, bukan di-reset saat pilihan berganti. Me-reset
  // lewat setState sinkron di dalam effect memicu render berantai (dan ditolak lint);
  // dengan menyimpan kuncinya, data milik faskes lama otomatis dianggap belum siap
  // begitu kuncinya tidak cocok — tanpa satu pun setState tambahan.
  const kunci = g ? `${g.r.accountId}:${g.r.skema}` : null;
  const [hasil, setHasil] = useState<{ kunci: string; detail: Detail | null } | null>(null);

  // ── RENTANG PERIODE, kini diatur pemakai (permintaan user 2026-08-24) ─────────────
  // Sebelumnya dipatok tahun berjalan, dan itu memunculkan dua masalah yang dilaporkan
  // dari layar: (1) kartu memuat seluruh periode sementara grafik hanya tahun berjalan,
  // sehingga SEKAR LANGIT menampilkan kartu 1.425 tes di atas grafik yang totalnya 67 —
  // 1.424 dari 1.425 tesnya ada di 2025; (2) tabel "Reagen keluar" SUDAH difilter jendela
  // ini di server, jadi subtotalnya pun tak sebanding dengan kartu revenue di atasnya.
  //
  // Sekarang SATU rentang mengatur ketiganya: kartu, grafik, dan tabel reagen. Yang
  // membuatnya bisa sebanding bukan angkanya berubah, tapi ketiganya berhenti memakai
  // cakupan yang berbeda-beda.
  //
  // Default tetap TAHUN BERJALAN — keputusan user 2026-08-19 tidak dibatalkan, hanya
  // berhenti menjadi satu-satunya pilihan. Alasan aslinya masih berlaku: sheet memuat
  // 2025 sementara mirror faktur Accurate baru mulai 2026, jadi membuka pada rentang
  // penuh selalu menampilkan separuh grafik revenue kosong — terbaca sebagai kerusakan,
  // bukan sebagai batas data. Memakai tahun BERJALAN, bukan '2026' yang dipatok, supaya
  // tidak jadi salah sendiri tahun depan.
  // Rentang di-RESET ke bawaan setiap kali faskes berganti — tanpa itu, rentang sempit
  // yang dipilih untuk satu faskes terbawa ke faskes berikutnya yang mungkin tidak punya
  // data di sana sama sekali, dan dialog terbuka kosong tanpa sebab yang terlihat.
  //
  // Reset-nya lewat KUNCI yang disimpan bersama nilainya, BUKAN lewat setState di dalam
  // effect — cara itu memicu render berantai dan ditolak lint (`set-state-in-effect`),
  // pola yang sudah dipakai `hasil` di bawah untuk alasan yang sama. Begitu kuncinya tidak
  // cocok, nilainya jatuh ke bawaan dengan sendirinya: nol effect, nol render tambahan.
  const [rentang, setRentang] = useState<{ kunci: string | null; dari: string; sampai: string }>(
    { kunci: null, dari: "", sampai: "" });
  const rentangCocok = rentang.kunci === kunci;
  const dari = rentangCocok ? rentang.dari : awalTahunIni();
  const sampai = rentangCocok ? rentang.sampai : bulanIni();
  const setDari = (v: string) => setRentang({ kunci, dari: v, sampai });
  const setSampai = (v: string) => setRentang({ kunci, dari, sampai: v });

  useEffect(() => {
    // accountId null = faskes belum terpetakan ke Accurate; riwayat revenue-nya tidak
    // mungkin ada, jadi tidak usah memanggil backend sekadar untuk mendapat kosong.
    // Ditangani saat render, bukan lewat state.
    if (!kunci || !g || g.r.accountId === null) return;
    let batal = false;
    // Jendela dikirim EKSPLISIT, jendela yang sama dengan grafik di bawah. Kalau server
    // menghitung "tahun berjalan" sendiri, daftar reagen bisa memakai periode berbeda
    // dari grafiknya tanpa ada yang menandai.
    fetch(`/api/kso/produktivitas/faskes/${g.r.accountId}?skema=${encodeURIComponent(g.r.skema)}`
      + `&dari=${dari}&sampai=${sampai}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Detail) => { if (!batal) setHasil({ kunci, detail: d }); })
      .catch(() => { if (!batal) setHasil({ kunci, detail: null }); });
    return () => { batal = true; };
    // `dari`/`sampai` ikut dependency: HANYA reagen yang difilter di server (tren &
    // trenAlat dikirim seluruh periode dan disaring di klien), jadi tanpa fetch ulang
    // tabel reagen akan tertinggal di rentang lama sementara grafiknya sudah pindah —
    // dua cakupan berbeda lagi, persis yang perubahan ini ada untuk menghentikan.
  }, [kunci, g, dari, sampai]);

  if (!g) return null;
  const r = g.r;
  const siap = hasil !== null && hasil.kunci === kunci;
  const detail = siap ? hasil.detail : null;
  const gagal = siap && hasil.detail === null;

  // Sumbu-x dirangka dari deret bulan LENGKAP antara titik pertama & terakhir, sama
  // seperti grafik Ringkasan: tanpa itu bulan tanpa data lenyap dari sumbu sehingga dua
  // bulan berjauhan terlihat bersebelahan. Rentangnya dipegang sebagai state di atas.
  const dalamJendela = (p: string) => p >= dari && p <= sampai;

  const titik = (detail?.tren ?? []).filter((t) => dalamJendela(t.periode));
  // Data yang ADA tapi di luar jendela — dipakai membedakan "belum pernah ada laporan"
  // dari "ada laporan, tapi bukan tahun ini". Tanpa ini alat yang berhenti dipakai akhir
  // 2025 tampil sama persis dengan alat yang tidak punya riwayat sama sekali.
  const luarJendela = (detail?.tren ?? []).filter((t) => !dalamJendela(t.periode));
  const adaTesLama = luarJendela.some((t) => t.jumlahTes !== null);
  const adaRevLama = luarJendela.some((t) => t.revenueNetto !== null);

  // ── ANGKA KARTU MENGIKUTI RENTANG ────────────────────────────────────────────────
  // Dijumlahkan dari `titik` (tren per bulan yang sudah disaring jendela), BUKAN dibaca
  // dari kolom view yang selalu seluruh periode. Ini yang membuat kartu, grafik, dan
  // tabel reagen akhirnya memakai cakupan yang sama.
  //
  // NILAI SELURUH PERIODE TETAP DITAMPILKAN sebagai pembanding saat rentangnya dipersempit
  // — bukan basa-basi: kolom "Rp / tes" di TABEL utama memakai seluruh periode (itu dasar
  // peringkat & median-nya). Kalau dialog cuma menampilkan angka jendela, pembaca akan
  // membandingkannya dengan tabel dan menemukan selisih tanpa sebab yang terlihat —
  // bentuk cacat yang sama yang baru saja dibereskan, cuma berpindah tempat.
  const tesJdl = titik.reduce((s, t) => s + (t.jumlahTes ?? 0), 0);
  const revJdl = titik.reduce((s, t) => s + (t.revenueNetto ?? 0), 0);
  const adaTesJdl = titik.some((t) => t.jumlahTes !== null);
  const adaRevJdl = titik.some((t) => t.revenueNetto !== null);
  const rpTesJdl = tesJdl > 0 && adaRevJdl ? revJdl / tesJdl : null;

  // Rentang penuh = tidak ada data di luar jendela. Diturunkan dari datanya, bukan dari
  // membandingkan tanggal: kalau memang seluruh data ada di dalam jendela, kartu tidak
  // perlu menyodorkan pembanding yang nilainya sama.
  const jendelaPenuh = luarJendela.length === 0;

  // ── TES DILAPORKAN vs TES DITAGIHKAN: dua sumber, satuan sama ────────────────────
  // Dilaporkan dari layar: kartu menunjukkan 616 tes sementara baris
  // 'PEMERIKSAAN POCT IMMUNOLOGY WONDFO FIA METER' di tabel berqty 703 TEST — terbaca
  // sebagai satu angka yang tidak konsisten. Bukan: keduanya sah dan datang dari sumber
  // BERBEDA yang kebetulan bersatuan sama —
  //   dilaporkan  = sheet KSO, diisi teknisi      (kso_asset_test_monthly)
  //   ditagihkan  = qty baris PEMERIKSAAN di faktur Accurate
  // Selisihnya justru salah satu hal yang paling perlu dilihat orang: ia bisa berarti
  // laporan teknisi kurang, atau tagihan lebih. Sistem sudah mengukurnya sebagai
  // rasio_tagih_lapor (103-105) dan menandainya di atas ambang 25%, tapi angka mentahnya
  // tidak pernah disandingkan — jadi pembaca menemukan selisihnya sendiri dan
  // menyimpulkan datanya rusak.
  const labelJendela = `${labelBulan(dari)}–${labelBulan(sampai)}`;

  // Opsi bulan digabung dari periode yang ADA di data DAN deret bawaan — pola yang sama
  // dengan filter tren di tab Ringkasan. Kalau hanya dari data, bulan bawaan yang belum
  // berdata tidak bisa dipilih; kalau hanya deret bawaan, riwayat 2025 tak terjangkau.
  const periodeData = [...(detail?.tren ?? []).map((t) => t.periode),
                       ...(detail?.trenAlat ?? []).map((t) => t.periode)];
  const opsiBulan = [...new Set([...periodeData, ...deretBulan(awalTahunIni(), bulanIni())])].sort();
  // Rentang PENUH menurut data — dipakai preset "semua". Menyebut tahunnya, bukan kata
  // "semua": itu pelajaran yang sama dengan `seluruh periode` yang gagal menyampaikan
  // apa pun karena tidak memuat angka.
  const rentangPenuh = opsiBulan.length
    ? { d: opsiBulan[0], s: opsiBulan[opsiBulan.length - 1] }
    : { d: dari, s: sampai };

  const seri = deretBulan(dari, sampai).length
    ? deretBulan(dari, sampai).map((p) => {
        const t = titik.find((x) => x.periode === p);
        return { label: labelBulan(p), tes: t?.jumlahTes ?? null, revenue: t?.revenueNetto ?? null };
      })
    : [];
  // `seri` kini hanya melayani grafik REVENUE (level faskes). Grafik tes dipecah per
  // alat dan masing-masing merangka deret bulannya sendiri dari trenAlat.
  const adaRev = seri.some((s) => s.revenue !== null);
  // Skala dihitung dari nilai terbesar di jendela ini, bukan tetap — lihat skalaRp().
  const skalaRev = skalaRp(Math.max(0, ...seri.map((x) => x.revenue ?? 0)));

  // Total & hitungan di luar skema dipakai di dua tempat (judul + catatan), jadi dihitung
  // sekali. Total mencakup baris di luar skema — itu memang "reagen yang keluar",
  // pertanyaan yang berbeda dari "revenue skema ini".
  // DUA subtotal, bukan satu. Yang "dalam skema" sepadan dengan kartu Revenue di atas;
  // yang "di luar skema" TIDAK masuk angka itu. Menampilkan satu total gabungan membuat
  // pembaca membandingkannya dengan kartu Revenue dan menemukan selisih tanpa sebab yang
  // terlihat.
  //
  // "Dalam skema" ditentukan di server dan sejak migrasi 124/125 BUKAN lagi semata soal
  // kategori pengadaan: baris penagihan per-tes berkategori 'Tanpa kategori' juga masuk,
  // karena diakui sebagai revenue. Jangan menyimpulkannya dari `kategori` di sini —
  // aturannya tinggal di kso_penagihan_tes_v, dibaca oleh kartu, grafik, DAN subtotal ini.
  const rgn = detail?.reagen ?? [];

  // Rentang tahun NYATA yang diwakili kartu, diturunkan dari datanya sendiri. "seluruh
  // periode" saja terbukti tidak cukup: ia tidak menyebut tahun mana, jadi pembaca
  // menyangka kartu dan grafik memuat rentang yang sama lalu menemukan selisih tanpa
  // sebab yang terlihat. Menyebut "2025–2026" membuat perbandingannya berhenti tampak
  // seperti ketidaksinkronan data.
  const tahunAda = [...new Set([
    ...(detail?.trenAlat ?? []).filter((t) => t.jumlahTes !== null).map((t) => t.periode.slice(0, 4)),
    ...(detail?.tren ?? []).filter((t) => t.jumlahTes !== null || t.revenueNetto !== null)
      .map((t) => t.periode.slice(0, 4)),
  ])].sort();
  const subSeluruh = tahunAda.length === 0 ? "seluruh periode"
    : tahunAda.length === 1 ? `seluruh periode · ${tahunAda[0]}`
    : `seluruh periode · ${tahunAda[0]}–${tahunAda[tahunAda.length - 1]}`;
  const totalDalam = rgn.filter((r) => r.dalamSkema).reduce((a, r) => a + (r.nilaiNetto ?? 0), 0);
  const totalLuar = rgn.filter((r) => !r.dalamSkema).reduce((a, r) => a + (r.nilaiNetto ?? 0), 0);
  const reagenLuar = rgn.filter((r) => !r.dalamSkema).length;

  // PERBANDINGAN DIBACA DARI VIEW, TIDAK DIHITUNG DI SINI. Versi pertama saya menjumlahkan
  // qty baris penagihan pada rentang terpilih lalu menguranginya dengan tes dilaporkan —
  // dan itu SALAH BASIS: `tes_ditagihkan_accurate` di view sengaja dibatasi ke bulan yang
  // PUNYA laporan sheet (CTE `periode_sheet`), sementara jumlah rentang memuat juga bulan
  // yang tidak ada laporannya. Bulan seperti itu akan terhitung sebagai "ditagihkan lebih"
  // padahal artinya "belum dilaporkan" — melebih-lebihkan selisih ke arah yang menuduh
  // penagihan. Aturannya sudah ada di SQL sejak 103-105; menghitung ulang di sini berarti
  // definisi kedua yang menyimpang, pola yang sudah tiga kali dihukum di sesi ini.
  //
  // Konsekuensi yang disengaja: angka ini TIDAK mengikuti rentang di atas. Karena itu
  // basisnya ditulis eksplisit di layar, bukan dibiarkan tampak seperti angka rentang.
  const tagihView = r.tesDitagihkanAccurate;
  const laporView = r.tesSheetPeriodeBanding;
  const selisihTagih = tagihView !== null && laporView !== null && laporView > 0
    ? tagihView - laporView : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="break-words">{g.faskes}</DialogTitle>
          <p className="text-muted-foreground text-xs">
            {[g.kota, r.skema === "PER_TEST" ? "PER_TEST (KSO Tes)" : "BELI_REAGEN (KSO Reagen)"]
              .filter(Boolean).join(" · ")}
          </p>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FilterPeriode
            dari={dari} sampai={sampai} setDari={setDari} setSampai={setSampai}
            opsi={opsiBulan} penuh={rentangPenuh}
          />

          {/* SATU CAKUPAN untuk kartu, grafik, dan tabel reagen — itu inti perubahan
              2026-08-24. Sebelumnya kartu selalu seluruh periode sementara grafik & tabel
              reagen dibatasi tahun berjalan, dan selisihnya terbaca sebagai data tidak
              sinkron: SEKAR LANGIT menampilkan kartu 1.425 tes di atas grafik bertotal 67
              (1.424 dari 1.425 tesnya ada di 2025).
              Nilai seluruh periode tetap disebut di `sub` saat rentang dipersempit, karena
              kolom Rp/tes di TABEL utama memakai seluruh periode — tanpa pembanding itu,
              selisih yang sama cuma berpindah tempat. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Label menyebut SUMBERNYA ("dilaporkan"), bukan cuma "Tes (customer)":
                di tabel bawah ada angka tes lain dari sumber berbeda (qty penagihan =
                ditagihkan), dan tanpa penyebutan itu keduanya terbaca sebagai satu
                besaran yang tidak konsisten. */}
            <Angka label="Tes dilaporkan" nilai={adaTesJdl ? num(tesJdl) : "—"}
              sub={jendelaPenuh ? subSeluruh
                : `${labelJendela} · seluruh periode ${num(r.totalTesCustomerSeskema)}`} />
            <Angka label="Revenue netto" nilai={adaRevJdl ? rp(revJdl) : "—"}
              sub={jendelaPenuh ? subSeluruh
                : `${labelJendela} · seluruh periode ${rp(r.revenueNettoCustomer)}`} />
            {/* Kartu ini WAJIB mengikuti kolom di tabel. Kalau tabel menyatakan skema ini
                tidak punya Rp/tes sementara dialognya tetap menampilkannya, itu dua angka
                yang bertentangan di satu alur baca — jenis cacat yang persis kita bereskan
                di 125/126. Keputusan "skema mana pakai Rp/tes" karena itu dibaca dari
                satu tempat (`skemaPakaiRpTes`), bukan diulang di sini. */}
            {skemaPakaiRpTes(r.skema) ? (
              <Angka
                label="Rp / tes"
                nilai={rp(jendelaPenuh ? r.rupiahPerTesCustomer : rpTesJdl)}
                // "× median" HANYA saat rentang penuh: median dari server dihitung atas
                // basis seluruh periode, jadi membandingkan angka jendela terhadapnya
                // adalah rasio antar dua cakupan berbeda — terlihat presisi, tapi salah.
                sub={jendelaPenuh
                  ? [median && r.rupiahPerTesCustomer
                       ? `${(r.rupiahPerTesCustomer / median).toFixed(2)}× median` : null,
                     subSeluruh].filter(Boolean).join(" · ")
                  : `${labelJendela} · seluruh periode ${rp(r.rupiahPerTesCustomer)}`}
                redup={!r.basisTesMemadai}
              />
            ) : (
              <Angka
                label="Rp / alat"
                nilai={rp(jendelaPenuh ? rupiahPerAlat(r)
                  : (r.alatSeskemaDiCustomer && r.alatSeskemaDiCustomer > 0 && adaRevJdl
                      ? revJdl / r.alatSeskemaDiCustomer : null))}
                sub={jendelaPenuh
                  ? "belanja per alat · bukan produktivitas"
                  : `belanja per alat · ${labelJendela}`}
              />
            )}
            <Angka label="Alat berbagi angka" nilai={String(r.alatSeskemaDiCustomer ?? g.alatList.length)} />
          </div>

          {/* Kedua angka DISANDINGKAN, bukan dibiarkan ditemukan sendiri di dua tempat.
              Ditampilkan hanya bila keduanya ada — dan hanya bila selisihnya di atas 5%,
              karena selisih kecil itu lumrah (beda tanggal potong laporan vs faktur) dan
              menandainya tiap kali akan membuat penanda ini diabaikan justru saat besar. */}
          {/* PAGAR: `rasio_tagih_lapor` NULL = view menyatakan tidak ada bulan bercatatan
              tes di Accurate (bulan_tertagih = 0), BUKAN "ditagihkan nol". Tanpa syarat ini
              faskes seperti itu tampil "-100% — dilaporkan lebih banyak daripada yang
              ditagihkan", tuduhan terhadap penagihan yang sebenarnya cuma ketiadaan data.
              Terlihat di dev: lapor 13.466 / 36.983 dengan tagih 0 dan rasio NULL.
              Pagarnya diambil dari view, bukan disimpulkan sendiri dari angka nol. */}
          {r.rasioTagihLapor !== null && selisihTagih !== null && laporView !== null
            && Math.abs(selisihTagih) / laporView > 0.05 ? (
            <div className="border-border flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border p-2.5 text-xs">
              <span className="text-muted-foreground">Lapor vs tagih:</span>
              <span className="font-medium tabular-nums">{num(tagihView)} ditagihkan</span>
              <span className="text-muted-foreground">vs</span>
              <span className="font-medium tabular-nums">{num(laporView)} dilaporkan</span>
              <span className={cn("font-medium tabular-nums",
                                  Math.abs(selisihTagih) / laporView > 0.25 && "text-amber-600")}>
                {selisihTagih > 0 ? "+" : ""}{num(selisihTagih)}
                {" "}({(selisihTagih / laporView * 100).toFixed(0)}%)
              </span>
              <span className="text-muted-foreground">
                — {selisihTagih > 0
                    ? "ditagihkan lebih banyak daripada yang dilaporkan teknisi"
                    : "dilaporkan lebih banyak daripada yang ditagihkan"}
              </span>
              {/* Basis DITULIS, karena angka ini satu-satunya di dialog yang tidak
                  mengikuti rentang di atas — dan tanpa keterangan itu, ia akan jadi
                  laporan "tidak sinkron" yang berikutnya. */}
              <span className="text-muted-foreground ml-auto text-[11px]">
                basis: bulan yang ada laporannya (bukan rentang di atas)
              </span>
            </div>
          ) : null}

          {PENANDA.some((p) => p.uji(r)) ? (
            <div className="flex flex-wrap gap-1.5">
              {!r.basisTesMemadai ? <Tag warna="merah" judul="Penyebut < 100 tes/thn — jangan dipakai memeringkat">penyebut tipis</Tag> : null}
              {r.tagihPolaDatar ? <Tag warna="kuning" judul="Qty Accurate datar tiap bulan = minimum kontrak, bukan hitungan tes">minimum kontrak</Tag> : null}
              {r.revenueTumpangTindih ? <Tag warna="biru" judul={`Faskes berskema ganda; porsi KSO ${r.porsiKso ?? "—"}`}>skema ganda</Tag> : null}
              {r.statusPenagihan === "tanpa_faktur" ? <Tag warna="merah" judul="Tidak ada faktur atas nama faskes ini">tanpa faktur</Tag> : null}
              {r.rasioTagihLapor !== null && Math.abs(r.rasioTagihLapor - 1) > 0.25
                ? <Tag warna="kuning" judul="Tes yang ditagihkan di Accurate menyimpang >25% dari yang dilaporkan">tagih/lapor {r.rasioTagihLapor.toFixed(2)}</Tag> : null}
            </div>
          ) : null}

          {r.accountId === null ? (
            <Catatan>
              Faskes ini <strong>belum terpetakan</strong> ke customer Accurate, jadi tidak ada
              riwayat revenue yang bisa ditampilkan. Yang tampil hanya angka dari sheet.
            </Catatan>
          ) : gagal ? (
            <Catatan>Gagal memuat detail. Coba tutup dan buka lagi.</Catatan>
          ) : !siap || detail === null ? (
            <div className="text-muted-foreground py-8 text-center text-xs">Memuat riwayat…</div>
          ) : (
            <>
              {/* SATU GRAFIK TES PER ALAT (permintaan user 2026-08-19) — datanya
                  memang per aset di kso_asset_test_monthly. Diurutkan mengikuti daftar
                  alat di bawah (tes terbanyak dulu) supaya dua bagian ini sejalan. */}
              <div className="grid gap-4 lg:grid-cols-2">
                {detail.alat.map((a) => {
                  const semua = detail.trenAlat.filter((t) => t.assetId === a.assetId);
                  const per = new Map(semua.filter((t) => dalamJendela(t.periode))
                    .map((t) => [t.periode, t.jumlahTes]));
                  const seriAlat = deretBulan(dari, sampai).map((x) => ({
                    label: labelBulan(x),
                    tes: per.get(x) ?? null,
                    target: a.targetJumlahTes,
                  }));
                  const punyaRiwayatLama = semua.some(
                    (t) => !dalamJendela(t.periode) && t.jumlahTes !== null);
                  // Σ titik grafik, DIHITUNG di sini alih-alih dibiarkan dijumlah pembaca.
                  // Label "seluruh periode" di kartu ternyata tidak cukup: pada AMIN MEDICAL
                  // pembaca membuka kalkulator, menjumlahkan 7 titik jadi 387, membandingkan
                  // dengan kartu 671, dan menyimpulkan datanya tidak sinkron. Padahal
                  // selisihnya tes 2025 — grafik dibatasi tahun berjalan atas permintaan
                  // user. Yang salah bukan angkanya, tapi bahwa dua cakupan berbeda
                  // ditampilkan berdampingan tanpa satu pun menyebut RENTANGNYA.
                  const tesJendela = seriAlat.reduce((s, x) => s + (x.tes ?? 0), 0);
                  const adaSelisih = a.totalTes !== null && a.totalTes !== tesJendela;
                  return (
                    <Grafik
                      key={a.assetId}
                      judul={a.namaAlat ?? a.snKey}
                      sub={[a.typeAlat,
                            a.targetJumlahTes ? `target ${a.targetJumlahTes.toLocaleString("id-ID")}/bln` : "tanpa target",
                            // Rentang + Σ-nya: menjawab "kenapa beda dari kartu" di tempat
                            // pertanyaannya muncul, bukan di catatan jauh di bawah.
                            `${dari.slice(0, 4)}: ${tesJendela.toLocaleString("id-ID")} tes`,
                            adaSelisih ? `seluruh periode ${a.totalTes!.toLocaleString("id-ID")}` : null]
                        .filter(Boolean).join(" · ")}
                      ada={seriAlat.some((x) => x.tes !== null)}
                      kosong={punyaRiwayatLama
                        ? `Tidak ada laporan di ${dari.slice(0, 4)} — riwayatnya ada di tahun sebelumnya.`
                        : "Belum ada laporan tes untuk alat ini."}
                    >
                      <LineChart data={seriAlat} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                          interval="preserveStartEnd" minTickGap={14} />
                        <YAxis tickLine={false} axisLine={false} width={40} tick={{ fontSize: 10 }}
                          tickFormatter={(v) => angkaSumbu(Number(v))} />
                        {/* Dibandingkan CASE-INSENSITIVE ke awalan "target": recharts
                            mengirim `name` seri — yaitu "Target"/"Realisasi" berhuruf
                            besar — bukan dataKey-nya. Membandingkan ke "target" persis
                            membuat KEDUA baris tooltip berlabel "realisasi", dan itu
                            bukan sekadar salah tulis: pembaca melihat dua angka
                            realisasi berbeda di bulan yang sama. */}
                        <ChartTooltip content={<ChartTooltipContent
                          formatter={(v, n) => [Number(v).toLocaleString("id-ID") + " tes",
                            String(n).toLowerCase().startsWith("target") ? " target" : " realisasi"]} />} />
                        {/* Legenda WAJIB begitu ada dua seri — identitas tidak boleh
                            bergantung pada warna saja. */}
                        {a.targetJumlahTes ? <Legend verticalAlign="top" height={22}
                          formatter={(v) => <span className="text-muted-foreground text-[11px]">{v}</span>} /> : null}
                        <Line type="monotone" dataKey="tes" name="Realisasi" stroke="var(--color-tes)"
                          strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                        {/* Target hanya digambar kalau alat ini PUNYA target. Menggambar
                            garis nol untuk alat tanpa target akan terbaca sebagai
                            "targetnya nol", bukan "tidak ada target". */}
                        {a.targetJumlahTes ? (
                          <Line type="monotone" dataKey="target" name="Target" stroke="var(--color-target)"
                            strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} />
                        ) : null}
                      </LineChart>
                    </Grafik>
                  );
                })}
              </div>

              {/* Revenue TETAP satu grafik level faskes, TIDAK dipecah per alat. Faktur
                  Accurate terbit atas nama faskes; tak satu pun kolom menautkan rupiah ke
                  unit tertentu. Alasannya ditulis di layar, bukan cuma di kode — kalau
                  tidak, pembaca akan menganggap bagian ini belum selesai dikerjakan. */}
              <Grafik judul="Riwayat revenue netto (seluruh faskes)"
                // Rentang + Σ, alasan sama dengan grafik tes per alat: kartu Revenue netto
                // memuat seluruh periode sementara grafik ini tahun berjalan, dan tanpa
                // keduanya disebut, selisihnya terbaca sebagai data yang tidak sinkron.
                sub={[`tidak dapat dipecah per alat`, skalaRev.satuan,
                      `${dari.slice(0, 4)}: ${rp(seri.reduce((s, x) => s + (x.revenue ?? 0), 0))}`]
                  .join(" · ")}
                ada={adaRev} kosong={adaRevLama
                  ? `Tidak ada faktur di ${dari.slice(0, 4)} — ada di tahun sebelumnya.`
                  : "Belum ada faktur."}>
                <LineChart data={seri} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10 }}
                    interval="preserveStartEnd" minTickGap={14} />
                  <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 10 }}
                    tickFormatter={(v) => skalaRev.format(Number(v))} />
                  <ChartTooltip content={<ChartTooltipContent
                    formatter={(v) => ["Rp " + Number(v).toLocaleString("id-ID"), ""]} />} />
                  <Line type="monotone" dataKey="revenue" stroke="var(--color-revenue)" strokeWidth={2}
                    dot={{ r: 2.5 }} activeDot={{ r: 5 }} connectNulls={false} />
                </LineChart>
              </Grafik>

              <p className="text-muted-foreground text-xs">
                Grafik dibatasi <strong>tahun {dari.slice(0, 4)}</strong>, sementara empat
                kartu di atas memakai <strong>seluruh periode</strong> — jadi menjumlahkan
                titik grafik tidak akan sama dengan kartu, dan itu bukan galat
                {adaTesLama || adaRevLama ? " (faskes ini punya riwayat sebelum itu)" : null}.
                Garis yang putus = bulan itu <strong>tidak ada laporan</strong>, bukan nol tes.
                <strong> Revenue tidak dipecah per alat</strong> karena faktur Accurate terbit
                atas nama faskes — tidak ada kolom yang menautkan rupiah ke unit tertentu, dan
                membaginya hanya akan menghasilkan angka yang terlihat presisi padahal karangan.
              </p>

              <div>
              {/* ── Reagen keluar ────────────────────────────────────────────────
                  "Rupiah masuk untuk reagen apa saja". Nilainya HASIL ALOKASI netto
                  faktur menurut porsi nilai baris (view kso_faskes_reagen_v, migrasi
                  120) — mekanisme sama dengan kartu Revenue di atas, jadi kedua angka
                  itu sepadan. Bukan penjumlahan nilai baris apa adanya. */}
              <div>
                <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium">Reagen keluar ({detail.reagen.length})</span>
                  <span className="text-muted-foreground text-[11px]">
                    {dari.slice(0, 4)} · dalam skema {rp(totalDalam)}
                    {totalLuar > 0 ? <> · di luar skema {rp(totalLuar)}</> : null}
                  </span>
                </div>
                {detail.reagen.length === 0 ? (
                  <p className="text-muted-foreground text-xs">
                    Belum ada baris faktur di {dari.slice(0, 4)} untuk faskes ini.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="border-border border-b text-left">
                          <th className="py-1.5 pr-2 font-medium">Item</th>
                          <th className="py-1.5 pr-2 font-medium">Kategori</th>
                          <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                          <th className="py-1.5 pr-2 font-medium">Satuan</th>
                          <th className="py-1.5 text-right font-medium">Nilai netto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Baris di luar skema DIREDUPKAN seluruhnya, bukan cuma ditandai di
                            kolom Kategori. Sebabnya dilaporkan dari layar: kolom ini bernama
                            "Nilai netto" dan grafik di atas "revenue netto" — nama yang sama
                            untuk cakupan berbeda — jadi pembaca menjumlahkan seluruh kolom
                            (Rp 22.416.785) dan membandingkannya dengan grafik (Rp 18.112.524,
                            yang hanya dalam-skema). Badge kecil di satu kolom tidak cukup
                            menahan penjumlahan itu; baris yang redup terbaca "tidak dihitung"
                            tanpa perlu dibaca. */}
                        {detail.reagen.map((r, i) => (
                          <tr key={`${r.itemId}-${r.kategori}-${r.unit}-${i}`}
                              className={cn("border-border/60 border-b last:border-0",
                                            !r.dalamSkema && "text-muted-foreground")}>
                            <td className="py-1.5 pr-2">
                              <div className="font-medium">{r.itemNama ?? r.itemNo ?? "(tanpa nama)"}</div>
                              <div className="text-muted-foreground">
                                {/* jenisAlat NULL = item belum terpetakan, BUKAN "bukan
                                    reagen alat" — dibedakan supaya tak disalahbaca. */}
                                {[r.itemNo, r.jenisAlat ?? "jenis alat belum terpetakan"]
                                  .filter(Boolean).join(" · ")}
                              </div>
                            </td>
                            <td className="py-1.5 pr-2">
                              {/* ALASAN yang benar, bukan sekadar "kategorinya tidak berlaku".
                                  Untuk item PEMERIKSAAN sebabnya BUKAN kategori: seluruhnya
                                  'Tanpa kategori' dan sebagiannya justru DIAKUI. Pada
                                  SEKAR LANGIT, '5DIFF Z52' dihitung sementara '3DIFF Z3'
                                  tidak — karena hanya Z52 yang asetnya ada. Tooltip lama
                                  menuduh kategorinya, jadi pembaca mencari sebab yang salah
                                  (dan bertanya kenapa Z3 tak punya grafik). */}
                              {r.dalamSkema
                                ? <span className="text-muted-foreground">{r.kategori}</span>
                                : r.penagihanTes
                                  ? <Tag warna="kuning" judul={`Penagihan tes untuk jenis alat${r.jenisAlat ? ` ${r.jenisAlat}` : ""} yang TIDAK dimiliki faskes ini pada skema ${g.r.skema} — karena itu tidak dihitung sebagai revenue skema ini, dan alatnya tidak punya grafik di atas`}>alat tak dimiliki</Tag>
                                  : <Tag warna="kuning" judul={`Kategori ${r.kategori} tidak dihitung sebagai revenue skema ini`}>{r.kategori}</Tag>}
                            </td>
                            <td className="py-1.5 pr-2 text-right tabular-nums">{num(r.qty)}</td>
                            <td className="text-muted-foreground py-1.5 pr-2">{r.unit}</td>
                            <td className="py-1.5 text-right tabular-nums">{rp(r.nilaiNetto)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {/* Subtotal SEJAJAR kolom "Nilai netto". Angka yang sama sudah ada di
                          judul bagian ini, tapi di sana ia tidak berdiri di bawah kolomnya —
                          dan yang dijumlahkan pembaca adalah KOLOM. Menaruh jangkarnya di
                          ujung kolom membuat hasil penjumlahan langsung ketemu pembandingnya,
                          alih-alih ketemu angka lain di judul yang cakupannya berbeda. */}
                      <tfoot className="border-border border-t">
                        <tr>
                          <td className="py-1.5 pr-2 font-medium" colSpan={4}>
                            Dalam skema <span className="text-muted-foreground">(= angka kartu &amp; grafik)</span>
                          </td>
                          <td className="py-1.5 text-right font-semibold tabular-nums">{rp(totalDalam)}</td>
                        </tr>
                        {totalLuar > 0 ? (
                          <tr className="text-muted-foreground">
                            <td className="py-1.5 pr-2" colSpan={4}>
                              Di luar skema <span className="text-[11px]">({reagenLuar} baris, tidak dihitung)</span>
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{rp(totalLuar)}</td>
                          </tr>
                        ) : null}
                        {totalLuar > 0 ? (
                          <tr className="text-muted-foreground border-border/60 border-t">
                            <td className="py-1.5 pr-2 text-[11px]" colSpan={4}>
                              Jumlah seluruh baris di tabel ini — <strong>bukan</strong> revenue skema
                            </td>
                            <td className="py-1.5 text-right text-[11px] tabular-nums">{rp(totalDalam + totalLuar)}</td>
                          </tr>
                        ) : null}
                      </tfoot>
                    </table>
                  </div>
                )}
                <p className="text-muted-foreground mt-1 text-xs">
                  Nilai = netto faktur <strong>teralokasi</strong> menurut porsi nilai baris,
                  bukan penjumlahan nilai baris apa adanya. Subtotal{" "}
                  <strong>dalam skema</strong> memakai aturan dan porsi KSO yang sama dengan
                  kartu <strong>Revenue netto</strong> di atas, jadi dua angka itu sepadan.
                  {reagenLuar > 0 ? (
                    /* "berkategori" DIHAPUS dari kalimat ini: sejak 124/125 sebuah baris bisa
                       di luar skema BUKAN karena kategorinya — penagihan tes untuk jenis alat
                       yang tak dimiliki juga masuk sini, dan kategorinya sama dengan yang
                       diakui. Menyebut "berkategori" mengulangi kesalahan tooltip lama. */
                    <> {reagenLuar} baris <strong>di luar skema ini</strong> ikut ditampilkan
                    (diredupkan, dan alasannya ada di kolom Kategori) lalu dijumlahkan
                    terpisah di bawah — <strong>tidak</strong> masuk angka Revenue.</>
                  ) : null}
                  {" "}Satu item bisa muncul dua kali bila ditagih dalam satuan berbeda —
                  qty lintas satuan tidak dijumlahkan.
                </p>
              </div>

                <div className="mb-1.5 text-xs font-medium">Alat ({detail.alat.length})</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr className="border-border border-b text-left">
                        <th className="py-1.5 pr-2 font-medium">Alat</th>
                        <th className="py-1.5 pr-2 font-medium">SN</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Total tes</th>
                        <th className="py-1.5 pr-2 text-right font-medium">Target/bln</th>
                        <th className="py-1.5 text-right font-medium">Capaian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.alat.map((a) => (
                        <tr key={a.assetId} className="border-border/60 border-b last:border-0">
                          <td className="py-1.5 pr-2">
                            <div className="font-medium">{a.namaAlat ?? "—"}</div>
                            <div className="text-muted-foreground">{a.typeAlat ?? ""}</div>
                          </td>
                          <td className="text-muted-foreground py-1.5 pr-2">{a.snRaw ?? a.snKey}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{num(a.totalTes)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{num(a.targetJumlahTes)}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {/* Capaian < 100% disorot: target itu komitmen kontrak, dan alat
                                yang jauh di bawahnya adalah alasan utama halaman ini ada. */}
                            {a.capaianTarget === null ? <span className="text-muted-foreground">—</span>
                              : <span className={cn(a.capaianTarget < 1 && "font-medium text-amber-600")}>
                                  {(a.capaianTarget * 100).toFixed(0)}%
                                </span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

// Kontrol rentang untuk SELURUH isi dialog — kartu, grafik, dan tabel reagen sekaligus.
// Ditaruh paling atas, sebelum kartu, supaya urutan bacanya "rentang ini → angka ini"
// dan bukan sebaliknya.
function FilterPeriode({ dari, sampai, setDari, setSampai, opsi, penuh }: {
  dari: string; sampai: string;
  setDari: (v: string) => void; setSampai: (v: string) => void;
  opsi: string[]; penuh: { d: string; s: string };
}) {
  const adaRentangLebih = penuh.d < dari || penuh.s > sampai;
  return (
    <div className="flex flex-wrap items-end gap-2.5 rounded-lg border border-border p-2.5">
      <Pilih label="Periode dari" value={dari} onChange={setDari}>
        {opsi.map((p) => <option key={p} value={p}>{labelBulan(p)}</option>)}
      </Pilih>
      <Pilih label="sampai" value={sampai} onChange={setSampai}>
        {opsi.map((p) => <option key={p} value={p}>{labelBulan(p)}</option>)}
      </Pilih>
      {/* Preset menyebut TAHUNNYA, bukan kata "semua": label tanpa angka persis yang
          membuat `seluruh periode` gagal menyampaikan bahwa 62% tes tidak digambar. */}
      {adaRentangLebih ? (
        <button type="button"
          onClick={() => { setDari(penuh.d); setSampai(penuh.s); }}
          className="text-muted-foreground hover:text-foreground pb-1 text-xs underline underline-offset-2">
          {penuh.d.slice(0, 4) === penuh.s.slice(0, 4)
            ? `Seluruh data (${penuh.d.slice(0, 4)})`
            : `Seluruh data (${penuh.d.slice(0, 4)}–${penuh.s.slice(0, 4)})`}
        </button>
      ) : null}
      {dari > sampai ? (
        <span className="pb-1 text-xs text-amber-600">Rentang terbalik — pilih “sampai” setelah “dari”.</span>
      ) : null}
      <div className="text-muted-foreground ml-auto pb-1 text-[11px]">
        Kartu, grafik &amp; tabel reagen mengikuti rentang ini.
      </div>
    </div>
  );
}

function Angka({ label, nilai, sub, redup }: {
  label: string; nilai: string; sub?: string; redup?: boolean;
}) {
  return (
    <div className="border-border rounded-lg border p-2.5">
      <div className="text-muted-foreground text-[11px]">{label}</div>
      <div className={cn("text-base font-semibold tabular-nums", redup && "text-muted-foreground")}>{nilai}</div>
      {sub ? <div className="text-muted-foreground text-[11px]">{sub}</div> : null}
    </div>
  );
}

function Grafik({ judul, sub, ada, kosong, children }: {
  judul: string; sub?: string; ada: boolean; kosong: string;
  children: React.ComponentProps<typeof ChartContainer>["children"];
}) {
  return (
    <div>
      <div className="text-xs font-medium">{judul}</div>
      {sub ? <div className="text-muted-foreground mb-1 text-[11px]">{sub}</div> : <div className="mb-1" />}
      {ada ? (
        <ChartContainer config={cfg} className="aspect-auto h-[190px] w-full">{children}</ChartContainer>
      ) : (
        <div className="text-muted-foreground flex h-[190px] items-center justify-center text-xs">{kosong}</div>
      )}
    </div>
  );
}

function Catatan({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/50 p-2.5 text-xs">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <p>{children}</p>
    </div>
  );
}
