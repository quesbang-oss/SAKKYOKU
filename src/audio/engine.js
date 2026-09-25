// オーディオエンジン：AudioContext・マイク入力・ライブFX・楽器バス・マスター
import { bus } from '../utils/bus.js';
import { $ } from '../utils/dom.js';

export class AppError extends Error { constructor(title, message, help) { super(message); this.title = title; this.help = help; } }
export function explainMicError(e) {
  const n = e && e.name;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return new AppError('マイクを使えません', 'このブラウザはマイク入力に対応していません。', 'Microsoft Edge または Google Chrome の最新版をお使いください。また、https:// もしくは localhost で開く必要があります。');
  if (n === 'NotAllowedError' || n === 'SecurityError') return new AppError('マイクの許可がありません', 'マイクの使用が許可されていません。', 'アドレスバー左の鍵(またはカメラ)アイコンをクリック→「マイク」を「許可」にして、ページを再読み込みしてください。Windowsの「設定→プライバシーとセキュリティ→マイク」でブラウザが許可されているかも確認してください。');
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return new AppError('マイクが見つかりません', 'マイクが接続されていないか、無効になっています。', 'マイクを接続し直すか、Windowsのサウンド設定で入力デバイスが有効になっているか確認してください。');
  if (n === 'NotReadableError' || n === 'TrackStartError') return new AppError('マイクが使用中です', 'マイクを他のアプリが使っているようです。', 'Zoom / Discord / 他のブラウザタブなどマイクを使うアプリを閉じてからもう一度お試しください。');
  if (n === 'OverconstrainedError') return new AppError('マイク設定が合いません', '選んだマイクまたは設定が使えません。', 'マイクの選択を「既定」に戻すか、チャンネル数をモノラルにしてお試しください。');
  return new AppError('マイクエラー', (e && e.message) || String(e), 'ページを再読み込みして、もう一度お試しください。');
}

class Engine {
  constructor() { this.ctx = null; this.micStream = null; this.settings = { sampleRate: 48000, channels: 1, deviceId: '', monitor: false }; this.workletsReady = false; this.live = { fx: [], mix: 1, bypass: false }; }
  get sr() { return this.ctx ? this.ctx.sampleRate : this.settings.sampleRate; }
  supported() { return !!(window.AudioContext || window.webkitAudioContext) && typeof AudioWorkletNode !== 'undefined'; }
  async init(sampleRate) {
    if (!this.supported()) throw new AppError('対応していないブラウザです', 'Web Audio / AudioWorklet に対応していません。', 'Microsoft Edge または Google Chrome の最新版をお使いください。');
    if (this.ctx && (!sampleRate || this.ctx.sampleRate === sampleRate) && this.ctx.state !== 'closed') { if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {}); return this.ctx; }
    if (this.ctx) { await this.teardown(); }
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ctx = new AC({ sampleRate: sampleRate || this.settings.sampleRate, latencyHint: 'interactive' }); } catch { this.ctx = new AC({ latencyHint: 'interactive' }); }
    this.settings.sampleRate = this.ctx.sampleRate;
    try {
      await this.ctx.audioWorklet.addModule(new URL('../effects/worklet-fx.js', import.meta.url));
      await this.ctx.audioWorklet.addModule(new URL('../recorder/worklet-rec.js', import.meta.url));
    } catch (e) { throw new AppError('音声処理の準備に失敗しました', 'AudioWorkletの読み込みに失敗: ' + (e.message || e), 'ページを再読み込みしてください。ファイルを直接開いた(file://)場合は動作しません。付属のサーバーまたはGitHub Pagesで開いてください。'); }
    this.build(); await this.ctx.resume().catch(() => {}); bus.emit('engine:ready', this.ctx);
    return this.ctx;
  }
  async teardown() { try { this.stopMic(); await this.ctx.close(); } catch {} this.ctx = null; }
  fxNode(chIn = 2) { const n = new AudioWorkletNode(this.ctx, 'vdaw-fx', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: chIn, channelCountMode: 'explicit' }); n.port.onmessage = (e) => { if (e.data.type === 'error') bus.emit('engine:error', e.data.message); }; return n; }
  build() {
    const c = this.ctx, g = () => c.createGain();
    this.master = g(); this.masterFx = this.fxNode(); this.masterAn = c.createAnalyser(); this.masterAn.fftSize = 2048; this.masterAn.smoothingTimeConstant = 0.6;
    this.masterFx.port.postMessage({ type: 'sync', fx: [{ id: 'safety', type: 'limiter', on: true, mix: 1, params: { ceil: -0.3, rel: 100, drive: 0 } }] });
    this.master.connect(this.masterFx); this.masterFx.connect(this.masterAn); this.masterAn.connect(c.destination);
    // 再生用
    this.playGain = g(); this.playGain.connect(this.master);
    // マイク
    this.micTrim = g(); this.micDry = g(); this.micWet = g(); this.monitor = g(); this.monitor.gain.value = 0;
    this.micFx = this.fxNode(2); this.micAn = c.createAnalyser(); this.micAn.fftSize = 2048; this.micPostAn = c.createAnalyser(); this.micPostAn.fftSize = 2048;
    this.recNode = new AudioWorkletNode(c, 'vdaw-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { channels: this.settings.channels } });
    this.recSink = g(); this.recSink.gain.value = 0; this.recNode.connect(this.recSink); this.recSink.connect(c.destination);
    this.micTrim.connect(this.micAn); this.micTrim.connect(this.recNode); this.micTrim.connect(this.micFx); this.micTrim.connect(this.micDry);
    this.micFx.connect(this.micWet); this.micWet.connect(this.micPostAn); this.micDry.connect(this.monitor); this.micWet.connect(this.monitor); this.monitor.connect(this.master);
    // 楽器
    this.instIn = g(); this.instFx = this.fxNode(); this.instOut = g(); this.instAn = c.createAnalyser(); this.instAn.fftSize = 2048;
    this.instIn.connect(this.instFx); this.instFx.connect(this.instOut); this.instOut.connect(this.master); this.instOut.connect(this.instAn);
    this.instRec = new AudioWorkletNode(c, 'vdaw-rec', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { channels: 2 } });
    this.instOut.connect(this.instRec); this.instRecSink = g(); this.instRecSink.gain.value = 0; this.instRec.connect(this.instRecSink); this.instRecSink.connect(c.destination);
    // プレビュー
    this.preview = g(); this.preview.connect(this.master);
    this.setLiveMix(1);
  }
  async listInputs() { try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter((x) => x.kind === 'audioinput'); } catch { return []; } }
  async startMic(opts = {}) {
    await this.init(opts.sampleRate || this.settings.sampleRate);
    Object.assign(this.settings, opts);
    this.stopMic();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw explainMicError(null);
    const a = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: this.settings.channels, latency: 0 };
    if (this.settings.deviceId) a.deviceId = { exact: this.settings.deviceId };
    try { this.micStream = await navigator.mediaDevices.getUserMedia({ audio: a }); }
    catch (e) { if (e && e.name === 'OverconstrainedError' && this.settings.deviceId) { this.settings.deviceId = ''; delete a.deviceId; try { this.micStream = await navigator.mediaDevices.getUserMedia({ audio: a }); } catch (e2) { throw explainMicError(e2); } } else throw explainMicError(e); }
    this.micSrc = this.ctx.createMediaStreamSource(this.micStream);
    this.micSrc.connect(this.micTrim);
    this.micStream.getAudioTracks()[0].addEventListener('ended', () => { bus.emit('mic:ended'); this.stopMic(); });
    this.recNode.port.postMessage({ type: 'channels', n: this.settings.channels });
    bus.emit('mic:started'); return this.micStream;
  }
  stopMic() { try { this.micSrc && this.micSrc.disconnect(); } catch {} this.micSrc = null; if (this.micStream) { this.micStream.getTracks().forEach((t) => t.stop()); this.micStream = null; bus.emit('mic:stopped'); } }
  get micActive() { return !!this.micStream; }
  setMonitor(on) { this.settings.monitor = on; if (this.monitor) this.monitor.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02); }
  setLiveMix(m) { this.live.mix = m; if (!this.ctx) return; const t = this.ctx.currentTime; this.micWet.gain.setTargetAtTime(this.live.bypass ? 0 : m, t, 0.02); this.micDry.gain.setTargetAtTime(this.live.bypass ? 1 : 1 - m, t, 0.02); }
  setBypass(b) { this.live.bypass = b; this.setLiveMix(this.live.mix); }
  setLiveFx(list) { this.live.fx = list; this.micFx && this.micFx.port.postMessage({ type: 'sync', fx: list }); }
  setInstFx(list) { this.instFx && this.instFx.port.postMessage({ type: 'sync', fx: list }); }
  setMasterVolume(v) { if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01); }
  setResource(name, data) { for (const n of [this.micFx, this.instFx]) n && n.port.postMessage({ type: 'res', name, data }); }
  // メーター取得
  static level(an) { if (!an) return { peak: 0, rms: 0 }; const buf = Engine._b && Engine._b.length === an.fftSize ? Engine._b : (Engine._b = new Float32Array(an.fftSize)); an.getFloatTimeDomainData(buf); let p = 0, s = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; if (Math.abs(v) > p) p = Math.abs(v); s += v * v; } return { peak: p, rms: Math.sqrt(s / buf.length) }; }
  playBuffer(buf, { gain = 1, when = 0, offset = 0, dur, dest, loop = false, rate = 1 } = {}) {
    const ab = this.ctx.createBuffer(buf.ch.length, buf.ch[0].length, buf.sr); buf.ch.forEach((c, i) => ab.copyToChannel(c, i));
    const src = this.ctx.createBufferSource(); src.buffer = ab; src.loop = loop; src.playbackRate.value = rate; const g = this.ctx.createGain(); g.gain.value = gain; src.connect(g); g.connect(dest || this.preview);
    src.start(when || this.ctx.currentTime, offset, dur); return { src, gain: g };
  }
}
export const engine = new Engine();
export { Engine };
