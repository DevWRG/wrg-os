// Cetak hasil simulasi jadi dokumen A4 (Print → Save as PDF).
//
// Port dari lib/printPdf.js aplikasi runningcost-zybio: dokumen dirakit sebagai
// HTML lengkap lalu dibuka di tab baru dan langsung memanggil print(). Cara ini
// dipertahankan, bukan @media print di halaman aslinya, karena yang dicetak
// adalah dokumen penawaran — bukan tangkapan layar aplikasi dengan sidebar,
// tombol, dan tab yang ikut terbawa.
//
// Logonya diambil dari /brand/wahana-lifeline-white.png milik apps/web (aplikasi
// asal menyematkan base64-nya di kode).

import type {
  BarisExcelHemato, BarisExcelKk, DokumenKso, InfoKunjungan, RingkasKso,
} from "./export-excel";
import type { HargaInput } from "./types";

const F = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("id-ID");

const Rp = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const r = Math.round(v);
  return r === 0 ? "Rp 0" : `Rp ${r.toLocaleString("id-ID")}`;
};

const tanggalHariIni = (): string =>
  new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });

const esc = (s: string | null | undefined): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Warna mengikuti palet WRG-OS (apps/web/src/app/globals.css :root): primary #0ca6bd, primary-dark #0a8a9e,
// accent-foreground #0a7c8c, foreground #1e293b, muted-foreground #64748b, border #e4e8ef, muted #f1f5f9,
// primary-soft #e0f7fb, success #10b981, warning #f59e0b. Header memakai teal TERGELAP (#0a7c8c): judul & tanggal
// putih di header dibaca OCR bot #KSO (services/ai/app/kso_cprr.py) — teal primary #0ca6bd terlalu terang untuk itu.
// Nama kelas navy/green/amber dipertahankan (dipakai semua kategori), warnanya yang diganti.
const CSS = `
@page { size: A4 portrait; margin: 12mm 15mm; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1e293b; background: #fff; }
.hdr { background: #0a7c8c; padding: 14px 16px 12px; display: flex; justify-content: space-between; align-items: flex-end;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.hdr-title { font-size: 13pt; font-weight: 800; color: #fff; letter-spacing: .3px; }
.hdr-sub { font-size: 7.5pt; color: rgba(255,255,255,.8); letter-spacing: 1.5px; text-transform: uppercase; margin-top: 3px; }
.hdr-date { font-size: 8pt; color: rgba(255,255,255,.9); text-align: right; margin-top: 4px; }
.hdr img { height: 34px; max-width: 180px; object-fit: contain; display: block; }
.meta { background: #f1f5f9; border-bottom: 1px solid #e4e8ef; padding: 7px 16px; display: grid;
  grid-template-columns: 1fr 1fr 1fr; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.meta-item { display: flex; flex-direction: column; gap: 1px; }
.meta-item:not(:last-child) { border-right: 1px solid #e4e8ef; padding-right: 12px; margin-right: 12px; }
.meta-lbl { font-size: 7pt; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #64748b; }
.meta-val { font-size: 9.5pt; font-weight: 600; color: #0a7c8c; }
.body { padding: 13px 16px 14px; display: flex; flex-direction: column; gap: 12px; }
.sec-hdr { display: flex; align-items: center; gap: 7px; margin-bottom: 7px; }
.sec-bar { width: 3px; height: 12px; border-radius: 2px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sec-bar.navy { background: #0ca6bd; } .sec-bar.green { background: #10b981; } .sec-bar.amber { background: #f59e0b; }
.sec-ttl { font-size: 7.5pt; font-weight: 800; letter-spacing: 1.5px; text-transform: uppercase; }
.sec-ttl.navy { color: #0a7c8c; } .sec-ttl.green { color: #047857; } .sec-ttl.amber { color: #b45309; }
.kso-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); border: 1px solid #e4e8ef; border-radius: 4px; overflow: hidden; }
.kso-cell { display: flex; justify-content: space-between; gap: 10px; padding: 4px 9px; border-bottom: 1px solid #eef1f5; font-size: 9.5pt; }
.kso-cell .k { color: #64748b; } .kso-cell .v { font-weight: 600; }
.cprr-tbl { border: 1px solid #e4e8ef; border-radius: 4px; overflow: hidden; }
.cprr-row { display: flex; justify-content: space-between; padding: 5px 10px; border-bottom: 1px solid #eef1f5; font-size: 10pt; }
.cprr-row .cl { color: #475569; } .cprr-row .cv { font-weight: 700; font-variant-numeric: tabular-nums; }
.cprr-row.hi { background: #e0f7fb; border-top: 1px solid #0ca6bd; border-bottom: 1px solid #0ca6bd;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cprr-row.hi .cl, .cprr-row.hi .cv { font-weight: 800; font-size: 11pt; color: #0a7c8c; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { background: #f1f5f9; text-align: left; padding: 5px 8px; font-size: 7.5pt; letter-spacing: .8px; text-transform: uppercase;
  color: #475569; border-bottom: 1px solid #e4e8ef; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
td { padding: 4px 8px; border-bottom: 1px solid #eef1f5; }
td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
td.muted { color: #64748b; font-size: 8pt; }
tr { break-inside: avoid; }
.info-k { display: flex; gap: 10px; padding: 7px 10px; background: #f8fafc; border: 1px solid #e4e8ef; border-radius: 4px;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.info-k-lbl { font-size: 7.5pt; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #64748b; }
.info-k-val { font-size: 9.5pt; }
.catatan { font-size: 8pt; color: #64748b; margin-top: 5px; }
.footer { display: flex; justify-content: space-between; padding: 8px 16px; border-top: 1px solid #e4e8ef;
  font-size: 7.5pt; color: #64748b; }
`;

function buka(html: string) {
  const w = window.open("", "_blank");
  if (!w) {
    // Tanpa ini user cuma melihat "tidak terjadi apa-apa" saat popup diblokir.
    alert("Popup diblokir browser. Izinkan popup di address bar untuk mencetak PDF.");
    return;
  }
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 600);
}

const logoUrl = (): string =>
  typeof window === "undefined" ? "" : `${window.location.origin}/brand/wahana-lifeline-white.png`;

function kerangka(judul: string, subjudul: string, info: InfoKunjungan, isi: string, footer: string): string {
  const d = tanggalHariIni();
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<title>${esc(judul)}</title><style>${CSS}</style></head><body>
<div class="hdr">
  <div><div class="hdr-title">${esc(judul)}</div><div class="hdr-sub">${esc(subjudul)}</div></div>
  <div><img src="${logoUrl()}" alt="Wahana Lifeline"><div class="hdr-date">Tanggal: ${d}</div></div>
</div>
<div class="meta">
  <div class="meta-item"><span class="meta-lbl">Nama sales</span><span class="meta-val">${esc(info.salesName || "—")}</span></div>
  <div class="meta-item"><span class="meta-lbl">Nama faskes</span><span class="meta-val">${esc(info.faskesName || "—")}</span></div>
  <div class="meta-item"><span class="meta-lbl">Kota / kabupaten</span><span class="meta-val">${esc(info.kotaKab || "—")}</span></div>
</div>
<div class="body">${isi}
  <div class="info-k"><span class="info-k-lbl">Informasi kompetitor</span><span class="info-k-val">${esc(info.kompetitor || "—")}</span></div>
</div>
<div class="footer"><span>${esc(footer)}</span><span>Dokumen ini bersifat konfidensial</span></div>
</body></html>`;
}

const sec = (warna: "navy" | "green" | "amber", judul: string, isi: string): string =>
  `<div><div class="sec-hdr"><div class="sec-bar ${warna}"></div><span class="sec-ttl ${warna}">${esc(judul)}</span></div>${isi}</div>`;

const grid = (pairs: [string, string][]): string =>
  `<div class="kso-grid">${pairs
    .map(([k, v]) => `<div class="kso-cell"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`)
    .join("")}</div>`;

function pasanganRingkas(r: RingkasKso, satuan: string): [string, string][] {
  return [
    ["Nama analyzer", r.analyzerName],
    ...(r.backupLabel ? ([["Backup analyzer", r.backupLabel]] as [string, string][]) : []),
    ["Total CAPEX", Rp(r.totCap)],
    ...(r.capex.alat > 0 ? ([["  └ Harga alat", Rp(r.capex.alat)]] as [string, string][]) : []),
    ...(r.capex.backup > 0 ? ([["  └ Backup", Rp(r.capex.backup)]] as [string, string][]) : []),
    ...(r.capex.ups > 0 ? ([["  └ UPS", Rp(r.capex.ups)]] as [string, string][]) : []),
    ...(r.capex.lis > 0 ? ([["  └ LIS", Rp(r.capex.lis)]] as [string, string][]) : []),
    ["Masa KSO", `${r.kso} bulan`],
    [`${satuan} / bulan`, `${F(r.testsPerMonth)} ${satuan.toLowerCase()}`],
    ["Total target test KSO", `${F(r.totTest)} test`],
    ["Hari kerja / bulan", `${r.workDays} hari`],
    ["Margin / markup", `${r.markup}%`],
  ];
}

// ── Kontrol & kalibrator (input panel hematologi) ───────────────────────────
//
// Label di bagian ini SENGAJA tidak memakai frasa yang dicari OCR bot #KSO (kso_cprr.py _LABEL):
// "Kontrol & kalibrator" (= qc_status), "QC + kalibrasi / test" & "Kalibrasi / test" (= biaya per test).
// Angka per test tetap hanya di tabel CPRR; di sini dasar perhitungannya.

export interface KontrolPdf {
  free: boolean;
  nQc: number;
  nCal: number;
  ctrl: HargaInput;
  ctrlXr?: HargaInput;
  cal: HargaInput;
  /** EXZ8000: label kontrol Check-XN/XR & kalibrasi per 25 hari. */
  exz8000: boolean;
  /** Hari kerja / bulan (EXZ8000: 25 hari). */
  hariKerja: number;
  /** Hasil perhitungan panel (sama dengan baris CPRR). */
  overheadPerTest: number;
}

const hargaDiskon = (h: HargaInput | undefined): string => {
  if (!h || !(h.price > 0)) return "—";
  const d = Number(h.disc) || 0;
  if (d <= 0) return Rp(h.price);
  return `${Rp(h.price)} − ${d}% = ${Rp(h.price * (1 - d / 100))}`;
};

function secKontrol(k: KontrolPdf): string {
  const hari = k.exz8000 ? 25 : k.hariKerja;
  const pairs: [string, string][] = [
    ["Skema", k.free ? "Free — material ditanggung vendor" : "Beli — sesuai price list"],
    [k.exz8000 ? "Harga Check-XN control" : "Harga kontrol", hargaDiskon(k.ctrl)],
    ...(k.exz8000 && k.ctrlXr ? ([["Harga Check-XR control", hargaDiskon(k.ctrlXr)]] as [string, string][]) : []),
    ["Harga kalibrator", hargaDiskon(k.cal)],
    ...(k.free
      ? ([
          ["Run QC / hari", `${F(k.nQc)} run`],
          ["Run QC / bulan", `${F(k.nQc * hari)} run (${hari} hari)`],
          [k.exz8000 ? "Kalibrasi / 25 hari" : "Kalibrasi / bulan", `${F(k.nCal)} kali`],
          ["Overhead kontrol per test", Rp(k.overheadPerTest)],
        ] as [string, string][])
      : []),
  ];
  const catatan = k.free
    ? "Material kontrol ditanggung vendor, tetapi tiap run QC dan kalibrasi tetap menghabiskan reagen — itu yang masuk ke biaya per test."
    : "Kontrol dan kalibrator dibeli faskes sesuai price list — tidak dibebankan ke biaya per test.";
  return sec("navy", "Pengaturan QC & kalibrasi", `${grid(pairs)}<div class="catatan">${esc(catatan)}</div>`);
}

// ── Hematologi ──────────────────────────────────────────────────────────────

export function printHemato(arg: {
  ringkas: RingkasKso;
  info: InfoKunjungan;
  qcFree: boolean;
  capPerTest: number;
  reagenPerTest: number;
  overheadKontrol: number;
  sellPerTest: number;
  rows: BarisExcelHemato[];
  /** Input kontrol & kalibrator panel — opsional supaya pemanggil lama tetap jalan. */
  kontrol?: KontrolPdf;
}) {
  const { ringkas: r, info } = arg;
  const base = arg.capPerTest + arg.reagenPerTest + arg.overheadKontrol;

  const reagen = arg.rows
    .map(
      (x) => `<tr><td>${esc(x.nama)}</td><td class="muted">${esc(x.pack)}</td>
        <td class="r">${Rp(x.kontribusiTest)}</td>
        <td class="r">${x.hargaExcel > 0 ? Rp(x.hargaExcel) : "—"}</td></tr>`,
    )
    .join("");

  const supply = arg.rows.filter((x) => x.nettKit > 0);
  const supplyHtml =
    supply.length === 0
      ? ""
      : sec(
          "navy",
          "Supply chain forecast — kebutuhan reagen / bulan",
          `<table><thead><tr><th>Nama barang</th><th>Kemasan</th><th class="r">Kit/bulan</th><th class="r">Kit/tahun</th></tr></thead><tbody>${supply
            .map((x) => {
              const perBulan =
                r.testsPerMonth > 0
                  ? Number(((x.kontribusiTest * r.testsPerMonth) / x.nettKit).toFixed(2))
                  : 0;
              return `<tr><td>${esc(x.nama)}</td><td class="muted">${esc(x.pack)}</td>
                <td class="r">${perBulan > 0 ? perBulan : "—"}</td>
                <td class="r">${perBulan > 0 ? Number((perBulan * 12).toFixed(2)) : "—"}</td></tr>`;
            })
            .join("")}</tbody></table>`,
        );

  const isi = [
    sec("navy", "Ringkasan KSO", grid([
      ...pasanganRingkas(r, "Test"),
      ["QC & kalibrator", arg.qcFree ? "FREE — supplier" : "PAID — mandiri"],
    ])),
    sec("green", "CPRR — cost per test", `<div class="cprr-tbl">
      <div class="cprr-row"><span class="cl">CAPEX / test</span><span class="cv">${Rp(arg.capPerTest)}</span></div>
      <div class="cprr-row"><span class="cl">Reagen / test</span><span class="cv">${Rp(arg.reagenPerTest)}</span></div>
      ${arg.overheadKontrol > 0 ? `<div class="cprr-row"><span class="cl">QC + kalibrasi / test</span><span class="cv">${Rp(arg.overheadKontrol)}</span></div>` : ""}
      <div class="cprr-row"><span class="cl">Base cost / test</span><span class="cv">${Rp(base)}</span></div>
      <div class="cprr-row"><span class="cl">Markup ${r.markup}%</span><span class="cv">${Rp(arg.sellPerTest - base)}</span></div>
      <div class="cprr-row hi"><span class="cl">CPRR (harga jual / test)</span><span class="cv">${Rp(arg.sellPerTest)}</span></div>
    </div>`),
    arg.kontrol ? secKontrol(arg.kontrol) : "",
    sec("amber", "Rincian reagen", `<table><thead><tr><th>Nama barang</th><th>Kemasan</th>
      <th class="r">Kontribusi / test</th><th class="r">Harga KSO di Excel</th></tr></thead><tbody>${reagen}</tbody></table>`),
    supplyHtml,
  ].join("");

  buka(
    kerangka(
      "KSO CPRR — HEMATOLOGI",
      "Cost Per Result Report · Kerja Sama Operasional",
      info,
      isi,
      `Wahana Lifeline · KSO CPRR Hematologi · ${r.analyzerName}`,
    ),
  );
}

// ── Kimia Klinik ────────────────────────────────────────────────────────────

export function printKk(arg: {
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

  const param = arg.rows
    .map(
      (x, i) => `<tr><td class="r">${i + 1}</td><td>${esc(x.nama)}</td><td class="muted">${esc(x.panel)}</td>
        <td class="muted">${esc(x.pack)}</td>
        <td class="r">${x.testsPerKit ? `${F(x.testsPerKit)}T` : "—"}</td>
        <td class="r">${Rp(x.sellTest)}</td><td class="r">${Rp(x.sellKit)}</td></tr>`,
    )
    .join("");

  const beban = [
    ...arg.consumable.map((c) => `<div class="cprr-row"><span class="cl">${esc(c.nama)}</span><span class="cv">${Rp(c.perTest)}</span></div>`),
    `<div class="cprr-row"><span class="cl">Total consumable / test</span><span class="cv">${Rp(arg.consumablePerTest)}</span></div>`,
    `<div class="cprr-row"><span class="cl">+ CAPEX / test</span><span class="cv">${Rp(arg.capPerTest)}</span></div>`,
    ...(arg.adaOverhead
      ? [
          `<div class="cprr-row"><span class="cl">QC control / test</span><span class="cv">${Rp(arg.qcPerTest)}</span></div>`,
          `<div class="cprr-row"><span class="cl">Kalibrasi / test</span><span class="cv">${Rp(arg.calPerTest)}</span></div>`,
        ]
      : []),
    `<div class="cprr-row hi"><span class="cl">CPRR rata-rata (harga jual / test)</span><span class="cv">${Rp(arg.avgSellPerTest)}</span></div>`,
  ].join("");

  const isi = [
    sec("navy", "Ringkasan KSO", grid(pasanganRingkas(r, "Sampel"))),
    sec("green", "CPRR — beban tetap & rata-rata", `<div class="cprr-tbl">${beban}</div>`),
    sec(
      "amber",
      "Rincian parameter",
      `<table><thead><tr><th class="r">No</th><th>Parameter</th><th>Panel</th><th>Kemasan</th>
        <th class="r">Test/kit</th><th class="r">Sell / test</th><th class="r">Sell / kit</th></tr></thead>
        <tbody>${param}</tbody></table>`,
    ),
  ].join("");

  buka(
    kerangka(
      "KSO CPRR — KIMIA KLINIK",
      "Cost Per Result Report · Kerja Sama Operasional",
      info,
      isi,
      `Wahana Lifeline · KSO CPRR Kimia Klinik · ${r.analyzerName}`,
    ),
  );
}

// ── Dokumen generik (Crossmatch, CLIA, HPLC, Elektrolit, Blood Gas) ─────────
// Pasangan cetak dari exportDokumen — deskriptor yang sama, keluaran A4.

export function printDokumen(doc: DokumenKso) {
  const biaya = doc.biaya
    .map(
      (b) =>
        `<div class="cprr-row${b.sorot ? " hi" : ""}"><span class="cl">${esc(b.label)}</span><span class="cv">${Rp(b.value)}</span></div>`,
    )
    .join("");

  const tabel = `<table><thead><tr>${doc.tabel.header
    .map((h, i) => `<th${i > 0 ? ' class="r"' : ""}>${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${doc.tabel.rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${i > 0 ? ' class="r"' : ""}>${esc(String(c))}</td>`)
          .join("")}</tr>`,
    )
    .join("")}</tbody></table>`;

  const isi = [
    sec("navy", "Ringkasan KSO", grid([
      ...pasanganRingkas(doc.ringkas, doc.satuanTest ?? "Test"),
      ...(doc.catatan ?? []).map((c) => [c.label, c.value] as [string, string]),
    ])),
    sec("green", "CPRR — cost per test", `<div class="cprr-tbl">${biaya}</div>`),
    sec("amber", doc.tabel.judul, tabel),
  ].join("");

  buka(
    kerangka(
      doc.judul,
      "Cost Per Result Report · Kerja Sama Operasional",
      doc.info,
      isi,
      `Wahana Lifeline · ${doc.judul} · ${doc.ringkas.analyzerName}`,
    ),
  );
}
