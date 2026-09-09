// Kebijakan flag `Secure` pada cookie sesi (`wrg_session`).
//
// MASALAH YANG DIPECAHKAN. Dulu login route menulis
// `secure: process.env.NODE_ENV === "production"` langsung. Tumpukan dev di
// server memakai `NODE_ENV=production` — wajib, karena `next start`
// menjalankan build produksi — sehingga cookie sesinya ber-flag `Secure`.
// Browser MEMBUANG cookie `Secure` pada koneksi `http://` biasa, dan dashboard
// dev diakses lewat `http://<tailscale-ip>:3300` tanpa TLS.
//
// Akibatnya kegagalan yang mustahil didiagnosis dari layar: login BERHASIL di
// server (200, token terbit), cookie dibuang browser, middleware tak melihat
// sesi, pengguna dikembalikan ke /login. Tanpa pesan error apa pun — tombol
// Login tampak "tidak merespons".
//
// ATURANNYA, dan kenapa opt-out-nya dijaga:
//
//   1. `COOKIE_SECURE=true`  → selalu Secure. Jalan keluar kalau dev dilayani
//      lewat TLS/proxy dan ingin seketat prod.
//   2. Bukan produksi        → tidak Secure (perilaku lama, tak berubah).
//   3. Produksi tanpa flag   → Secure. Ini defaultnya; lupa mengisi env TIDAK
//      pernah melemahkan prod.
//   4. `COOKIE_SECURE=false` di produksi → hanya dihormati kalau `DATABASE_URL`
//      jelas-jelas database dev/demo. Kalau tidak, opt-out DIABAIKAN dan
//      alasannya dicetak.
//
// Butir 4 itu inti keamanannya. Flag bernama `COOKIE_SECURE=false` gampang
// tersalin ke `.env.prod` saat orang menyalin konfigurasi dev — dan kalau
// dihormati di sana, cookie sesi produksi jadi bisa dibaca lewat HTTP biasa.
// Penjaga ini memakai pola yang sama dengan penjaga tumpukan dev di
// ecosystem.config.cjs: yang menentukan bukan niat penulis env, tapi database
// yang benar-benar ditunjuk.

const DB_DEV = /_(dev|demo)(\?|$)/;

export function cookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.COOKIE_SECURE === "true") return true;
  if (env.NODE_ENV !== "production") return false;
  if (env.COOKIE_SECURE !== "false") return true;

  if (DB_DEV.test(env.DATABASE_URL ?? "")) return false;

  console.warn(
    "[auth] COOKIE_SECURE=false DIABAIKAN — DATABASE_URL bukan database _dev/_demo, " +
      "jadi ini diperlakukan sebagai produksi dan cookie sesi tetap Secure. " +
      "Kalau ini memang tumpukan dev, periksa DATABASE_URL-nya.",
  );
  return true;
}
