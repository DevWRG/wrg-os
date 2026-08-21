# INSTALL — wrg-os-toolkit

> **v0.1.1 — metode install BERUBAH.** Cara lama (drop symlink ke `~/.claude/plugins/`
> atau `~/Library/Application Support/Claude/plugins/`) **tidak jalan**: Claude Code
> menemukan plugin lewat registry `known_marketplaces.json` + `installed_plugins.json` +
> `cache/<marketplace>/<plugin>/<versi>/`, bukan dari folder bebas yang ditaruh di
> `~/.claude/plugins/`. Symlink di sana diam saja — skill tak pernah nyala walau
> installer lama mencetak "Installed".

## Opsi A — skills-dir (DEFAULT, paling gampang)

`~/.claude/skills/<name>/` adalah lokasi auto-load resmi Claude Code (`claude plugin init`
sendiri scaffold ke sana). Plugin ke-load sesi berikutnya sebagai `wrg-os-toolkit@skills-dir`.

```bash
cd "$HOME/Library/CloudStorage/GoogleDrive-development@wahanalifeline.co.id/My Drive/Cowork Workspace/Projects/WRG OS/14-Plugins/wrg-os-toolkit"

bash scripts/install-warp.sh install       # symlink ke Drive (auto-refresh saat Drive update)
bash scripts/install-warp.sh install --copy  # ATAU snapshot kalau Drive bisa offline
bash scripts/install-warp.sh verify
```

Buka sesi `claude` baru, lalu:

```bash
claude plugin list      # harus ada: wrg-os-toolkit@skills-dir
```

**Install dari checkout repo** (Warp / Mac mini, tanpa Drive):

```bash
cd ~/wrg-os && git pull
bash plugins/wrg-os-toolkit/scripts/install-warp.sh install \
     --src="$HOME/wrg-os/plugins/wrg-os-toolkit"
```

## Opsi B — local marketplace

Dipakai kalau mau plugin terdaftar penuh di registry (muncul di `claude plugin details`,
bisa `enable`/`disable`). Butuh `14-Plugins/.claude-plugin/marketplace.json` — sudah ada.

```bash
bash scripts/install-warp.sh install --mode=marketplace
```

Ekuivalen manual:

```bash
claude plugin marketplace add "$HOME/Library/CloudStorage/GoogleDrive-.../WRG OS/14-Plugins"
claude plugin install wrg-os-toolkit@wrg-os-local
```

## Opsi C — Package `.plugin` (share ke tim/magang)

```bash
cd "$HOME/Library/CloudStorage/GoogleDrive-.../WRG OS/14-Plugins/wrg-os-toolkit"
zip -r ../wrg-os-toolkit-v0.1.1.plugin . -x "*.DS_Store"
```

⚠️ Repack **wajib** tiap kali `scripts/` atau `skills/` berubah — kalau tidak, penerima
dapat versi basi. Bump `version` di `.claude-plugin/plugin.json` +
`../.claude-plugin/marketplace.json` dulu, baru zip.

## Claude Desktop / Cowork

Path `~/Library/Application Support/Claude/plugins/` **belum terverifikasi** dipakai
Claude Desktop (di mesin laptop foldernya bahkan tak ada). Installer v0.1.1 sengaja
tidak lagi menulis ke sana. Kalau nanti terbukti dipakai, tambahkan target itu di
`install-warp.sh` dan update dokumen ini.

## Verify

```bash
bash scripts/install-warp.sh verify
ls ~/.claude/skills/wrg-os-toolkit/skills | wc -l    # expect: 16
claude plugin list
```

Di sesi baru, skill muncul di `<available_skills>` dengan prefix `wrg-os-toolkit:<skill-name>`.

## Uninstall

```bash
bash scripts/install-warp.sh uninstall                     # mode skills-dir
bash scripts/install-warp.sh uninstall --mode=marketplace  # mode marketplace
```

## Update / bump version

Kalau nambah skill baru dari ECC:

1. Bump `version` di `.claude-plugin/plugin.json` **dan** `../.claude-plugin/marketplace.json`
2. Update tabel `README.md` + `CHERRY-PICK-REFERENCE.md`
3. Update `08-State-Sync/warp-tooling.json` (`version`, `skillCount`, `packagedFile`)
4. Repack `.plugin` (Opsi C)
5. Install symlink → auto-refresh. Install `--copy` → jalankan ulang installer.

## Catatan keamanan

`skills/delivery-gate/hooks/quality-gate.py` adalah **Stop hook** pihak ketiga (dari ECC).
Memasang plugin **tidak** mengaktifkannya — hook baru jalan kalau didaftarkan manual di
`settings.json` (`hooks.Stop`). Review isinya dulu sebelum di-wire.
