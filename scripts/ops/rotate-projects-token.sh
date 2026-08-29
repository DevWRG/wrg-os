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
echo "→ menyimpan ke secret repo $REPO…"
printf '%s' "$TOKEN" | gh secret set PROJECTS_TOKEN --repo "$REPO" && echo "  ✓ secret PROJECTS_TOKEN diperbarui"

echo "→ memperbarui $LOCAL_FILE…"
printf '%s' "$TOKEN" > "$LOCAL_FILE" && chmod 600 "$LOCAL_FILE" && echo "  ✓ token lokal diperbarui (chmod 600)"

echo
echo "Selesai. Langkah berikutnya:"
echo "  1. Jalankan ulang run sync yang gagal:"
echo "       gh run list --workflow=roadmap-project-sync.yml --status failure --limit 1"
echo "       gh run rerun <run-id>"
echo "  2. Sisir papan — transisi selama token mati TIDAK PERNAH tercatat."
echo "     Cari PR ber-F-number yang merged dalam rentang token mati:"
echo "       gh pr list --state merged --limit 400 --json number,mergedAt,baseRefName,title,headRefName"
echo "     Aturannya: base dev → Checking, base main → Done."
