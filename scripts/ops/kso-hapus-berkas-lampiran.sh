#!/usr/bin/env bash
# F170 Komite KSO (migrasi 305) — bersih-bersih SEKALI JALAN: hapus PDF lampiran Simulator KSO yang SUDAH dibaca
# dan tandai di DB. Keputusan product owner 10 Nov 2026: PDF lampiran Simulator tidak disimpan di server, cukup
# dibaca (Tesseract) lalu ditandai sudah diunggah. Lampiran baru sudah dibereskan otomatis oleh API; skrip ini
# untuk PDF yang tersimpan SEBELUM 305 terpasang.
#
# Yang diambil: kso.rencana_lampiran dengan dibaca_at terisi (OCR ok, atau dokumen pasti tak terpakai — diisi
# migrasi 305 dari hasil_ocr) dan berkas_dihapus_at kosong. Lampiran gagal teknis (dibaca_at kosong) TIDAK disentuh.
#
# Pagar (sama dengan apps/api/src/repo/kso-lampiran-berkas.ts): ekstensi .pdf · bukan symlink · berkas biasa ·
# path asli (pwd -P) di dalam MEDIA_ROOT · sha256 isi = sha256 tercatat (bila ada). Berkas yang sudah tak ada
# → hanya ditandai. Penanda lewat kso.app_bot_tandai_berkas_dihapus (peran bot_wa, cek milik AM).
#
# Pakai (di Mac mini, user yang menjalankan API):
#   bash scripts/ops/kso-hapus-berkas-lampiran.sh              # DRY-RUN (bawaan): hanya daftar, tak menghapus apa pun
#   bash scripts/ops/kso-hapus-berkas-lampiran.sh --apply      # hapus + tandai
#   DB=wrg_os_dev MEDIA_ROOT=~/.openclaw/media bash scripts/ops/kso-hapus-berkas-lampiran.sh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

APPLY=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "argumen tak dikenal: $a (pakai --dry-run atau --apply)" >&2; exit 2 ;;
  esac
done
DB="${DB:-wrg_os_prod}"
MEDIA_ROOT="${MEDIA_ROOT:-$HOME/.openclaw/media}"
ROOT_REAL="$(cd "$MEDIA_ROOT" 2>/dev/null && pwd -P)" || { echo "MEDIA_ROOT tidak ada: $MEDIA_ROOT" >&2; exit 2; }
[ "$ROOT_REAL" = "/" ] && { echo "MEDIA_ROOT tidak boleh /" >&2; exit 2; }

echo "→ $([ $APPLY = 1 ] && echo APPLY || echo DRY-RUN) · DB=$DB · MEDIA_ROOT=$ROOT_REAL"

tandai() { # $1 = id lampiran, $2 = am_id
  psql -X -q -At -v ON_ERROR_STOP=1 -v lid="$1" -v am="$2" "postgres:///$DB" >/dev/null <<'SQL'
begin;
set local role wrg_app;
select set_config('wrg.kso_user', 'bot-wa', true);
select kso.app_bot_tandai_berkas_dihapus(:lid, :'am');
commit;
SQL
}

ROWS="$(psql -X -q -At -F $'\t' -v ON_ERROR_STOP=1 "postgres:///$DB" -c "
  select l.id, r.am_id, l.media_path, coalesce(l.sha256, '')
    from kso.rencana_lampiran l join kso.rencana_kso r on r.id = l.rencana_id
   where l.dibaca_at is not null and l.berkas_dihapus_at is null and l.media_path is not null
   order by l.id")"

n_hapus=0; n_hilang=0; n_tolak=0; n_gagal=0
while IFS=$'\t' read -r lid am path sha; do
  [ -n "${lid:-}" ] || continue
  ext="$(printf '%s' "${path##*.}" | tr '[:upper:]' '[:lower:]')"
  if [ "$ext" != "pdf" ]; then echo "  TOLAK  #$lid bukan .pdf: $path"; n_tolak=$((n_tolak+1)); continue; fi
  if [ -L "$path" ]; then echo "  TOLAK  #$lid symlink: $path"; n_tolak=$((n_tolak+1)); continue; fi
  if [ ! -e "$path" ]; then
    echo "  HILANG #$lid berkas sudah tak ada → tandai: $path"
    if [ $APPLY = 1 ]; then tandai "$lid" "$am" || { echo "  GAGAL  #$lid tandai" >&2; n_gagal=$((n_gagal+1)); continue; }; fi
    n_hilang=$((n_hilang+1)); continue
  fi
  if [ ! -f "$path" ]; then echo "  TOLAK  #$lid bukan berkas biasa: $path"; n_tolak=$((n_tolak+1)); continue; fi
  dir_real="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || { echo "  TOLAK  #$lid folder tak terbaca: $path"; n_tolak=$((n_tolak+1)); continue; }
  real="$dir_real/$(basename "$path")"
  case "$real" in
    "$ROOT_REAL"/*) ;;
    *) echo "  TOLAK  #$lid di luar MEDIA_ROOT: $real"; n_tolak=$((n_tolak+1)); continue ;;
  esac
  if [ -n "$sha" ]; then
    now="$(shasum -a 256 "$real" | cut -d' ' -f1)"
    if [ "$now" != "$sha" ]; then echo "  TOLAK  #$lid sha256 beda dari yang dibaca: $real"; n_tolak=$((n_tolak+1)); continue; fi
  fi
  if [ $APPLY = 1 ]; then
    rm -f -- "$real" || { echo "  GAGAL  #$lid hapus: $real" >&2; n_gagal=$((n_gagal+1)); continue; }
    tandai "$lid" "$am" || { echo "  GAGAL  #$lid terhapus tapi gagal ditandai" >&2; n_gagal=$((n_gagal+1)); continue; }
    echo "  HAPUS  #$lid $real"
  else
    echo "  AKAN DIHAPUS #$lid $real ($(du -h "$real" | cut -f1))"
  fi
  n_hapus=$((n_hapus+1))
done <<< "$ROWS"

echo "✓ $([ $APPLY = 1 ] && echo dihapus || echo 'akan dihapus'): $n_hapus · sudah tak ada (ditandai): $n_hilang · ditolak: $n_tolak · gagal: $n_gagal"
[ $APPLY = 1 ] || echo "  (dry-run — jalankan ulang dengan --apply untuk menghapus)"
[ $n_gagal = 0 ]
