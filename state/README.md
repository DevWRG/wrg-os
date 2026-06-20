# State Sync — Single Source of Truth

**Purpose:** Sinkronisasi state antara GitHub (`DevWRG/wrg-os`), Warp.ai (terminal ops), dan Cowork (Sprint Dashboard).

---

## 📂 Files

| File | Konten | Update Frequency |
|---|---|---|
| `dashboard-state.json` | Version + infrastructure + access + catalog summary | GitHub Actions on-release + Warp daily 07:00 + manual `wrg-sync` |
| `release-log.json` | Release history dengan PR refs + summary | GitHub Actions on-release auto |
| `current-sprint.json` | Sprint aktif + 3 leverage tertinggi + WatchPoint HoD status | Husni manual update tiap Senin pagi |
| `warp-memory.md` | Snapshot Warp memory export (not yet — Fase 2) | Warp daily cron |

---

## 🔄 Workflow End-to-End

### Source of Truth → Read Path

```
GitHub state/*.json (canonical)
        │
        ├─→ Browser fetch → Sprint Dashboard HTML "Live Status" widget
        ├─→ Cowork session bootstrap (read via Drive mirror)
        └─→ Warp git pull (sync ke local)
```

### Update Path

```
Trigger → Update state JSON → git commit → push ke GitHub
   │
   ├─ on-release (GitHub Actions auto)
   ├─ daily 07:00 (Warp cron `sync-state.sh`)
   ├─ on-demand (Warp `wrg-sync` command)
   └─ Cowork agent (via PR after Husni merge)
```

---

## 🚀 Cara Pakai (Manual untuk Sekarang)

### 1. Initial commit ke GitHub (sekali saja)

```bash
cd ~/DevWRG/wrg-os
git checkout -b feat/state-sync

# Copy files dari Drive ke repo
mkdir -p state/
cp ~/Library/CloudStorage/GoogleDrive-*/My\ Drive/Cowork\ Workspace/Projects/WRG\ OS/08-State-Sync/*.json state/

git add state/
git commit -m "feat(state): init dashboard state sync (single source of truth)"
git push origin feat/state-sync
gh pr create --title "feat: state sync foundation" --body "Initial state/ folder dengan dashboard-state, release-log, current-sprint"
# Lalu Husni merge ke dev → main
```

### 2. Manual update on-demand

```bash
# Edit state file di repo
vi state/current-sprint.json

# Atau auto-pull dari Warp script (Fase 2)
~/DevWRG/wrg-os/scripts/ops/sync-state.sh

git add state/
git commit -m "chore(state): update sprint W25"
git push
```

### 3. Verify dashboard pull live data

Buka `WRG-OS-Sprint-Dashboard.html` → tab Pengantar → card "Live Status" → klik "Refresh" → harus tampil v1.54.3 (atau version terbaru).

---

## 🌐 GitHub Raw URL Endpoints

Dashboard fetch dari URL ini:

| File | URL |
|---|---|
| Dashboard state | `https://raw.githubusercontent.com/DevWRG/wrg-os/main/state/dashboard-state.json` |
| Release log | `https://raw.githubusercontent.com/DevWRG/wrg-os/main/state/release-log.json` |
| Current sprint | `https://raw.githubusercontent.com/DevWRG/wrg-os/main/state/current-sprint.json` |

**CORS:** GitHub raw URLs allow CORS by default — fetch dari browser dashboard akan jalan.

---

## 🔮 Future (Fase 2 + 3)

### Fase 2 — Warp Auto-Sync (1 hari setup)
- Script `scripts/ops/sync-state.sh` auto-update state JSON
- Cron daily 07:00
- Manual trigger via `wrg-sync` Warp alias

### Fase 3 — GitHub Actions Auto-Update (Future)
- `.github/workflows/update-dashboard-state.yml` trigger on `release: published`
- Auto-commit ke `state/dashboard-state.json` + `release-log.json`
- Sinkron tanpa manual intervention

---

## 🔒 Privacy

State files PUBLIC (di public GitHub repo). Yang DI-INCLUDE:
- Version + release tag
- Service status
- Fitur catalog summary (counts only, NOT detail per F-ID)
- Sprint priorities (high-level)

Yang DI-EXCLUDE (jangan masukkin):
- Nama customer specific
- Revenue absolute angka per cabang
- AM names + nomor WA personal
- Detail incident yang belum public
- Credentials (semua di `.env.prod` gitignored)

---

*Versi: v1.0.0 · 2026-06-20 · Husni Mubarrak (Co-Builder WRG-OS)*
