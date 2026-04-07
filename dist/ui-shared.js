// ── Shared UI constants for dashboard and fleet ──────────────────────────────
export function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function formatUptime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    return `${(d > 0 ? `${d}d ` : '') + (h % 24)}h ${m % 60}m ${s % 60}s`;
}
export const FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 150 150' fill='none'><defs><linearGradient id='clay' x1='0' y1='0' x2='0' y2='1'><stop offset='0%25' stop-color='%23D4A574'/><stop offset='100%25' stop-color='%23A0724A'/></linearGradient><linearGradient id='glow' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%237DF9FF'/><stop offset='100%25' stop-color='%234FC3F7'/></linearGradient></defs><rect x='0' y='0' width='150' height='150' rx='22' fill='url(%23clay)'/><rect x='26' y='53' width='34' height='24' rx='5' fill='%230D1117'/><rect x='90' y='53' width='34' height='24' rx='5' fill='%230D1117'/><rect x='29' y='56' width='28' height='18' rx='3' fill='url(%23glow)'/><rect x='93' y='56' width='28' height='18' rx='3' fill='url(%23glow)'/><rect x='42' y='105' width='66' height='7' rx='3' fill='%238B6942'/></svg>";
export const DOCS_BASE = 'https://0xranx.github.io/golembot';
export const ENGINE_COLORS = {
    cursor: '#a855f7',
    'claude-code': '#f97316',
    opencode: '#22c55e',
    codex: '#3b82f6',
};
export const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;
  --accent:#58a6ff;--green:#3fb950;--red:#f85149;--orange:#d29922;
  --str:#a5d6ff;--kw:#ff7b72;--fn:#d2a8ff;--cmd:#79c0ff
}
@media(prefers-color-scheme:light){:root{
  --bg:#f6f8fa;--card:#fff;--border:#d0d7de;--text:#1f2328;--dim:#656d76;
  --accent:#0969da;--green:#1a7f37;--red:#cf222e;--orange:#9a6700;
  --str:#0a3069;--kw:#cf222e;--fn:#8250df;--cmd:#0550ae
}}

body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.5;min-height:100vh}
a{color:var(--accent);text-decoration:none} a:hover{text-decoration:underline}
code{background:var(--bg);border:1px solid var(--border);border-radius:3px;padding:1px 4px;font-size:12px;font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace}

/* Layout */
.container{max-width:1200px;margin:0 auto;padding:24px 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;margin-bottom:24px}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px}
.card h2{font-size:14px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.card h2 .icon{font-size:18px}
.card h2 .step{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;flex-shrink:0}
.card-desc{font-size:13px;color:var(--dim);margin-bottom:10px}
.section-label{font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:var(--dim);margin-bottom:12px;font-weight:600}
.empty{color:var(--dim);font-size:13px;padding:12px 0;text-align:center}

/* Header */
.header{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
.header h1{font-size:22px;font-weight:700}
.header .product{color:var(--accent)}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:#fff}
.status-dot{width:8px;height:8px;border-radius:50%;background:var(--green);display:inline-block;margin-right:4px}
.meta{color:var(--dim);font-size:13px;margin-left:auto}
.subtitle{color:var(--dim);font-size:13px;margin-bottom:20px}

/* Responsive */
@media(max-width:768px){
  .grid{grid-template-columns:1fr}
}`.trim();
//# sourceMappingURL=ui-shared.js.map