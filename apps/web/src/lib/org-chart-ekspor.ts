import type { OrgChart } from "d3-org-chart";

// Resolusi unduhan (× ukuran asli bagan) — cukup tajam untuk di-zoom dan
// dicetak. Diturunkan otomatis bila kanvasnya melewati batas browser.
const SKALA_UNDUH = 3;
const SISI_KANVAS_MAKS = 16000;
const LUAS_KANVAS_MAKS = 150_000_000;
const TEPI_UNDUH = 40;

/** Potret bagan di UKURAN ASLINYA, bukan seukuran layar. `exportImg` bawaan
 *  library memotret <svg> setinggi TINGGI px lalu mengecilkan seluruh bagan
 *  agar muat — dengan puluhan karyawan hasilnya garis tipis tak terbaca.
 *  Di sini salinan <svg> diberi viewBox seluas bagan, dan semua `var(--x)`
 *  diganti nilai jadinya: gambar SVG dirender terpisah dari halaman, jadi
 *  token tema tak terbaca dan kotak/garisnya hilang. */
export async function potretBagan<Datum>(chart: OrgChart<Datum>): Promise<{ png: string; skala: number }> {
  const st = chart.getChartState();
  const lb = st.layoutBindings[st.layout];
  const simpul = st.root.descendants();
  const x0 = Math.min(...simpul.map((d) => (d.x ?? 0) + lb.nodeLeftX(d))) - TEPI_UNDUH;
  const x1 = Math.max(...simpul.map((d) => (d.x ?? 0) + lb.nodeRightX(d))) + TEPI_UNDUH;
  const y0 = Math.min(...simpul.map((d) => (d.y ?? 0) + lb.nodeTopY(d))) - TEPI_UNDUH;
  // + tinggi tombol buka/tutup yang menggantung di bawah kotak terbawah.
  const y1 = Math.max(...simpul.map((d) => (d.y ?? 0) + lb.nodeBottomY(d))) + TEPI_UNDUH + 24;
  const lebar = Math.ceil(x1 - x0);
  const tinggi = Math.ceil(y1 - y0);

  const asli = st.svg.node() as SVGSVGElement;
  const klon = asli.cloneNode(true) as SVGSVGElement;
  klon.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  klon.setAttribute("width", String(lebar));
  klon.setAttribute("height", String(tinggi));
  klon.setAttribute("viewBox", `0 0 ${lebar} ${tinggi}`);
  klon.removeAttribute("style");
  klon.querySelector("g.chart")?.setAttribute("transform", `translate(${-x0},${-y0})`);
  klon.querySelector("g.center-group")?.setAttribute("transform", "translate(0,0)");
  const gaya = getComputedStyle(document.documentElement);
  klon.setAttribute("style", `font-family:${getComputedStyle(document.body).fontFamily.replace(/"/g, "'")}`);

  const sumber = new XMLSerializer().serializeToString(klon)
    .replace(/var\((--[\w-]+)\)/g, (_, n: string) => gaya.getPropertyValue(n).trim() || "transparent");

  const img = new Image();
  await new Promise<void>((ok, gagal) => {
    img.onload = () => ok();
    img.onerror = () => gagal(new Error("bagan gagal dirender"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(sumber);
  });
  const skala = Math.min(
    SKALA_UNDUH,
    SISI_KANVAS_MAKS / Math.max(lebar, tinggi),
    Math.sqrt(LUAS_KANVAS_MAKS / (lebar * tinggi)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(lebar * skala);
  canvas.height = Math.floor(tinggi * skala);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = gaya.getPropertyValue("--background").trim() || "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { png: canvas.toDataURL("image/png"), skala };
}
