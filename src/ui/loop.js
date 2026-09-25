// 共通の描画ループ（requestAnimationFrame）。タブが非表示のときは停止
const ticks = new Set(); let running = false;
function frame(t) { if (!ticks.size || document.hidden) { running = false; return; } for (const f of ticks) { try { f(t); } catch (e) { console.error(e); } } requestAnimationFrame(frame); }
export function addTick(fn) { ticks.add(fn); if (!running) { running = true; requestAnimationFrame(frame); } return () => ticks.delete(fn); }
document.addEventListener('visibilitychange', () => { if (!document.hidden && ticks.size && !running) { running = true; requestAnimationFrame(frame); } });
