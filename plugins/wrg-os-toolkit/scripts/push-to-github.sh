#!/bin/bash
# push-to-github.sh v0.2.0 — index wrg-os-toolkit ke repo DevWRG/wrg-os (state/ + plugins/)
#
# Usage:
#   bash push-to-github.sh              # DRY-RUN: cuma tampilkan apa yang akan berubah
#   bash push-to-github.sh --apply      # commit + push branch + buka PR ke dev
#
# PERUBAHAN vs v0.1.0 (kenapa dibikin ulang):
#   1. REPO di-hardcode "$HOME/DevWRG/wrg-os" → itu path Mac mini. Di laptop repo-nya
#      "$HOME/wrg-os", jadi script langsung exit. Sekarang auto-detect + bisa di-override
#      lewat env WRG_REPO.
#   2. v0.1.0 `cp` dashboard-state.json dari Drive ke state/. FATAL: file Drive itu
#      snapshot manual 2026-07-18 (v1.138.0 · 234 rilis, 18.8 KB), sedangkan state/ di repo
#      auto-generated tiap 07:00 WIB oleh scripts/ops/sync-state.sh (v1.164.0 · 290 rilis, 1.5 KB).
#      Nge-push file Drive = mundurin state prod 19 hari + 56 rilis. Sekarang file itu
#      TIDAK disentuh sama sekali.
#   3. Section tooling.claudePlugins tidak bisa ditaruh manual di dashboard-state.json:
#      sync-state.sh nulis ulang file itu dari heredoc tiap pagi → section-nya kehapus.
#      Solusi ada di sync-state-tooling.patch (sync-state.sh yang merge dari warp-tooling.json).
#      Script ini cuma push warp-tooling.json sebagai sumber tunggal.
#   4. Tambah pengaman: tolak kalau working tree kotor, balikin branch semula lewat trap,
#      branch selalu based-on origin/dev yang fresh.

set -euo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

DRIVE_ROOT="$HOME/Library/CloudStorage/GoogleDrive-development@wahanalifeline.co.id/My Drive/Cowork Workspace/Projects/WRG OS"
PLUGIN_SRC="$DRIVE_ROOT/14-Plugins/wrg-os-toolkit"
TOOLING_SRC="$DRIVE_ROOT/08-State-Sync/warp-tooling.json"

# --- 1. Resolve repo ---
REPO="${WRG_REPO:-}"
if [ -z "$REPO" ]; then
  for cand in "$HOME/wrg-os" "$HOME/DevWRG/wrg-os"; do
    if [ -d "$cand/.git" ]; then REPO="$cand"; break; fi
  done
fi
if [ -z "$REPO" ] || [ ! -d "$REPO/.git" ]; then
  echo "ERR: repo wrg-os tak ketemu (dicoba \$WRG_REPO, ~/wrg-os, ~/DevWRG/wrg-os)." >&2
  exit 1
fi
echo "→ Repo: $REPO"

for f in "$PLUGIN_SRC/.claude-plugin/plugin.json" "$TOOLING_SRC"; do
  [ -e "$f" ] || { echo "ERR: sumber tak ada: $f" >&2; exit 1; }
done

# Versi dibaca dari manifest — JANGAN hardcode (v0.2.0 sempat kirim PR bertajuk v0.1.0
# padahal plugin.json sudah 0.1.1).
VERSION="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['version'])" \
           "$PLUGIN_SRC/.claude-plugin/plugin.json")"
echo "→ Versi plugin: v$VERSION"

cd "$REPO"

# --- 2. Pengaman working tree ---
if [ -n "$(git status --porcelain)" ]; then
  echo "ERR: working tree kotor di $REPO. Commit/stash dulu — script ini pindah branch." >&2
  git status --short >&2
  exit 1
fi

ORIG_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
restore_branch() {
  local cur; cur="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
  if [ -n "$ORIG_BRANCH" ] && [ "$cur" != "$ORIG_BRANCH" ]; then
    echo "→ Balik ke branch semula: $ORIG_BRANCH"
    git checkout --quiet "$ORIG_BRANCH" 2>/dev/null || true
  fi
}
trap restore_branch EXIT

# --- 3. Branch based-on origin/dev yang fresh ---
git fetch origin dev --quiet
BRANCH="feat/wrg-os-toolkit-plugin-index"
BRANCH_EXISTED=1
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout --quiet "$BRANCH"
  git reset --hard origin/dev --quiet
else
  BRANCH_EXISTED=0
  git checkout --quiet -b "$BRANCH" origin/dev
fi
echo "→ Branch: $BRANCH (based-on origin/dev)"

# Catat file mana yang SEBELUMNYA belum ada di git — dipakai buat bersih-bersih dry-run.
# (`git checkout -- <path>` TIDAK menghapus file untracked, jadi harus di-rm eksplisit.)
TOOLING_WAS_TRACKED=0
git ls-files --error-unmatch state/warp-tooling.json >/dev/null 2>&1 && TOOLING_WAS_TRACKED=1

# --- 4. Copy HANYA warp-tooling.json + mirror plugin ---
#     dashboard-state.json SENGAJA tidak disentuh (auto-generated sync-state.sh).
mkdir -p state plugins/wrg-os-toolkit
cp "$TOOLING_SRC" state/warp-tooling.json
echo "→ state/warp-tooling.json diperbarui dari Drive"

rsync -a --delete \
  --exclude='.git' --exclude='.DS_Store' \
  "$PLUGIN_SRC/" plugins/wrg-os-toolkit/
echo "→ plugins/wrg-os-toolkit/ di-mirror dari Drive"

git add state/warp-tooling.json plugins/wrg-os-toolkit/

echo ""
echo "=== Perubahan yang ter-stage ==="
git status --short
echo ""
echo "dashboard-state.json di repo (TIDAK diubah):"
python3 -c "import json;d=json.load(open('state/dashboard-state.json'));print('   ',d['production']['version'],'·',d['production']['totalReleases'],'rilis ·',d['lastUpdate'])" 2>/dev/null || true

if [ "$APPLY" -eq 0 ]; then
  echo ""
  echo "DRY-RUN. Tidak ada commit/push/PR. Bersih-bersih..."
  git reset --quiet

  if [ "$TOOLING_WAS_TRACKED" -eq 1 ]; then
    git checkout --quiet -- state/warp-tooling.json 2>/dev/null || true
  else
    rm -f state/warp-tooling.json          # untracked → checkout tak menghapusnya
  fi
  rm -rf plugins/wrg-os-toolkit
  rmdir plugins 2>/dev/null || true
  rmdir state 2>/dev/null || true          # cuma sukses kalau memang kosong

  git checkout --quiet "$ORIG_BRANCH"
  [ "$BRANCH_EXISTED" -eq 0 ] && git branch -D "$BRANCH" >/dev/null 2>&1

  if [ -z "$(git status --porcelain)" ]; then
    echo "✓ Working tree bersih, kembali ke branch $ORIG_BRANCH."
  else
    echo "⚠ Masih ada sisa di working tree:"
    git status --short
  fi
  exit 0
fi

# --- 5. Commit + push + PR ---
git commit -m "feat(tooling): index wrg-os-toolkit v$VERSION Claude plugin

- Add state/warp-tooling.json (manifest kanonik buat Warp automation)
- Mirror plugins/wrg-os-toolkit/ (16 skill cherry-pick dari ECC v2.1.0 MIT)
- Install: bash plugins/wrg-os-toolkit/scripts/install-warp.sh install

Catatan: state/dashboard-state.json sengaja TIDAK diubah — file itu
auto-generated sync-state.sh tiap 07:00 WIB. Section tooling.* menyusul
lewat patch sync-state.sh (merge dari warp-tooling.json) biar tak kehapus.

Ref: WRG OS/14-Plugins/wrg-os-toolkit/README.md

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" || {
  echo "(tak ada yang di-commit — sudah up-to-date)"
  exit 0
}

git push -u origin "$BRANCH" --force-with-lease

if command -v gh >/dev/null 2>&1; then
  gh pr create \
    --base dev \
    --head "$BRANCH" \
    --title "feat(tooling): index wrg-os-toolkit v$VERSION Claude plugin" \
    --body "Indeks plugin \`wrg-os-toolkit\` **v$VERSION** (16 skill cherry-pick dari ECC v2.1.0, MIT) ke \`state/\` + \`plugins/\`.

## Isi
- \`state/warp-tooling.json\` — manifest Warp (\`wrg-sync\` narik file ini)
- \`plugins/wrg-os-toolkit/\` — mirror folder plugin (installable dari checkout repo)

## Yang SENGAJA tidak ikut
\`state/dashboard-state.json\` **tidak disentuh**. File itu di-regenerate \`scripts/ops/sync-state.sh\` tiap 07:00 WIB dari heredoc, jadi section \`tooling.*\` yang ditambah manual bakal kehapus besok paginya. Rencananya sync-state.sh yang diajari merge \`tooling\` dari \`state/warp-tooling.json\` (PR terpisah).

## Install (setelah merge)
\`\`\`bash
cd ~/wrg-os && git pull
bash plugins/wrg-os-toolkit/scripts/install-warp.sh install
claude plugin list   # harus muncul wrg-os-toolkit@skills-dir
\`\`\`

## Atribusi
Skill cherry-pick dari [affaan-m/ECC v2.1.0](https://github.com/affaan-m/ECC) (MIT · Affaan Mustafa). LICENSE terlampir di folder plugin.

⚠️ Repo ini PUBLIC — isi \`plugins/\` ikut publik (aman secara lisensi, sekadar catatan).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
else
  echo "(gh CLI tak ada — buka PR manual: https://github.com/DevWRG/wrg-os/pull/new/$BRANCH)"
fi

echo ""
echo "DONE. Review PR → merge ke dev → promotion dev→main sesuai gate."
