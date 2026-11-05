// Uji F156 Arsip Dokumen (#2027, migrasi 277) — MANUAL, butuh DB dev. Bukan bagian CI.
//
//   DATABASE_URL="postgres:///wrg_os_dev" npx tsx scripts/qa/uji-arsip-dokumen.ts
//
// Google Drive DIPALSUKAN (fetch di-stub) — tidak ada berkas yang benar-benar diunggah.
// Menolak jalan bila DATABASE_URL menyebut prod. Fixture: kode buku `UJI277` & `UJIOFF` —
// baris dokumen + bukunya dihapus di akhir.
//
// Yang dibuktikan:
//   1. Nomor BUKU/TAHUN/BULAN/URUT berurutan per buku-bulan; bulan lain mulai 0001 lagi.
//   2. 6 unggahan serentak di buku-bulan yang sama → nomor unik tanpa lompat.
//   3. Hapus = soft delete; nomornya tidak dipakai ulang.
//   4. Buku nonaktif / tak dikenal ditolak; tanggal masa depan ditolak; berkas bukan PDF/JPG/PNG ditolak.
//   5. Drive gagal → tidak ada baris tersimpan; simpan DB gagal sesudah unggah → berkas Drive dibuang ke sampah.
//   6. Telusur: by SN tanpa beda huruf, by faktur, by nomor, filter buku+bulan; % ketikan bukan wildcard.
//   7. Unduh mengembalikan isi dari Drive; ubah metadata tidak mengubah nomor.
//   8. Berkas diunggah TANPA izin publik (tak ada panggilan permissions).

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { db } from "../../apps/api/src/db.js";
import * as A from "../../apps/api/src/repo/arsip-dokumen.js";

if (/prod/i.test(process.env.DATABASE_URL ?? "")) {
  console.error("DATABASE_URL menyebut prod — uji ini hanya untuk DB dev.");
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), "uji277-"));
writeFileSync(join(dir, "oauth.json"), JSON.stringify({ client_id: "x", client_secret: "y", refresh_token: "z" }));
process.env.GDRIVE_OAUTH_FILE = join(dir, "oauth.json");
process.env.GDRIVE_ARSIP_FOLDER_ID = "folder-uji277";

// ── Drive palsu ──
const drive = new Map<string, Buffer>();
const sampah: string[] = [];
const panggilan: string[] = [];
let gagalUnggah = false;
let n = 0;
const asli = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const m = init?.method ?? "GET";
  panggilan.push(`${m} ${url.split("?")[0]}`);
  if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
  if (url.includes("uploadType=resumable")) {
    if (gagalUnggah) return Response.json({ error: { message: "kuota habis (palsu)" } }, { status: 403 });
    const meta = JSON.parse(String(init?.body)) as { parents: string[] };
    if (meta.parents[0] !== "folder-uji277") throw new Error("folder salah");
    return new Response(null, { status: 200, headers: { location: `https://upload.palsu/sesi/${++n}` } });
  }
  if (url.startsWith("https://upload.palsu/sesi/")) {
    const id = `drv-${url.split("/").pop()}`;
    drive.set(id, Buffer.from(init!.body as Uint8Array));
    return Response.json({ id });
  }
  const f = url.match(/drive\/v3\/files\/([^/?]+)\?alt=media/);
  if (f) { const b = drive.get(decodeURIComponent(f[1])); return b ? new Response(new Uint8Array(b)) : Response.json({ error: { message: "nf" } }, { status: 404 }); }
  const t = url.match(/drive\/v3\/files\/([^/?]+)\?supportsAllDrives=true$/);
  if (t && m === "PATCH") { sampah.push(decodeURIComponent(t[1])); return Response.json({}); }
  return asli(input, init);
}) as typeof fetch;

const sql = db();
let lolos = 0, gagal = 0;
const cek = (nama: string, ok: boolean, info?: unknown) => {
  if (ok) { lolos++; console.log(`  ✔ ${nama}`); } else { gagal++; console.log(`  ✖ ${nama}`, info ?? ""); }
};
const tolak = async (nama: string, f: () => Promise<unknown>, pola: RegExp) => {
  try { await f(); cek(nama, false, "tidak ditolak"); } catch (e) { cek(nama, pola.test((e as Error).message), (e as Error).message); }
};
const PDF = (isi: string) => ({ nama: "scan.pdf", buf: new Uint8Array(Buffer.from(`%PDF-1.4 ${isi}`)) });
const unggah = (o: Record<string, unknown>, f = PDF("x")) =>
  A.unggahArsip({ buku_kode: "UJI277", tanggal_dokumen: "2026-10-15", judul: "Dok uji", ...o }, f, "Penguji 277");

async function bersih() {
  await sql`DELETE FROM arsip_dokumen WHERE buku_kode IN ('UJI277', 'UJIOFF')`;
  await sql`DELETE FROM arsip_buku WHERE kode IN ('UJI277', 'UJIOFF')`;
}

async function main() {
  try {
    await bersih();
    await A.simpanBuku({ kode: "uji277", nama: "Buku Uji 277" }, "Penguji 277");
    await A.simpanBuku({ kode: "UJIOFF", nama: "Buku nonaktif", aktif: false }, "Penguji 277");

    console.log("1. Nomor berurutan per buku-bulan");
    const d1 = await unggah({ ref_sn: "SN-AbC-777", akun: "BCA 123" });
    const d2 = await unggah({ ref_faktur: "PJK/2190-2610-LMG" });
    const d3 = await unggah({ tanggal_dokumen: "2026-11-01", judul: "50% diskon" });
    cek("dokumen pertama Okt = UJI277/2026/10/0001", d1.nomor === "UJI277/2026/10/0001", d1.nomor);
    cek("dokumen kedua Okt = 0002", d2.nomor === "UJI277/2026/10/0002", d2.nomor);
    cek("bulan lain mulai 0001", d3.nomor === "UJI277/2026/11/0001", d3.nomor);
    cek("nama Drive diawali nomor bertitik", [...drive.keys()].length === 3);

    console.log("2. Unggahan serentak");
    const par = await Promise.all(Array.from({ length: 6 }, (_, i) => unggah({ judul: `serentak ${i}` })));
    const urut = par.map((x) => Number(x.nomor.split("/").pop())).sort((a, b) => a - b);
    cek("6 nomor unik 0003–0008 tanpa lompat", JSON.stringify(urut) === JSON.stringify([3, 4, 5, 6, 7, 8]), urut);

    console.log("3. Hapus tidak membebaskan nomor");
    const h = await A.hapusArsip(String(par.find((x) => x.nomor.endsWith("0008"))!.id), "Penguji 277");
    cek("hapus mengembalikan nomor", h.nomor === "UJI277/2026/10/0008");
    const d9 = await unggah({});
    cek("dokumen berikut = 0009, bukan 0008", d9.nomor === "UJI277/2026/10/0009", d9.nomor);
    await tolak("hapus dua kali → 404", () => A.hapusArsip(String(par.find((x) => x.nomor.endsWith("0008"))!.id), null), /tidak ditemukan/);

    console.log("4. Validasi");
    await tolak("buku nonaktif ditolak", () => unggah({ buku_kode: "UJIOFF" }), /nonaktif/);
    await tolak("buku tak dikenal ditolak", () => unggah({ buku_kode: "ZZZ999" }), /tidak dikenal/);
    await tolak("tanggal masa depan ditolak", () => unggah({ tanggal_dokumen: "2099-01-01" }), /tanggal dokumen/);
    await tolak("berkas exe berlabel pdf ditolak", () => unggah({}, { nama: "x.pdf", buf: new Uint8Array([0x4d, 0x5a, 1, 2, 3, 4]) }), /PDF, JPG/);
    await tolak("judul kosong ditolak", () => unggah({ judul: "  " }), /judul/);

    console.log("5. Kegagalan Drive / DB");
    const sebelum = (await sql`SELECT count(*)::int AS n FROM arsip_dokumen WHERE buku_kode = 'UJI277'`)[0].n;
    gagalUnggah = true;
    await tolak("Drive menolak → galat diteruskan", () => unggah({}), /kuota habis/);
    gagalUnggah = false;
    const sesudah = (await sql`SELECT count(*)::int AS n FROM arsip_dokumen WHERE buku_kode = 'UJI277'`)[0].n;
    cek("tidak ada baris tersimpan saat Drive gagal", sebelum === sesudah, { sebelum, sesudah });
    await tolak("INSERT gagal sesudah unggah Drive → galat diteruskan", async () => {
      // Paksa INSERT gagal SESUDAH unggah lewat trigger sementara.
      await sql`CREATE OR REPLACE FUNCTION uji277_tolak() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'uji277: insert ditolak'; END $$`;
      await sql`CREATE TRIGGER uji277_tolak BEFORE INSERT ON arsip_dokumen FOR EACH ROW WHEN (NEW.buku_kode = 'UJI277') EXECUTE FUNCTION uji277_tolak()`;
      try { await unggah({}); } finally { await sql`DROP TRIGGER IF EXISTS uji277_tolak ON arsip_dokumen`; await sql`DROP FUNCTION IF EXISTS uji277_tolak()`; }
    }, /insert ditolak/);
    cek("berkas Drive yatim dibuang ke sampah", sampah.length === 1, sampah);
    const d10 = await unggah({});
    cek("nomor tidak bolong sesudah gagal (0010)", d10.nomor === "UJI277/2026/10/0010", d10.nomor);

    console.log("6. Telusur");
    const cari = async (f: Record<string, unknown>) => (await A.listArsip({ buku: "UJI277", ...f })).items.map((x) => x.nomor);
    cek("SN tanpa beda huruf", JSON.stringify(await cari({ q: "sn-abc" })) === JSON.stringify([d1.nomor]));
    cek("by faktur", JSON.stringify(await cari({ q: "2190-2610" })) === JSON.stringify([d2.nomor]));
    cek("by nomor", (await cari({ q: "2026/11/0001" }))[0] === d3.nomor);
    cek("% ketikan bukan wildcard", JSON.stringify(await cari({ q: "50%" })) === JSON.stringify([d3.nomor]));
    const okt = await A.listArsip({ buku: "UJI277", periode: "2026-10", limit: 3 });
    cek("filter bulan + total_rows server (Okt: 9 tampil, 1 terhapus tak dihitung)", okt.total_rows === 9 && okt.count === 3, okt.total_rows);
    cek("dokumen terhapus tak ikut telusur", !(await cari({ q: "0008" })).length);

    console.log("7. Unduh & ubah");
    const b = await A.bacaBerkasArsip(String(d1.id));
    cek("isi unduhan = isi unggahan", b.buf.toString().startsWith("%PDF-1.4"), b.buf.toString().slice(0, 10));
    cek("nama unduhan diawali nomor", b.nama.startsWith("UJI277.2026.10.0001 - "), b.nama);
    const u = await A.ubahArsip(String(d1.id), { judul: "Judul baru", ref_sn: "SN-XYZ" }, "Penguji lain");
    cek("ubah metadata: nomor tetap, judul & SN berubah, akun dikosongkan", u.nomor === d1.nomor && u.judul === "Judul baru" && u.ref_sn === "SN-XYZ" && u.akun === null && u.diubah_oleh === "Penguji lain");

    console.log("8. Privasi");
    cek("tidak ada panggilan izin publik ke Drive", !panggilan.some((p) => p.includes("/permissions")));
    const bk = (await A.listBuku()).find((x) => x.kode === "UJI277");
    cek("kode buku dinormalkan huruf besar + hitungan dipakai", bk?.dipakai === 10, bk);
  } finally {
    await bersih();
    await sql.end();
  }
  console.log(`\n${lolos} lolos, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
}

void main();
