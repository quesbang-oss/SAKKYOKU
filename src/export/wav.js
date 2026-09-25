export function encodeWav(chs, sr, bits = 16) {
  const nch = chs.length, len = chs[0].length, bps = bits / 8, dataLen = len * nch * bps, buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true); v.setUint16(34, bits, true); ws(36, 'data'); v.setUint32(40, dataLen, true);
  let p = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < nch; c++) {
    const s = Math.max(-1, Math.min(1, chs[c][i]));
    if (bits === 16) { v.setInt16(p, s < 0 ? s * 32768 : s * 32767, true); p += 2; } else if (bits === 24) { const x = Math.round(s < 0 ? s * 8388608 : s * 8388607); v.setUint8(p, x & 255); v.setUint8(p + 1, (x >> 8) & 255); v.setUint8(p + 2, (x >> 16) & 255); p += 3; } else { v.setFloat32(p, chs[c][i], true); p += 4; }
  }
  return new Blob([buf], { type: 'audio/wav' });
}
