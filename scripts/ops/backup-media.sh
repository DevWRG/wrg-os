#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# backup-media.sh — cadangan BERKAS produksi (media WA + unggahan aplikasi), terenkripsi,
# ke Google Drive. Pasangan backup-harian.sh (yang hanya mencadangkan database).
#
# Latar (12 Nov 2026): backup-harian.sh hanya pg_dump. Berkas di disk Mac mini TAK
# tercadang sama sekali — terutama ~/.openclaw/media/inbound (foto kunjungan, BAST,
# bukti kirim, PDF dari WA; ±8 GB, ±50 MB/hari) yang dirujuk DB lewat path. Disk rusak =
# bukti lapangan hilang walau DB-nya selamat.
#
# Sumber (yang ada saja):
#   ${MEDIA_ROOT:-~/.openclaw/media}/inbound   media masuk WA (outbound/transcode = turunan, dilewati)
#   ~/.wrg-os/uploads                           GA, kontrak KSO, bukti pembayaran (F32), Proyek HD, dst.
#   ~/.wrg-os/approval-uploads                  lampiran approval
#
# Pola BERTAMBAH: run pertama (atau --penuh) = semua berkas; run berikutnya = berkas yang
# mtime-nya lebih baru dari penanda run sukses terakhir. Penanda baru dipasang HANYA bila
# seluruh langkah sukses, jadi run gagal diulang utuh besok. Arsip tak pernah dihapus dari
# Drive (berkas media tak berubah; memulihkan = arsip penuh + semua arsip tambahan sesudahnya).
#
# Alur: daftar berkas → cek ruang disk & kuota Drive → tar | openssl AES-256 (kunci SAMA
# dengan backup-harian, ~/.wrg-os/secrets/backup-key) | split 1900 MB → uji: gabung+dekripsi+
# tar -t, jumlah entri harus sama → unggah tiap potongan ke folder Drive "WRG-OS Cadangan
# Media" → pasang penanda → hapus potongan lokal. Gagal di mana pun → WA (pola backup-harian).
#
# Dipanggil LaunchAgent tiap 02:30 (infra/launchd/com.wrg.backup-media.plist).
# Manual:  bash scripts/ops/backup-media.sh [--penuh] [--tanpa-unggah] [--kering]
#   --kering       hanya hitung berkas & ukuran, tak membuat arsip
#   --tanpa-unggah buat + uji arsip lokal, tak unggah, penanda TIDAK dipasang
# Memulihkan (urut dari arsip penuh lalu tiap arsip tambahan sesudahnya):
#   cat media-<stempel>-<jenis>.tar.enc.part-* \
#     | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:$HOME/.wrg-os/secrets/backup-key \
#     | tar -C "$HOME" -xf -
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

DIR="${WRG_PROD_DIR:-$HOME/DevWRG/wrg-os}"
OPS="$HOME/DevWRG/ops"
LOKAL="$OPS/backup-media"
LOG="$OPS/backup-media.log"
KUNCI="${BACKUP_KEY_FILE:-$HOME/.wrg-os/secrets/backup-key}"
PENANDA="$LOKAL/penanda-terakhir"
KUNCI_JALAN="$LOKAL/.sedang-jalan"
NAMA_FOLDER="WRG-OS Cadangan Media"
POTONG="1900m"
SIMPAN_DAFTAR_HARI=60

PENUH=""; UNGGAH=1; KERING=""
for a in "$@"; do
  case "$a" in
    --penuh) PENUH=1 ;;
    --tanpa-unggah) UNGGAH="" ;;
    --kering) KERING=1 ;;
  esac
done

mkdir -p "$LOKAL"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }
prod_env() { grep -E "^$1=" "$DIR/.env.prod" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'; }

wa_send() {
  local to url sec
  to="$(prod_env DISK_ALERT_TO)"; [ -z "$to" ] && to="$(prod_env WRG_DEPLOY_ALERT_TO)"
  url="$(prod_env WA_SEND_URL)"; sec="$(prod_env WA_SEND_SECRET)"
  [ -n "$url" ] && [ -n "$to" ] || { log "WA dilewati — tujuan/URL kosong"; return 1; }
  WA_URL="$url" WA_SEC="$sec" WA_TO="$to" WA_MSG="$1" python3 - >>"$LOG" 2>&1 <<'PY'
import os, json, sys, urllib.request
h = {"content-type": "application/json"}
if os.environ.get("WA_SEC"): h["x-wa-secret"] = os.environ["WA_SEC"]
req = urllib.request.Request(os.environ["WA_URL"], headers=h,
    data=json.dumps({"to": os.environ["WA_TO"], "message": os.environ["WA_MSG"]}).encode())
try:
    with urllib.request.urlopen(req, timeout=15) as r: print(f"WA HTTP {r.status}")
except Exception as e:
    print(f"WA gagal: {e}"); sys.exit(1)
PY
}

STEMPEL="$(date +%Y%m%d-%H%M)"
BERSIHKAN=()
selesai() { rm -rf "$KUNCI_JALAN"; for f in "${BERSIHKAN[@]:-}"; do [ -n "$f" ] && rm -f "$f"* ; done; }
trap selesai EXIT

gagal() {
  log "GAGAL: $1"
  wa_send "🔴 *Cadangan berkas (media WA & unggahan) GAGAL* — $(date '+%d/%m %H:%M')
$1
Berkas produksi belum tercadang malam ini; run berikutnya mengulang dari penanda terakhir. Log: ~/DevWRG/ops/backup-media.log"
  exit 1
}

# Satu run saja (LaunchAgent + manual bisa bertabrakan; arsip penuh pertama bisa berjam-jam).
mkdir "$KUNCI_JALAN" 2>/dev/null || { log "run lain masih berjalan ($KUNCI_JALAN) — keluar"; trap - EXIT; exit 0; }

[ -s "$KUNCI" ] || gagal "kunci enkripsi tak ada di $KUNCI (sama dengan backup-harian; lihat kepala backup-harian.sh)"

# ── 1. Daftar berkas ──
MEDIA="$(prod_env MEDIA_ROOT)"; MEDIA="${MEDIA:-$HOME/.openclaw/media}"
SUMBER=()
for d in "$MEDIA/inbound" "$HOME/.wrg-os/uploads" "$HOME/.wrg-os/approval-uploads"; do
  [ -d "$d" ] || continue
  case "$d" in "$HOME"/*) SUMBER+=("${d#"$HOME"/}") ;; *) log "lewati $d (di luar \$HOME, tak bisa dipulihkan relatif)";; esac
done
[ ${#SUMBER[@]} -gt 0 ] || gagal "tak satu pun folder sumber ditemukan"

JENIS="tambahan"
[ -n "$PENUH" ] || [ ! -f "$PENANDA" ] && JENIS="penuh"
MULAI="$LOKAL/.penanda-mulai"
touch "$MULAI"   # dipasang SEBELUM daftar dibuat: berkas yang tiba selama run ikut run berikutnya
DAFTAR="$LOKAL/daftar-$STEMPEL-$JENIS.txt"
if [ "$JENIS" = "penuh" ]; then
  (cd "$HOME" && find "${SUMBER[@]}" -type f ! -name '.DS_Store' -print) > "$DAFTAR"
else
  (cd "$HOME" && find "${SUMBER[@]}" -type f ! -name '.DS_Store' -newer "$PENANDA" -print) > "$DAFTAR"
fi
N=$(wc -l < "$DAFTAR" | tr -d ' ')
BYTE=$( (cd "$HOME" && tr '\n' '\0' < "$DAFTAR" | xargs -0 stat -f %z 2>/dev/null) | awk '{s+=$1} END {print s+0}')
log "mulai ($JENIS): $N berkas, $((BYTE / 1048576)) MB dari ${SUMBER[*]}"

if [ -n "$KERING" ]; then log "--kering: berhenti di sini"; rm -f "$MULAI" "$DAFTAR"; exit 0; fi
if [ "$N" -eq 0 ]; then
  [ -n "$UNGGAH" ] && mv -f "$MULAI" "$PENANDA"
  log "tak ada berkas baru — SELESAI"; exit 0
fi

# ── 2. Ruang disk & kuota Drive ──
BEBAS=$(df -k "$LOKAL" | awk 'NR==2 {print $4 * 1024}')
[ "$BEBAS" -gt $((BYTE + BYTE / 5 + 5 * 1073741824)) ] || gagal "ruang disk lokal tak cukup untuk arsip $((BYTE / 1048576)) MB (bebas $((BEBAS / 1048576)) MB)"
if [ -n "$UNGGAH" ]; then
  export GDRIVE_OAUTH_FILE="${GDRIVE_OAUTH_FILE:-$(prod_env GDRIVE_OAUTH_FILE)}"
  unset GDRIVE_BACKUP_FOLDER_ID   # itu folder cadangan DATABASE; media punya folder sendiri
  FOLDER_ARG=(--nama-folder "$NAMA_FOLDER")
  MF="$(prod_env GDRIVE_MEDIA_FOLDER_ID)"; [ -n "$MF" ] && FOLDER_ARG=(--folder "$MF")
  Q=$(node "$DIR/scripts/ops/gdrive-unggah.mjs" kuota 2>>"$LOG") || gagal "cek kuota Drive gagal: $Q"
  read -r LIMIT PAKAI < <(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get("limit") or 0, d.get("usage") or 0)' "$Q")
  if [ "${LIMIT:-0}" -gt 0 ]; then
    SISA=$((LIMIT - PAKAI))
    [ "$SISA" -gt $((BYTE + BYTE / 10)) ] || gagal "kuota Drive tak cukup: sisa $((SISA / 1048576)) MB, arsip $((BYTE / 1048576)) MB"
    log "kuota Drive: terpakai $((PAKAI / 1073741824)) GB dari $((LIMIT / 1073741824)) GB"
  else
    log "kuota Drive: tak terbatas / tak dilaporkan"
  fi
fi

# ── 3. Arsip terenkripsi, dipotong ──
BASIS="$LOKAL/media-$STEMPEL-$JENIS.tar.enc"
BERSIHKAN+=("$BASIS.part-")
(cd "$HOME" && tar -cf - -T "$DAFTAR") 2>>"$LOG" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$KUNCI" 2>>"$LOG" \
  | split -b "$POTONG" - "$BASIS.part-" || gagal "membuat arsip terenkripsi gagal"
POTONGAN=("$BASIS".part-*)
[ -s "${POTONGAN[0]}" ] || gagal "arsip kosong"

# Uji: arsip yang akan diunggah harus bisa dibuka dan memuat semua berkas.
M=$(cat "${POTONGAN[@]}" | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$KUNCI" 2>>"$LOG" | tar -tf - 2>>"$LOG" | grep -vc '/$') || true
[ "${M:-0}" -eq "$N" ] || gagal "uji arsip: $M entri terbaca, seharusnya $N"
log "arsip OK: ${#POTONGAN[@]} potongan, $(du -ch "${POTONGAN[@]}" | tail -1 | cut -f1), $M berkas terbaca ulang"

# ── 4. Unggah ──
if [ -z "$UNGGAH" ]; then
  log "--tanpa-unggah: arsip lokal di $BASIS.part-* (penanda TIDAK dipasang)"
  BERSIHKAN=(); rm -f "$MULAI"; exit 0
fi
for p in "${POTONGAN[@]}"; do
  H=$(node "$DIR/scripts/ops/gdrive-unggah.mjs" unggah "$p" "${FOLDER_ARG[@]}" 2>>"$LOG") || gagal "unggah $(basename "$p") gagal: $H"
  log "unggah OK: $(basename "$p")"
done

# ── 5. Penanda + rapikan ──
mv -f "$MULAI" "$PENANDA"
find "$LOKAL" -name 'daftar-*.txt' -mtime +"$SIMPAN_DAFTAR_HARI" -delete 2>>"$LOG"
log "SELESAI ($JENIS): $N berkas tercadang ke Drive \"$NAMA_FOLDER\""
[ "$JENIS" = "penuh" ] && wa_send "✅ *Cadangan penuh berkas produksi selesai* — $N berkas ($((BYTE / 1048576)) MB) ke Drive \"$NAMA_FOLDER\". Mulai malam ini hanya berkas baru yang dicadangkan."
exit 0
