// Injected stylesheet — keeps everything in one build with no CSS asset.
export function injectStyles(): void {
  const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html, body, #app { width: 100%; height: 100%; overflow: hidden; background: #0a0a0f; }
  body { font-family: system-ui, -apple-system, sans-serif; color: #e8e8f0; touch-action: none; overscroll-behavior: none; user-select: none; -webkit-user-select: none; }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  .overlay { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; background: radial-gradient(circle at 50% 30%, #14121f, #0a0a0f); z-index: 10; overflow-y: auto; }
  .overlay.hidden { display: none; }
  .title { font-size: clamp(38px, 11vw, 84px); font-weight: 900; letter-spacing: -2px; line-height: 0.9; text-align:center; }
  .title .a { color: #5ad1ff; } .title .b { color: #ff6b8b; }
  .sub { color: #9aa0b4; font-size: 14px; text-align: center; max-width: 460px; }
  .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: center; }
  .col { display: flex; flex-direction: column; gap: 12px; align-items: center; width: 100%; max-width: 420px; }
  input.f { background: #1a1826; border: 2px solid #2e2a40; color: #fff; font-size: 18px; padding: 12px 16px; border-radius: 12px; width: 100%; text-align: center; }
  input.f:focus { outline: none; border-color: #5ad1ff; }
  input.code { text-transform: uppercase; letter-spacing: 8px; font-weight: 800; font-size: 30px; }
  button.btn { background: #5ad1ff; color: #08131a; border: none; font-size: 18px; font-weight: 800; padding: 14px 22px; border-radius: 12px; cursor: pointer; }
  button.btn.alt { background: #2a2740; color: #e8e8f0; }
  button.btn.pink { background: #ff6b8b; color: #200; }
  button.btn:active { transform: translateY(1px); }
  button.btn:disabled { opacity: 0.4; }
  .card { background: #14121f; border: 1px solid #26233a; border-radius: 16px; padding: 18px; width: 100%; max-width: 460px; }
  .triangle { display: flex; gap: 10px; justify-content: center; align-items: center; color: #9aa0b4; font-size: 13px; }
  .pill { background: #1a1826; border-radius: 999px; padding: 6px 12px; font-weight: 700; }
  .code-big { font-size: clamp(48px, 16vw, 110px); font-weight: 900; letter-spacing: 10px; color: #ffd24a; text-align:center; }
  .players { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .prow { display: flex; align-items: center; gap: 10px; background: #1a1826; border-radius: 12px; padding: 8px 12px; }
  .dot { width: 26px; height: 26px; border-radius: 50%; flex: 0 0 auto; }
  .rotate { position: fixed; inset: 0; display:none; align-items: center; justify-content: center; background: #0a0a0f; z-index: 50; font-size: 22px; text-align:center; padding: 30px; }
  .rotate.show { display: flex; }
  .menu-btn { position: fixed; top: 10px; right: 10px; z-index: 20; background: rgba(0,0,0,0.4); border: none; color: #fff; font-size: 20px; width: 40px; height: 40px; border-radius: 10px; }
  .facewrap { display:flex; flex-direction:column; align-items:center; gap:8px; }
  canvas.doodle { background:#fff; border-radius: 14px; touch-action: none; }
  .swatch { width: 30px; height: 30px; border-radius: 50%; border: 3px solid transparent; cursor:pointer; }
  .swatch.sel { border-color: #fff; }
  .small { font-size: 13px; color:#9aa0b4; }
  .results-list { display:flex; flex-direction:column; gap:8px; width:100%; }
  .place { display:flex; align-items:center; gap:12px; background:#1a1826; padding:10px 14px; border-radius:12px; }
  .place .n { font-weight:900; font-size:22px; width:28px; }
  `;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
}
