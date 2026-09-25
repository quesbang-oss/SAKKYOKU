// AudioWorklet: 入力を取り込み、チャンクをメインスレッドへ送る
class RecProcessor extends AudioWorkletProcessor {
  constructor(opts) {
    super(); this.rec = false; this.ch = (opts.processorOptions && opts.processorOptions.channels) || 1; this.acc = [new Float32Array(2048), new Float32Array(2048)]; this.fill = 0; this.pk = 0; this.cnt = 0; this.sq = 0;
    this.port.onmessage = ({ data }) => { if (data.type === 'rec') { this.rec = !!data.on; if (!this.rec) this.flush(); } if (data.type === 'channels') this.ch = data.n; };
  }
  flush() { if (this.fill > 0) { this.port.postMessage({ type: 'chunk', ch: this.acc.slice(0, this.ch).map((a) => a.slice(0, this.fill)) }); this.fill = 0; } }
  process(inputs) {
    const inp = inputs[0]; if (!inp || !inp.length) return true;
    const n = inp[0].length; let pk = 0, sq = 0;
    for (let i = 0; i < n; i++) { const v = Math.abs(inp[0][i]); if (v > pk) pk = v; sq += inp[0][i] * inp[0][i]; }
    this.pk = Math.max(this.pk, pk); this.sq += sq; this.cnt += n;
    if (this.rec) {
      for (let i = 0; i < n; i++) { this.acc[0][this.fill] = inp[0][i]; this.acc[1][this.fill] = (inp[1] || inp[0])[i]; this.fill++; if (this.fill >= 2048) this.flush(); }
    }
    if (this.cnt >= 1024) { this.port.postMessage({ type: 'level', peak: this.pk, rms: Math.sqrt(this.sq / this.cnt) }); this.pk = 0; this.sq = 0; this.cnt = 0; }
    return true;
  }
}
registerProcessor('vdaw-rec', RecProcessor);
