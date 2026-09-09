#!/usr/bin/env bash
# Cabut akses seseorang (magang selesai, karyawan keluar) dari SEMUA permukaan
# identitas sekaligus — dan tunjukkan dulu apa yang akan dicabut sebelum
# mencabutnya.
#
#   bash scripts/ops/cabut-akses.sh "kefi"            # PERIKSA saja (default)
#   bash scripts/ops/cabut-akses.sh "kefi" --cabut    # jalankan pencabutan
#   PGDATABASE=wrg_os_dev bash scripts/ops/cabut-akses.sh "kefi" --cabut
#
# Kenapa perlu alat, bukan satu UPDATE: identitas yang memberi akses bot WA
# tersebar di EMPAT tabel yang saling independen, dan tiga di antaranya tidak
# lewat master_user sama sekali.
#
#   master_user       perintah umum (#CEK/#STOK/#PLAN/…) lewat resolveSender,
#                     4 tier: wa_number, pushname, body-name, alias
#   sender_alias      override (group_jid, pushname) -> am_id. Terikat GRUP.
#   teknisi_capacity  perintah F8 — matchTeknisiByName, SELF-CONTAINED,
#                     tak menyentuh master_user
#   app_user          #APPROVE/#REJECT lewat resolveApprover + login dashboard
#
# Mencabut satu tabel saja meninggalkan pintu yang lain terbuka.
#
# ⚠️ ASIMETRI YANG MENENTUKAN CARA MENCABUT
#   app_user       -> resolveApprover menyaring `active = true`   ✅
#   teknisi_capacity -> matchTeknisiByName menyaring `aktif = TRUE` ✅
#   master_user    -> resolveSender TIDAK menyaring `aktif`        ❌ (di prod)
#
# Gerbang `aktif` untuk master_user baru mendarat di `dev` (PR #1256). Selama
# prod masih menjalankan `main` tanpa itu, MEMBALIK aktif=false TIDAK
# memutus akses bot. Karena itu skrip ini juga mengosongkan wa_number dan
# menghapus baris sender_alias — dan melaporkan sisa lubangnya (tier pushname,
# yang mencocokkan nama) supaya tidak dikira sudah tertutup.

set -euo pipefail

CARI="${1:-}"
MODE="${2:---periksa}"
DB="${PGDATABASE:-wrg_os_prod}"

merah()  { printf '\033[31m%s\033[0m\n' "$*"; }
hijau()  { printf '\033[32m%s\033[0m\n' "$*"; }
kuning() { printf '\033[33m%s\033[0m\n' "$*"; }

[ -n "$CARI" ] || { merah "Pakai: bash $0 \"<nama|email|nomor|am_id>\" [--cabut]"; exit 2; }
command -v psql >/dev/null || { merah "psql tak ada."; exit 2; }

# Nomor dinormalisasi seperti normalizeWa() di master.ts: buang non-digit,
# 0… -> 62…. Tanpa ini, "+62 821-…" tak akan cocok dengan "6282143…" di DB.
NORM="$(printf '%s' "$CARI" | tr -cd '0-9')"
[ -n "$NORM" ] && case "$NORM" in 0*) NORM="62${NORM#0}";; esac

echo "DB     : $DB"
echo "Cari   : \"$CARI\"${NORM:+  (nomor ternormalisasi: $NORM)}"
echo "Mode   : $([ "$MODE" = "--cabut" ] && echo "CABUT" || echo "periksa saja")"
echo

TEMU=0
lapor() { # $1=judul  $2=sql
  local out; out="$(psql -d "$DB" -tA -F'|' -c "$2" 2>/dev/null || true)"
  printf '── %s\n' "$1"
  if [ -z "$out" ]; then echo "   (tak ada)"; else echo "$out" | sed 's/^/   /'; TEMU=1; fi
}

Q_LIKE="'%$(printf '%s' "$CARI" | sed "s/'/''/g")%'"
Q_NORM="'${NORM:-__tidak_ada__}'"

lapor "master_user — perintah umum WA" "
  SELECT am_id, nama, panggilan, role, aktif, COALESCE(wa_number,'(kosong)')
  FROM master_user
  WHERE nama ILIKE $Q_LIKE OR panggilan ILIKE $Q_LIKE OR am_id ILIKE $Q_LIKE
     OR regexp_replace(COALESCE(wa_number,''),'[^0-9]','','g') = $Q_NORM;"

lapor "sender_alias — override per-grup" "
  SELECT sa.id, sa.group_jid, sa.pushname, sa.am_id, COALESCE(sa.note,'')
  FROM sender_alias sa LEFT JOIN master_user mu ON mu.am_id = sa.am_id
  WHERE sa.pushname ILIKE $Q_LIKE OR sa.am_id ILIKE $Q_LIKE OR mu.nama ILIKE $Q_LIKE;"

lapor "teknisi_capacity — perintah F8 (jalur terpisah)" "
  SELECT id, nama, COALESCE(wa_number,'(kosong)'), aktif
  FROM teknisi_capacity
  WHERE nama ILIKE $Q_LIKE
     OR regexp_replace(COALESCE(wa_number,''),'[^0-9]','','g') = $Q_NORM;"

lapor "app_user — #APPROVE + login dashboard" "
  SELECT id, email, name, role, active, COALESCE(wa_number,'(kosong)')
  FROM app_user
  WHERE name ILIKE $Q_LIKE OR email ILIKE $Q_LIKE
     OR regexp_replace(COALESCE(wa_number,''),'[^0-9]','','g') = $Q_NORM;"

echo
[ "$TEMU" = "1" ] || { hijau "Tak ada identitas cocok — tidak ada yang perlu dicabut."; exit 0; }

if [ "$MODE" != "--cabut" ]; then
  kuning "Mode periksa. Jalankan ulang dengan --cabut untuk mencabut yang di atas."
  exit 0
fi

echo "Mencabut…"
psql -d "$DB" -v ON_ERROR_STOP=1 <<SQL
BEGIN;

-- master_user: aktif=false SEKALIGUS kosongkan wa_number.
-- aktif=false saja tidak cukup selama gerbang #1256 belum sampai ke prod;
-- wa_number kosong mematikan tier phone apa pun versinya.
UPDATE master_user SET aktif = false, wa_number = NULL
WHERE nama ILIKE $Q_LIKE OR panggilan ILIKE $Q_LIKE OR am_id ILIKE $Q_LIKE
   OR regexp_replace(COALESCE(wa_number,''),'[^0-9]','','g') = $Q_NORM;

-- sender_alias: DIHAPUS, bukan dinonaktifkan — tabel ini tak punya flag aktif,
-- dan barisnya memang override manual yang tak punya nilai historis.
DELETE FROM sender_alias sa
USING master_user mu
WHERE sa.am_id = mu.am_id
  AND (sa.pushname ILIKE $Q_LIKE OR sa.am_id ILIKE $Q_LIKE OR mu.nama ILIKE $Q_LIKE);
DELETE FROM sender_alias WHERE pushname ILIKE $Q_LIKE OR am_id ILIKE $Q_LIKE;

-- teknisi_capacity & app_user: cukup flag — dua jalur ini MEMANG menyaringnya.
UPDATE teknisi_capacity SET aktif = false
WHERE nama ILIKE $Q_LIKE
   OR regexp_replace(COALESCE(wa_number,''),'[^0-9]','','g') = $Q_NORM;

UPDATE app_user SET active = false
WHERE name ILIKE $Q_LIKE OR email ILIKE $Q_LIKE
   OR regexp_replace(COALESCE(wa_number,''),'[^0-9]','','g') = $Q_NORM;

COMMIT;
SQL

echo
hijau "✓ Dicabut di keempat permukaan."
echo
kuning "SISA YANG TIDAK BISA DITUTUP SKRIP INI — periksa satu per satu:"
echo "  1. Tier pushname/body-name di master_user mencocokkan NAMA, bukan nomor."
echo "     Selama prod belum memuat gerbang aktif (#1256, kini di dev), orang"
echo "     yang pushname WhatsApp-nya sama dengan nama di master_user MASIH bisa"
echo "     dikenali. Penutupnya: promosikan #1256 ke main, ATAU ubah namanya"
echo "     (mis. beri awalan '[EX] ') supaya tak lagi cocok."
echo "  2. Akses GitHub — collaborator repo & Projects board. Di luar DB:"
echo "       gh api -X DELETE repos/DevWRG/wrg-os/collaborators/<username>"
echo "  3. Kredensial bersama yang pernah dilihat orang itu (token, .env)."
echo "     Kalau pernah terpapar, rotasi — mencabut baris DB tidak membatalkannya."
echo
echo "Verifikasi ulang: bash $0 \"$CARI\""
