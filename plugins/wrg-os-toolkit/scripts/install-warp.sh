#!/bin/bash
# install-warp.sh v0.2.0 — installer wrg-os-toolkit ke Claude Code
#
# Usage:
#   bash install-warp.sh install [--mode=skills-dir|marketplace] [--copy] [--src=PATH]
#   bash install-warp.sh uninstall [--mode=...]
#   bash install-warp.sh verify
#
# PERUBAHAN vs v0.1.0 (kenapa dibikin ulang):
#   v0.1.0 nge-drop symlink `~/.claude/plugins/wrg-os-toolkit` dan
#   `~/Library/Application Support/Claude/plugins/wrg-os-toolkit`. Dua-duanya TIDAK
#   dibaca Claude Code: plugin ditemukan lewat known_marketplaces.json +
#   installed_plugins.json + cache/<marketplace>/<plugin>/<versi>/, bukan dari folder
#   bebas di ~/.claude/plugins/. Hasilnya 16 skill tak pernah nyala walau "Installed" tercetak.
#
#   v0.2.0 pakai dua jalur yang memang didukung:
#     mode=skills-dir  (DEFAULT) → $HOME/.claude/skills/<name>/  auto-load sesi berikutnya
#                                   sebagai `<name>@skills-dir`. Nol edit registry.
#     mode=marketplace           → local marketplace: butuh .claude-plugin/marketplace.json
#                                   di folder INDUK plugin, lalu `claude plugin marketplace add`
#                                   + `claude plugin install <name>@wrg-os-local`.
#
#   Tambahan pengaman:
#     - tak ada `rm -rf` buta: target cuma dihapus kalau symlink kita / plugin bernama sama
#     - --copy buat mesin yang Drive-nya bisa unmount (symlink ke Drive = plugin mati kalau Drive offline)
#     - --src buat install dari checkout repo (`~/wrg-os/plugins/wrg-os-toolkit`) di Mac mini/Warp

set -euo pipefail

PLUGIN_NAME="wrg-os-toolkit"
MARKETPLACE_NAME="wrg-os-local"

DRIVE_ROOT="$HOME/Library/CloudStorage/GoogleDrive-development@wahanalifeline.co.id/My Drive/Cowork Workspace/Projects/WRG OS"
DEFAULT_SRC="$DRIVE_ROOT/14-Plugins/$PLUGIN_NAME"

SKILLS_DIR="$HOME/.claude/skills"

ACTION="${1:-install}"; shift || true
MODE="skills-dir"
LINK_MODE="symlink"
PLUGIN_SRC="${WRG_PLUGIN_SRC:-$DEFAULT_SRC}"

for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#*=}" ;;
    --copy)   LINK_MODE="copy" ;;
    --src=*)  PLUGIN_SRC="${arg#*=}" ;;
    *) echo "Argumen tak dikenal: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf "\033[1;36m[wrg-toolkit]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[wrg-toolkit] WARN:\033[0m %s\n" "$*"; }
err()  { printf "\033[1;31m[wrg-toolkit] ERR:\033[0m %s\n" "$*" >&2; }

check_source() {
  if [ ! -d "$PLUGIN_SRC" ]; then
    err "Source plugin tidak ada: $PLUGIN_SRC"
    err "Kalau Drive belum ke-mount, pakai checkout repo: --src=\$HOME/wrg-os/plugins/$PLUGIN_NAME"
    exit 1
  fi
  if [ ! -f "$PLUGIN_SRC/.claude-plugin/plugin.json" ]; then
    err "Bukan folder plugin valid (tak ada .claude-plugin/plugin.json): $PLUGIN_SRC"
    exit 1
  fi
  local skill_count
  skill_count=$(find "$PLUGIN_SRC/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  log "Source: $PLUGIN_SRC"
  log "  · $skill_count skill terdeteksi"
}

# Hapus target HANYA kalau aman: symlink, atau direktori plugin dengan nama yang sama.
clear_target() {
  local target="$1"
  [ -e "$target" ] || [ -L "$target" ] || return 0

  if [ -L "$target" ]; then
    log "Target lama (symlink) diganti: $target"
    rm -f "$target"
    return 0
  fi

  if [ -f "$target/.claude-plugin/plugin.json" ] &&
     grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$PLUGIN_NAME\"" "$target/.claude-plugin/plugin.json"; then
    log "Target lama (folder plugin $PLUGIN_NAME) diganti: $target"
    rm -rf "$target"
    return 0
  fi

  err "Target sudah ada dan BUKAN milik $PLUGIN_NAME: $target"
  err "Pindahkan/hapus manual dulu — script ini tak mau nimpa isi yang tak dikenal."
  exit 1
}

install_skills_dir() {
  mkdir -p "$SKILLS_DIR"
  local target="$SKILLS_DIR/$PLUGIN_NAME"
  clear_target "$target"

  if [ "$LINK_MODE" = "copy" ]; then
    rsync -a --exclude='.DS_Store' --exclude='.git' "$PLUGIN_SRC/" "$target/"
    log "Installed (copy): $target"
  else
    ln -sfn "$PLUGIN_SRC" "$target"
    log "Installed (symlink): $target → $PLUGIN_SRC"
    case "$PLUGIN_SRC" in
      *CloudStorage/GoogleDrive-*)
        warn "Source ada di Google Drive (stream). Kalau Drive unmount/offline, plugin ikut mati."
        warn "Di mesin yang Drive-nya tak selalu ada, pakai: --copy  atau  --src=\$HOME/wrg-os/plugins/$PLUGIN_NAME"
        ;;
    esac
  fi

  log ""
  log "Selesai. Plugin auto-load di sesi Claude Code BERIKUTNYA sebagai: $PLUGIN_NAME@skills-dir"
  log "Cek:  claude plugin list"
}

install_marketplace() {
  local parent
  parent="$(dirname "$PLUGIN_SRC")"
  local mf="$parent/.claude-plugin/marketplace.json"

  if [ ! -f "$mf" ]; then
    err "marketplace.json belum ada: $mf"
    err "Salin dari scratchpad (marketplace.json yang sudah disiapkan) ke folder itu dulu."
    err "Script ini sengaja TIDAK nulis file ke Drive tanpa persetujuan."
    exit 1
  fi

  if ! command -v claude >/dev/null 2>&1; then
    err "CLI 'claude' tak ditemukan di PATH."
    exit 1
  fi

  log "Daftarkan marketplace lokal: $parent"
  claude plugin marketplace add "$parent"
  log "Install plugin dari marketplace..."
  claude plugin install "$PLUGIN_NAME@$MARKETPLACE_NAME"
  log ""
  log "Selesai. Cek: claude plugin list"
}

do_install() {
  check_source
  case "$MODE" in
    skills-dir)  install_skills_dir ;;
    marketplace) install_marketplace ;;
    *) err "Mode tak dikenal: $MODE (pilih skills-dir | marketplace)"; exit 1 ;;
  esac
}

do_uninstall() {
  case "$MODE" in
    skills-dir)
      local target="$SKILLS_DIR/$PLUGIN_NAME"
      if [ -L "$target" ]; then rm -f "$target"; log "Dihapus: $target"
      elif [ -d "$target" ]; then clear_target "$target"; log "Dihapus: $target"
      else log "Tak terpasang di $target"; fi
      ;;
    marketplace)
      claude plugin uninstall "$PLUGIN_NAME@$MARKETPLACE_NAME" 2>/dev/null || warn "uninstall plugin gagal/tak terpasang"
      claude plugin marketplace remove "$MARKETPLACE_NAME" 2>/dev/null || warn "remove marketplace gagal/tak terdaftar"
      ;;
    *) err "Mode tak dikenal: $MODE"; exit 1 ;;
  esac
}

do_verify() {
  log "Status pemasangan:"
  local target="$SKILLS_DIR/$PLUGIN_NAME"
  if [ -L "$target" ]; then
    log "  ✓ skills-dir (symlink): $target → $(readlink "$target")"
  elif [ -d "$target" ]; then
    log "  ✓ skills-dir (copy): $target"
  else
    warn "  ✗ skills-dir: belum terpasang"
  fi

  if [ -d "$target" ]; then
    local cnt
    cnt=$(find "$target/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    log "    · $cnt skill terjangkau"
  fi

  if command -v claude >/dev/null 2>&1; then
    log ""
    log "claude plugin list:"
    claude plugin list 2>/dev/null | sed 's/^/    /' || warn "gagal baca daftar plugin"
  fi

  if [ -f "$PLUGIN_SRC/.claude-plugin/plugin.json" ]; then
    log ""
    log "Manifest source:"
    python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(f'    name={d[\"name\"]} version={d[\"version\"]}')" \
      "$PLUGIN_SRC/.claude-plugin/plugin.json"
  fi
}

case "$ACTION" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  verify)    do_verify ;;
  *)
    echo "Usage: $0 [install|uninstall|verify] [--mode=skills-dir|marketplace] [--copy] [--src=PATH]"
    exit 1
    ;;
esac
