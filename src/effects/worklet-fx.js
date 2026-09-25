// AudioWorklet: エフェクトチェーンをオーディオスレッドで実行（低遅延ライブ処理）
import { Chain } from './registry.js';
class FxProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.chain = new Chain(sampleRate); this.bypass = false;
    this.port.onmessage = ({ data }) => {
      try {
        if (data.type === 'sync') this.chain.sync(data.fx);
        else if (data.type === 'param') this.chain.setParam(data.id, data.k, data.v);
        else if (data.type === 'res') this.chain.setResource(data.name, data.data);
        else if (data.type === 'bypass') this.bypass = !!data.on;
        else if (data.type === 'reset') this.chain.reset();
      } catch (e) { this.port.postMessage({ type: 'error', message: String(e && e.message || e) }); }
    };
    this.port.postMessage({ type: 'ready' });
  }
  process(inputs, outputs) {
    const out = outputs[0], inp = inputs[0]; if (!out || !out.length) return true;
    const n = out[0].length, L = out[0], R = out[1] || out[0];
    if (inp && inp.length) { L.set(inp[0]); if (out[1]) R.set(inp[1] || inp[0]); } else { L.fill(0); if (out[1]) R.fill(0); }
    if (!this.bypass && this.chain.slots.length) {
      if (!out[1]) { this.chain.process(L, L, n); } else this.chain.process(L, R, n);
    }
    return true;
  }
}
registerProcessor('vdaw-fx', FxProcessor);
