## Kartu

<!--
WAJIB: satu baris di bawah, di badan PR — bukan di judul, bukan di komentar ini.
Cek "PR punya kartu" akan menolak PR tanpa salah satunya.

Contoh (jangan disalin apa adanya — ganti nomor/alasannya):

    Closes #123        menutup issue itu saat PR di-merge
    Refs #123          terkait, tapi belum menuntaskannya
    No-Card: <alasan>  memang tak ada kartunya (bug-fix fitur live, chore, CI)

Alasan pada No-Card WAJIB diisi — "No-Card:" kosong tetap ditolak.

Kenapa jalan keluar ini ada: syarat tanpa jalan keluar akan dijawab dengan
"Closes #1" asal lolos, dan itu lebih buruk daripada tak ada cek sama sekali.
-->


## Ringkasan

<!-- Apa yang berubah, dan KENAPA. Kalau ini bug-fix, sebutkan gejalanya —
     bukan cuma nama fungsi yang disentuh. -->


## Perubahan

<!-- Daftar singkat per titik. Kalau ada keputusan yang bisa dibantah,
     tulis alasannya di sini atau di komentar kode — jangan biarkan
     pembaca berikutnya menebak. -->


## Test plan

<!-- Yang benar-benar dijalankan, bukan yang direncanakan. Sebutkan
     angkanya (mis. "test 153/153"). Kalau ada yang BELUM diuji, tulis
     eksplisit — itu lebih berguna daripada daftar centang yang rapi. -->

- [ ] `pnpm --filter @wrg/api typecheck`
- [ ] `pnpm --filter @wrg/api lint`
- [ ] `pnpm --filter @wrg/api test`

<!-- Kalau menyentuh migrasi: sebutkan nomornya dan pastikan
     `node scripts/db/check-migration-numbers.mjs` hijau TERHADAP dev
     TERBARU. CI pada PR ber-base basi bisa hijau padahal bentrok. -->
