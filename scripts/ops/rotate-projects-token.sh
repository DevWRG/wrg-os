#!/usr/bin/env bash
# Rotasi PROJECTS_TOKEN — VALIDASI DULU, simpan belakangan.
#
# Dipakai saat `sync` (roadmap-project-sync.yml) merah dengan "Bad credentials"
# atau "project tak terbaca". Pesan gagal workflow itu sendiri merujuk ke
# langkah-langkah ini.
#
# Kenapa begini urutannya: token yang sah tapi KURANG SCOPE lolos di
# `viewer { login }` lalu gagal belakangan saat menyentuh Projects. Kalau
# langsung disimpan, kegagalannya baru ketahuan di PR berikutnya — persis pola
# yang bikin papan diam 13 hari (14–27 Agu). Skrip ini membaca papannya
# langsung, jadi kalau tersimpan berarti sudah pasti cukup scope.
#
# Token dibaca dari STDIN, bukan argumen — argumen bocor ke daftar proses
# (`ps aux`) dan ke history shell.
#
# Bikin token dulu (scope sudah tercentang dari URL; ubah Expiration ke
# "No expiration" — expiry pendek ADALAH penyebab insiden 14-27 Agu 2026):
#   https://github.com/settings/tokens/new?scopes=project,repo&description=WRG-OS%20PROJECTS_TOKEN
#
# Pakai:
#   bash scripts/ops/rotate-projects-token.sh          # meminta token (tak tampil)
#   pbpaste | bash scripts/ops/rotate-projects-token.sh   # kalau sudah di clipboard
#
# PROJECT_ID bisa di-override lewat env kalau papannya pindah:
#   PROJECT_ID=PVT_xxx bash scripts/ops/rotate-projects-token.sh
set -uo pipefail

# Nilai default = yang dipakai roadmap-project-sync.yml. Bukan rahasia — ID ini
# sudah ada di workflow yang publik; yang rahasia hanya token-nya, dan itu tak
# pernah tersimpan di berkas ini.
PROJECT_ID="${PROJECT_ID:-PVT_kwHOEMRLCs4BbQ3-}"   # papan #2 WRG-OS Roadmap
REPO="${REPO:-DevWRG/wrg-os}"
LOCAL_FILE="${LOCAL_FILE:-$HOME/.wrg-gh-token}"

if [ -t 0 ]; then
  printf 'Tempel PROJECTS_TOKEN baru (tak akan tampil), lalu Enter: ' >&2
  IFS= read -rs TOKEN
  printf '\n' >&2
else
  IFS= read -r TOKEN
fi
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"

[ -n "$TOKEN" ] && [ ${#TOKEN} -ge 20 ] || { echo "✗ token kosong / terlalu pendek — dibatalkan."; exit 1; }
echo "token diterima (${#TOKEN} karakter) — TIDAK dicetak."

# ── 1. Validasi: baca papannya, bukan cuma cek token hidup ────────────────
echo "→ menguji akses ke papan Projects…"
OUT=$(GH_TOKEN="$TOKEN" gh api graphql -f query="
  { node(id:\"$PROJECT_ID\") { ... on ProjectV2 { number title } } }" 2>&1)

if printf '%s' "$OUT" | grep -q '"title"'; then
  echo "  ✓ $(printf '%s' "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]["node"]; print(f"papan #{d[\"number\"]} \"{d[\"title\"]}\" terbaca")' 2>/dev/null || echo 'papan terbaca')"
elif printf '%s' "$OUT" | grep -qi 'bad credentials'; then
  echo "  ✗ Bad credentials — token salah / sudah dicabut. TIDAK disimpan."; exit 1
elif printf '%s' "$OUT" | grep -qi 'could not resolve to a node\|null'; then
  echo "  ✗ Token SAH tapi scope 'project' kurang — ini kegagalan yang paling sering."
  echo "    Classic PAT: centang scope 'project'."
  echo "    Fine-grained: Account permissions → Projects: Read and write"
  echo "                  (BUKAN Repository permissions — papan ini milik akun, bukan repo)."
  echo "    TIDAK disimpan."; exit 1
else
  echo "  ✗ Gagal, respons tak dikenali:"; printf '%s\n' "$OUT" | head -5 | sed 's/^/    /'
  echo "    TIDAK disimpan."; exit 1
fi

# ── 2. Uji izin TULIS juga — baca saja tak membuktikan bisa update status ──
# Workflow-nya memanggil addProjectV2DraftIssue + updateProjectV2ItemFieldValue.
# Token read-only akan lolos langkah 1 lalu gagal saat dipakai. Dibuktikan
# dengan membaca field Status (butuh akses struktur project, bukan cuma judul).
echo "→ menguji akses field Status…"
FLD=$(GH_TOKEN="$TOKEN" gh api graphql -f query="
  { node(id:\"$PROJECT_ID\") { ... on ProjectV2 {
      field(name:\"Status\") { ... on ProjectV2SingleSelectField { id options { name } } } } } }" 2>&1)
if printf '%s' "$FLD" | grep -q '"options"'; then
  echo "  ✓ field Status terbaca ($(printf '%s' "$FLD" | grep -o '"name":"[^"]*"' | wc -l | tr -d ' ') opsi)"
else
  echo "  ⚠ field Status tak terbaca — token mungkin read-only."
  echo "    Workflow butuh TULIS (update status + buat kartu draft)."
  printf '%s\n' "$FLD" | head -3 | sed 's/^/    /'
  printf '  Tetap simpan? (ketik ya untuk lanjut): ' >&2; IFS= read -r ANS
  [ "$ANS" = "ya" ] || { echo "  dibatalkan."; exit 1; }
fi

# ── 3. Baru simpan ────────────────────────────────────────────────────────
# WAJIB ${VAR} berkurung, bukan $VAR, kalau bersebelahan dengan karakter
# non-ASCII seperti "…": bash 3.2 (yang dikirim macOS) memakan byte UTF-8-nya
# sebagai bagian nama variabel, jadi $REPO… menjadi variabel "REPO<e2><80><a6>"
# yang tak pernah di-set — lalu `set -u` mematikan skrip. Bikin rotasi gagal
# 2x (29 Agu 2026): validasi lolos, mati persis sebelum menyimpan.
FAIL=0

echo "→ menyimpan ke secret repo ${REPO}…"
if printf '%s' "$TOKEN" | gh secret set PROJECTS_TOKEN --repo "$REPO"; then
  echo "  ✓ perintah gh secret set berhasil"
else
  echo "  ✗ gh secret set GAGAL — cek 'gh auth status' (butuh admin di repo)"; FAIL=1
fi

echo "→ memperbarui ${LOCAL_FILE}…"
if printf '%s' "$TOKEN" > "$LOCAL_FILE" && chmod 600 "$LOCAL_FILE"; then
  echo "  ✓ token lokal ditulis (chmod 600)"
else
  echo "  ✗ gagal menulis ${LOCAL_FILE}"; FAIL=1
fi

# ── 4. Verifikasi mandiri ─────────────────────────────────────────────────
# Tanpa ini skrip bisa "kelihatan sukses" padahal nol tersimpan — persis yang
# terjadi 29 Agu 2026 (mati di baris echo, user melapor sudah terpasang,
# ternyata updated_at secret masih 6 minggu lalu). Jadi jangan percaya
# ketiadaan error; buktikan timestamp-nya bergerak.
echo "→ memverifikasi apa yang BENAR-BENAR tersimpan…"
UPD=$(gh api "repos/$REPO/actions/secrets/PROJECTS_TOKEN" -q .updated_at 2>/dev/null)
if [ -n "${UPD:-}" ]; then
  echo "  secret PROJECTS_TOKEN updated_at = $UPD"
  # updated_at hari ini (UTC) = baru saja diperbarui
  if [ "${UPD%%T*}" = "$(date -u '+%Y-%m-%d')" ]; then
    echo "  ✓ secret benar-benar diperbarui hari ini"
  else
    echo "  ✗ secret TIDAK berubah — anggap rotasi GAGAL"; FAIL=1
  fi
else
  echo "  ⚠ tak bisa membaca updated_at (scope gh CLI?) — verifikasi manual:"
  echo "      gh api repos/$REPO/actions/secrets/PROJECTS_TOKEN -q .updated_at"
fi

if GH_TOKEN="$(cat "$LOCAL_FILE" 2>/dev/null)" gh api graphql \
     -f query="{ node(id:\"$PROJECT_ID\") { ... on ProjectV2 { number } } }" 2>/dev/null | grep -q '"number"'; then
  echo "  ✓ token dari ${LOCAL_FILE} bisa membaca papan"
else
  echo "  ✗ token di ${LOCAL_FILE} tak bisa membaca papan — anggap rotasi GAGAL"; FAIL=1
fi

echo
if [ "$FAIL" -ne 0 ]; then
  echo "✗ ROTASI GAGAL — jangan lanjut. Perbaiki dulu yang bertanda ✗ di atas."
  exit 1
fi

echo "✓ Rotasi selesai & terverifikasi. Langkah berikutnya:"
echo "  1. Jalankan ulang run sync yang gagal:"
echo "       gh run list --workflow=roadmap-project-sync.yml --status failure --limit 1"
echo "       gh run rerun <run-id>"
echo "  2. Sisir papan — transisi selama token mati TIDAK PERNAH tercatat."
echo "     Survei papan TAK butuh token ini; gh CLI ber-scope project sudah cukup."
echo "     Silangkan status kartu dengan:"
echo "       gh pr list --state merged --limit 400 --json number,mergedAt,baseRefName,title,headRefName"
echo "     Aturannya: base dev → Checking, base main → Done."
