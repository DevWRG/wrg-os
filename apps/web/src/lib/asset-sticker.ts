import QRCode from "qrcode";

// F53 — layout stiker di-port dari tool sebelumnya (github.com/DevWRG/label-asset,
// "Jurassic Park inspired": strip navy "Jangan Dicabut" + QR + kode). Barcode
// CODE128 dari tool asal SENGAJA di-drop — blueprint F53 cuma minta QR-code,
// bukan barcode tambahan.
export type StickerSize = "s" | "m" | "l";

interface SizeCfg {
  W: number; H: number; STRIP: number; TOP: number; BOT: number; QR: number; LH: number; PER: number;
  FS: { strip: number; bot: number; pl: number; pn: number; pname: number; code: number };
}

const SIZES: Record<StickerSize, SizeCfg> = {
  s: { W: 245, H: 96, STRIP: 20, TOP: 30, BOT: 11, QR: 54, LH: 14, PER: 24, FS: { strip: 5, bot: 5, pl: 4.5, pn: 5.5, pname: 5.5, code: 6 } },
  m: { W: 245, H: 128, STRIP: 20, TOP: 40, BOT: 14, QR: 54, LH: 20, PER: 18, FS: { strip: 6.5, bot: 6, pl: 6, pn: 7.5, pname: 7, code: 8 } },
  l: { W: 245, H: 182, STRIP: 20, TOP: 56, BOT: 20, QR: 54, LH: 30, PER: 12, FS: { strip: 9, bot: 8, pl: 8, pn: 10, pname: 9.5, code: 10.5 } },
};

export interface StickerAsset {
  kode: string;
  nama: string;
  jenis_kepemilikan: string;
  lokasi_cabang: string | null;
  letak: string | null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function stickerHtml(a: StickerAsset, cfg: SizeCfg): Promise<string> {
  const qr = await QRCode.toDataURL(a.kode, { width: cfg.QR * 3, margin: 0 });
  const badge = a.jenis_kepemilikan === "aset" ? "ASSET" : "INV";
  const locLine = [a.lokasi_cabang, a.letak].filter(Boolean).join(" · ");
  return `<div class="stk" style="width:${cfg.W}px;height:${cfg.H}px">
    <div class="stk-strip" style="width:${cfg.STRIP}px;font-size:${cfg.FS.strip}pt">Jangan Dicabut</div>
    <div class="stk-body">
      <span class="stk-bdg" style="font-size:${cfg.FS.pl}pt">${badge}</span>
      <div class="stk-top" style="height:${cfg.TOP}px">
        <img src="/brand/wahana-lifeline-color.png" style="height:${cfg.LH}px" alt="Wahana LifeLine">
        <div class="stk-prop">
          <div class="pl" style="font-size:${cfg.FS.pl}pt">Property of</div>
          <div class="pn" style="font-size:${cfg.FS.pn}pt">Wahana LifeLine</div>
          <div class="pname" style="font-size:${cfg.FS.pname}pt">${esc(a.nama)}</div>
        </div>
      </div>
      <div class="stk-mid">
        <div class="stk-qr" style="width:${cfg.QR}px;height:${cfg.QR}px"><img src="${qr}" style="width:100%;height:100%"></div>
        <div class="stk-bar"><div class="code" style="font-size:${cfg.FS.code}pt">${esc(a.kode)}</div></div>
      </div>
      <div class="stk-bot" style="height:${cfg.BOT}px;font-size:${cfg.FS.bot}pt;display:flex;align-items:center;justify-content:center">${locLine ? esc(locLine) : "Hub. HRGA jika ditemukan"}</div>
    </div>
  </div>`;
}

export async function buildStickerPageHtml(assets: StickerAsset[], size: StickerSize): Promise<string> {
  const cfg = SIZES[size];
  const stickers = await Promise.all(assets.map((a) => stickerHtml(a, cfg)));
  const pages: string[] = [];
  for (let i = 0; i < stickers.length; i += cfg.PER) {
    pages.push(`<div class="pg">${stickers.slice(i, i + cfg.PER).join("")}</div>`);
  }
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>Stiker Aset — Wahana LifeLine</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#b0b8c4}
.toolbar{position:fixed;top:10px;right:10px;z-index:100}
.toolbar button{padding:8px 16px;border:none;border-radius:6px;background:#15C8DC;color:#1B2A3B;font-weight:700;cursor:pointer;font-size:13px}
.pg{background:#fff;width:210mm;padding:6px;margin:0 auto 12px;display:flex;flex-wrap:wrap;align-content:flex-start;box-shadow:0 4px 20px rgba(0,0,0,.25)}
.stk{background:#fff;border:.5px solid #b0b0b0;overflow:hidden;flex-shrink:0;display:flex;font-family:Arial,sans-serif;color:#1B2A3B}
.stk-strip{background:#1B2A3B;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;writing-mode:vertical-rl;transform:rotate(180deg);font-weight:800;letter-spacing:.22em;text-transform:uppercase;line-height:1}
.stk-body{flex:1;display:flex;flex-direction:column;min-width:0;position:relative}
.stk-top{display:flex;align-items:center;gap:5px;padding:3px 38px 3px 5px;background:#fff;flex-shrink:0}
.stk-top img{flex-shrink:0;display:block}
.stk-prop{flex:1;text-align:center;line-height:1.15;min-width:0}
.stk-prop .pl{color:#666;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stk-prop .pn{font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#1B2A3B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stk-prop .pname{font-weight:400;color:#1B2A3B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stk-bdg{position:absolute;top:2px;right:3px;background:#E84830;color:#fff;font-weight:800;border-radius:2px;padding:0 3px;white-space:nowrap;letter-spacing:.05em;line-height:1.4;z-index:2}
.stk-mid{background:#15C8DC;display:flex;align-items:center;gap:4px;padding:1px 4px;flex:1;min-height:0}
.stk-qr{flex-shrink:0;background:#fff;padding:3px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.stk-bar{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;gap:1px}
.stk-bar .code{font-family:'Courier New',monospace;font-weight:700;color:#1B2A3B;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;text-align:center}
.stk-bot{background:#E84830;color:#fff;text-align:center;font-weight:800;letter-spacing:.08em;text-transform:uppercase;flex-shrink:0;line-height:1.3;padding:1px 4px}
@page{size:A4 portrait;margin:0}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;color-adjust:exact!important}
  .toolbar{display:none!important}
  body{background:#fff}
  .pg{box-shadow:none;margin:0;padding:5mm;page-break-after:always;break-after:page;width:100%}
  .pg:last-child{page-break-after:auto}
}
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">🖨️ Cetak / Simpan PDF</button></div>
${pages.join("\n")}
</body></html>`;
}
