// Export hasil simulasi ke Excel siap cetak A4.
//
// Port dari lib/exportExcel.js aplikasi runningcost-zybio. Susunan barisnya
// dipertahankan supaya file yang sudah beredar ke faskes tetap dikenali bentuknya.
//
// Pakai `xlsx-js-style` (bukan `write-excel-file` yang dipakai menu lain) karena
// lembar ini butuh gaya sel: baris CPRR disorot kuning, itu yang dicari mata
// pertama kali saat file dibuka. Impornya dinamis supaya ±700 KB library-nya
// tidak ikut bundel halaman yang cuma menghitung.

const F = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("id-ID");

const Rp = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  return r === 0 ? "Rp 0" : `Rp ${r.toLocaleString("id-ID")}`;
};

const tanggalHariIni = (): string =>
  new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });

const namaFileAman = (s: string): string => s.replace(/[\s·()/\\:*?"<>|]/g, "_");

type Baris = (string | number)[];

/** Sorotan baris harga jual — kuning + garis atas/bawah oranye. */
const GAYA_CPRR = {
  font: { bold: true, sz: 12 },
  fill: { fgColor: { rgb: "FFF9C4" } },
  border: {
    top: { style: "thin", color: { rgb: "F9A825" } },
    bottom: { style: "thin", color: { rgb: "F9A825" } },
  },
};

export interface InfoKunjungan {
  salesName: string;
  faskesName: string;
  kotaKab: string;
  kompetitor: string;
}

export interface RincianCapex {
  alat: number;
  backup: number;
  ups: number;
  lis: number;
}

interface RingkasKso {
  analyzerName: string;
  backupLabel: string;
  totCap: number;
  capex: RincianCapex;
  kso: number;
  testsPerMonth: number;
  totTest: number;
  workDays: number;
  markup: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- xlsx-js-style tidak punya tipe resmi */

async function tulis(
  sheetName: string,
  aoa: Baris[],
  lebarKolom: number[],
  barisSorot: number,
  namaFile: string,
) {
  const mod: any = await import("xlsx-js-style");
  const XLSX: any = mod.default ?? mod;

  const ws: any = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = lebarKolom.map((w) => ({ wch: w }));
  ws["!pageSetup"] = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws["!margins"] = { left: 0.75, right: 0.75, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 };

  if (barisSorot >= 0) {
    "ABCDEFG".slice(0, lebarKolom.length).split("").forEach((col) => {
      const addr = `${col}${barisSorot + 1}`;
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      ws[addr].s = GAYA_CPRR;
    });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  unduh(
    new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    namaFile,
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */

function unduh(blob: Blob, namaFile: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

/** Baris ringkasan yang sama untuk semua kategori. */
function barisRingkas(r: RingkasKso, info: InfoKunjungan, kolom: number, satuanTest: string): Baris[] {
  const pad = (b: (string | number)[]): Baris => [...b, ...Array(Math.max(0, kolom - b.length)).fill("")];
  const rinci: Baris[] = [];
  if (r.capex.alat > 0) rinci.push(pad(["  └ Harga alat", Rp(r.capex.alat)]));
  if (r.capex.backup > 0) rinci.push(pad(["  └ Backup analyzer", Rp(r.capex.backup)]));
  if (r.capex.ups > 0) rinci.push(pad(["  └ UPS", Rp(r.capex.ups)]));
  if (r.capex.lis > 0) rinci.push(pad(["  └ LIS", Rp(r.capex.lis)]));

  return [
    pad(["Nama sales", info.salesName || "—"]),
    pad(["Nama faskes", info.faskesName || "—"]),
    pad(["Kota / kabupaten", info.kotaKab || "—"]),
    pad([]),
    pad(["RINGKASAN KSO"]),
    pad(["Nama analyzer", r.analyzerName]),
    ...(r.backupLabel ? [pad(["Backup analyzer", r.backupLabel])] : []),
    pad(["Total CAPEX", Rp(r.totCap)]),
    ...rinci,
    pad(["Masa KSO", `${r.kso} bulan`]),
    pad([`${satuanTest} / bulan`, `${F(r.testsPerMonth)} ${satuanTest.toLowerCase()}`]),
    pad(["Total target test KSO", `${F(r.totTest)} test`]),
    pad(["Hari kerja / bulan", `${r.workDays} hari`]),
    pad(["Margin / markup", `${r.markup}%`]),
  ];
}

// ── Hematologi ──────────────────────────────────────────────────────────────

export interface BarisExcelHemato {
  nama: string;
  pack: string | null;
  nettKit: number;
  kontribusiTest: number;
  hargaExcel: number;
}

export async function exportHemato(arg: {
  ringkas: RingkasKso;
  info: InfoKunjungan;
  qcFree: boolean;
  capPerTest: number;
  reagenPerTest: number;
  overheadKontrol: number;
  sellPerTest: number;
  rows: BarisExcelHemato[];
}) {
  const { ringkas: r, info } = arg;
  const d = tanggalHariIni();
  const base = arg.capPerTest + arg.reagenPerTest + arg.overheadKontrol;

  const aoa: Baris[] = [
    ["KSO CPRR — HEMATOLOGI", "", "", ""],
    ["Wahana Lifeline", "", "", `Tanggal: ${d}`],
    ...barisRingkas(r, info, 4, "Test"),
    ["QC & kalibrator", arg.qcFree ? "FREE — ditanggung supplier" : "PAID — dibeli sendiri", "", ""],
    ["", "", "", ""],
    ["CPRR — COST PER TEST", "", "", ""],
    ["CAPEX / test", Rp(arg.capPerTest), "", ""],
    ["Reagen / test", Rp(arg.reagenPerTest), "", ""],
    ...(arg.overheadKontrol > 0 ? [["QC + kalibrasi / test", Rp(arg.overheadKontrol), "", ""]] : []),
    ["Base cost / test", Rp(base), "", ""],
    [`Markup ${r.markup}%`, Rp(arg.sellPerTest - base), "", ""],
    ["CPRR (harga jual / test)", Rp(arg.sellPerTest), "", ""],
    ["", "", "", ""],
    ["RINCIAN REAGEN", "", "", ""],
    ["Nama barang", "Kemasan", "Kontribusi/test", "Harga KSO di Excel"],
    ...arg.rows.map((x) => [
      x.nama, x.pack ?? "", Rp(x.kontribusiTest), x.hargaExcel > 0 ? Rp(x.hargaExcel) : "—",
    ]),
    ["", "", "", ""],
    ["Informasi kompetitor", info.kompetitor || "—", "", ""],
  ];

  // Perkiraan kebutuhan reagen — dipakai tim supply chain menyiapkan stok
  // sebelum kontrak jalan, bukan bagian dari penawaran harga.
  const supply = arg.rows.filter((x) => x.nettKit > 0);
  if (supply.length > 0) {
    aoa.push(["", "", "", ""]);
    aoa.push(["SUPPLY CHAIN FORECAST — KEBUTUHAN REAGEN / BULAN", "", "", ""]);
    aoa.push(["Nama barang", "Kemasan", "Kebutuhan/bulan (kit)", "Kebutuhan/tahun (kit)"]);
    for (const x of supply) {
      const perBulan =
        r.testsPerMonth > 0 ? Number(((x.kontribusiTest * r.testsPerMonth) / x.nettKit).toFixed(2)) : 0;
      aoa.push([x.nama, x.pack ?? "", perBulan, Number((perBulan * 12).toFixed(2))]);
    }
  }

  await tulis(
    "Hematologi",
    aoa,
    [34, 28, 20, 22],
    aoa.findIndex((row) => row[0] === "CPRR (harga jual / test)"),
    `KSO_CPRR_Hemato_${namaFileAman(r.analyzerName)}_${d.replace(/\//g, "-")}.xlsx`,
  );
}

// ── Kimia Klinik ────────────────────────────────────────────────────────────

export interface BarisExcelKk {
  nama: string;
  panel: string;
  pack: string | null;
  testsPerKit: number;
  sellTest: number;
  sellKit: number;
}

export async function exportKk(arg: {
  ringkas: RingkasKso;
  info: InfoKunjungan;
  capPerTest: number;
  consumablePerTest: number;
  overheadTotal: number;
  adaOverhead: boolean;
  qcPerTest: number;
  calPerTest: number;
  avgSellPerTest: number;
  rows: BarisExcelKk[];
  consumable: { nama: string; perTest: number }[];
}) {
  const { ringkas: r, info } = arg;
  const d = tanggalHariIni();
  const K = 7;
  const pad = (b: (string | number)[]): Baris => [...b, ...Array(Math.max(0, K - b.length)).fill("")];

  const aoa: Baris[] = [
    pad(["KSO CPRR — KIMIA KLINIK"]),
    [...Array(K - 1).fill(""), `Tanggal: ${d}`].map((v, i) => (i === 0 ? "Wahana Lifeline" : v)),
    ...barisRingkas(r, info, K, "Sampel"),
    pad([]),
    pad(["CPRR — RATA-RATA (SEMUA PARAMETER)"]),
    pad(["CAPEX / test", Rp(arg.capPerTest)]),
    pad(["Consumable / test", Rp(arg.consumablePerTest)]),
    ...(arg.adaOverhead ? [pad(["QC + kalibrasi / test", Rp(arg.overheadTotal)])] : []),
    pad(["CPRR rata-rata (harga jual / test)", Rp(arg.avgSellPerTest)]),
    pad([]),
    pad(["RINCIAN PARAMETER"]),
    ["No", "Parameter", "Panel", "Kemasan", "Test/kit", "Sell/test", "Sell/kit"],
    ...arg.rows.map((x, i) => [
      i + 1, x.nama, x.panel, x.pack ?? "",
      x.testsPerKit ? `${F(x.testsPerKit)}T` : "—",
      Rp(x.sellTest), Rp(x.sellKit),
    ]),
    pad([]),
    pad(["BEBAN CONSUMABLE / TEST"]),
    pad(["Item", "Cost / test"]),
    ...arg.consumable.map((c) => pad([c.nama, Rp(c.perTest)])),
    pad(["Total consumable / test", Rp(arg.consumablePerTest)]),
    pad(["+ CAPEX / test", Rp(arg.capPerTest)]),
    ...(arg.adaOverhead
      ? [
          pad([]),
          pad(["QC & KALIBRATOR — OVERHEAD / TEST (FREE)"]),
          pad(["QC control / test", Rp(arg.qcPerTest)]),
          pad(["Kalibrasi / test", Rp(arg.calPerTest)]),
          pad(["Total overhead QC + cal / test", Rp(arg.overheadTotal)]),
        ]
      : []),
    pad([]),
    pad([
      "Total beban tetap / test",
      Rp(arg.capPerTest + arg.consumablePerTest + arg.overheadTotal),
    ]),
    pad(["Informasi kompetitor", info.kompetitor || "—"]),
  ];

  await tulis(
    "Kimia Klinik",
    aoa,
    [6, 32, 14, 14, 10, 18, 18],
    aoa.findIndex((row) => String(row[0]).startsWith("CPRR rata-rata")),
    `KSO_CPRR_KimiaKlinik_${namaFileAman(r.analyzerName)}_${d.replace(/\//g, "-")}.xlsx`,
  );
}
