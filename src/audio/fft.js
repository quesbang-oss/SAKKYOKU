// 基数2のFFT（in-place）。ブラウザ・Worker・AudioWorklet共通で使用
export class FFT {
  constructor(n) {
    this.n = n; this.cos = new Float64Array(n / 2); this.sin = new Float64Array(n / 2); this.rev = new Uint32Array(n);
    for (let i = 0; i < n / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = Math.sin((2 * Math.PI * i) / n); }
    let bits = 0; while (1 << bits < n) bits++;
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); this.rev[i] = r; }
  }
  transform(re, im, inverse = false) {
    const n = this.n, rev = this.rev;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const c = this.cos[k], s = inverse ? this.sin[k] : -this.sin[k];
          const l = j + half, tr = re[l] * c - im[l] * s, ti = re[l] * s + im[l] * c;
          re[l] = re[j] - tr; im[l] = im[j] - ti; re[j] += tr; im[j] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}
const cache = new Map();
export function getFFT(n) { let f = cache.get(n); if (!f) { f = new FFT(n); cache.set(n, f); } return f; }
export function hann(n) { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); return w; }

// ストリーミングSTFT（オーバーラップ加算）。fn(re,im,ch) でスペクトルを加工する
export class StreamSTFT {
  constructor(N, hop, fn) {
    this.N = N; this.hop = hop; this.fn = fn; this.fft = getFFT(N); this.win = hann(N);
    this.inBuf = new Float32Array(N); this.acc = new Float32Array(N); this.pos = 0; this.cnt = 0;
    this.re = new Float64Array(N); this.im = new Float64Array(N);
    this.scale = 1 / ((3 / 8) * (N / hop)); // hann^2 の重なり和で正規化
  }
  reset() { this.inBuf.fill(0); this.acc.fill(0); this.pos = 0; this.cnt = 0; }
  process(x, out, n) {
    const { N, hop, win, re, im, inBuf, acc } = this;
    for (let i = 0; i < n; i++) {
      inBuf[this.pos] = x[i]; out[i] = acc[this.pos]; acc[this.pos] = 0;
      this.pos = (this.pos + 1) % N;
      if (++this.cnt >= hop) {
        this.cnt = 0;
        for (let k = 0; k < N; k++) { re[k] = inBuf[(this.pos + k) % N] * win[k]; im[k] = 0; }
        this.fft.transform(re, im, false);
        this.fn(re, im);
        this.fft.transform(re, im, true);
        for (let k = 0; k < N; k++) acc[(this.pos + k) % N] += re[k] * win[k] * this.scale;
      }
    }
  }
}
