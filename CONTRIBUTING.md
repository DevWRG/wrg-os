# Alur Kontribusi WRG-OS

## Branching
- **`dev`** = branch integrasi & **default**. Semua pengembangan masuk ke sini.
- **`main`** = branch rilis/produksi. **Hanya** diperbarui dari `dev` lewat PR yang
  di-approve owner. Push langsung ke `main` diblokir (branch protection).

```
feature/*  ──PR──▶  dev  ──PR (approve owner)──▶  main  ──▶ auto-release (tag + GitHub Release)
```

### Untuk kontributor / agen
1. Buat branch dari `dev`: `git checkout dev && git pull && git checkout -b feat/...`
2. Buka PR dengan **base `dev`** (default). CI (lint·typecheck·build + services/ai) harus hijau.
3. Setelah di-review, merge ke `dev`.
4. Rilis: owner membuka/menyetujui PR `dev → main`. Saat merge, `release.yml`
   otomatis membuat versi baru.

## Auto-versioning
Tiap push ke `main` (= merge `dev→main` ter-approve) → `release.yml` menghitung
versi semver berikut dari commit sejak tag terakhir lalu membuat tag + GitHub Release:
- `BREAKING CHANGE` atau `<type>!:` → **major**
- `feat:` → **minor**
- lainnya (`fix:`, `chore:`, `refactor:`, `style:`, `docs:`) → **patch**

Pakai **Conventional Commits** (`feat:`, `fix:`, `chore(scope): …`) supaya bump akurat.

## Catatan
- Deploy tetap **manual** — CI tak pernah menyentuh sistem Python produksi (port 8090–8092).
- Rahasia hanya di `.env` (gitignored); `.env.example` placeholder.
