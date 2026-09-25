import { engine } from '../audio/engine.js';
import { app } from '../app.js';
import { bus } from '../utils/bus.js';
import { renderMix } from './renderer.js';
import { projectEnd } from './render.js';
import { toast } from '../utils/dom.js';

class Transport {
  constructor() { this.playing = false; this.pos = 0; this.cache = null; this.src = null; this.startCtx = 0; this.startPos = 0; this.rendering = false; this.metroTimer = null; this.nextBeat = 0; }
  get duration() { return projectEnd(app.project); }
  async ensureMix(force) {
    if (!force && this.cache && this.cache.rev === app.rev && this.cache.sr === engine.sr) return this.cache;
    if (this.rendering) return this.renderPromise;
    this.rendering = true; bus.emit('render:start');
    this.renderPromise = (async () => {
      try {
        const P = JSON.parse(JSON.stringify(app.project)), rev = app.rev;
        const r = await renderMix(P, { sr: engine.sr, tail: 2, onProgress: (p) => bus.emit('render:progress', p) });
        const ab = engine.ctx.createBuffer(2, r.L.length, r.sr); ab.copyToChannel(r.L, 0); ab.copyToChannel(r.R, 1);
        this.cache = { rev, sr: engine.sr, ab, r }; return this.cache;
      } finally { this.rendering = false; bus.emit('render:end'); }
    })();
    return this.renderPromise;
  }
  async play(from) {
    try { await engine.init(); } catch (e) { bus.emit('error', e); return; }
    if (this.playing) this.stopSource();
    if (from !== undefined) this.pos = from;
    let c; try { c = await this.ensureMix(); } catch (e) { bus.emit('error', Object.assign(new Error(e.message), { title: '音声処理に失敗しました', help: 'エフェクトの設定を見直すか、プロジェクトを保存してページを再読み込みしてください。' })); return; }
    const P = app.project; if (c.ab.duration <= 0.01 || !P.tracks.some((t) => t.clips.length)) { toast('タイムラインに素材またはドラムクリップを置くと再生できます', 'warn'); return; }
    if (P.loop.on && (this.pos >= P.loop.end || this.pos < P.loop.start)) this.pos = P.loop.start;
    if (this.pos >= c.ab.duration - 0.02) this.pos = 0;
    const src = engine.ctx.createBufferSource(); src.buffer = c.ab; src.connect(engine.playGain);
    if (P.loop.on && P.loop.end - P.loop.start > 0.05) { src.loop = true; src.loopStart = P.loop.start; src.loopEnd = Math.min(P.loop.end, c.ab.duration); }
    this.startCtx = engine.ctx.currentTime + 0.03; this.startPos = this.pos; src.start(this.startCtx, this.pos); this.src = src;
    src.onended = () => { if (this.src === src) { this.src = null; if (this.playing) { this.playing = false; this.pos = 0; this.stopMetro(); bus.emit('transport', 'stop'); } } };
    this.playing = true; this.startMetro(); bus.emit('transport', 'play');
  }
  stopSource() { if (this.src) { try { this.src.onended = null; this.src.stop(); } catch {} this.src = null; } }
  currentPos() {
    if (!this.playing) return this.pos; const P = app.project; let t = this.startPos + (engine.ctx.currentTime - this.startCtx);
    if (P.loop.on && this.src && this.src.loop) { const s = P.loop.start, e = Math.min(P.loop.end, this.cache ? this.cache.ab.duration : P.loop.end); if (t >= e) t = s + ((t - s) % (e - s)); }
    return Math.max(0, t);
  }
  pause() { if (!this.playing) return; this.pos = this.currentPos(); this.stopSource(); this.playing = false; this.stopMetro(); bus.emit('transport', 'pause'); }
  stop() { this.stopSource(); this.playing = false; this.pos = app.project.loop.on ? app.project.loop.start : 0; this.stopMetro(); bus.emit('transport', 'stop'); }
  toggle() { if (this.playing) this.pause(); else this.play(); }
  seek(t) { this.pos = Math.max(0, t); if (this.playing) this.play(this.pos); else bus.emit('transport', 'seek'); }
  // スクラブ：ドラッグ位置の短い音を鳴らす
  scrub(t) { const c = this.cache; if (!c || c.rev !== app.rev || !engine.ctx) return; try { const s = engine.ctx.createBufferSource(); s.buffer = c.ab; const g = engine.ctx.createGain(); g.gain.setValueAtTime(0.8, engine.ctx.currentTime); g.gain.setTargetAtTime(0, engine.ctx.currentTime + 0.07, 0.02); s.connect(g); g.connect(engine.playGain); s.start(0, Math.max(0, Math.min(c.ab.duration - 0.1, t)), 0.12); } catch {} }
  // メトロノーム
  startMetro() { this.stopMetro(); if (!app.project.metronome) return; const P = app.project, beat = 60 / P.bpm; this.nextBeat = Math.ceil(this.currentPos() / beat - 1e-6);
    this.metroTimer = setInterval(() => { if (!this.playing || !app.project.metronome) return; const pos = this.currentPos(), ahead = pos + 0.15; const b = 60 / app.project.bpm;
      while (this.nextBeat * b < ahead) { const bt = this.nextBeat * b; if (bt >= pos - 0.02) { const at = engine.ctx.currentTime + Math.max(0, bt - pos); this.click(at, this.nextBeat % app.project.sig[0] === 0); } this.nextBeat++; const L = app.project.loop; if (L.on && this.nextBeat * b >= L.end - 1e-6) this.nextBeat = Math.ceil(L.start / b - 1e-6); } }, 25); }
  stopMetro() { clearInterval(this.metroTimer); this.metroTimer = null; }
  click(at, accent) { const c = engine.ctx, o = c.createOscillator(), g = c.createGain(); o.frequency.value = accent ? 1500 : 1000; g.gain.setValueAtTime(0.0001, at); g.gain.linearRampToValueAtTime(0.25, at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05); o.connect(g); g.connect(engine.master); o.start(at); o.stop(at + 0.06); }
}
export const transport = new Transport();
bus.on('project:changed', () => { /* 再生中に編集された場合は次回再生時に再レンダリング */ });
