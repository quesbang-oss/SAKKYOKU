import { bus } from '../utils/bus.js';
export const midiState = { access: null, inputs: [], status: '未接続', supported: typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess };
export async function initMIDI() {
  if (!midiState.supported) { midiState.status = 'このブラウザはWeb MIDIに非対応です'; bus.emit('midi:status'); return false; }
  try {
    midiState.access = await navigator.requestMIDIAccess({ sysex: false });
    const attach = () => { midiState.inputs = []; midiState.access.inputs.forEach((i) => { midiState.inputs.push(i.name); i.onmidimessage = onMsg; }); midiState.status = midiState.inputs.length ? 'MIDI入力: ' + midiState.inputs.join(', ') : 'MIDI機器が見つかりません'; bus.emit('midi:status'); };
    midiState.access.onstatechange = attach; attach(); return true;
  } catch (e) { midiState.status = 'MIDIの許可が得られませんでした（' + (e.name || 'error') + '）'; bus.emit('midi:status'); return false; }
}
function onMsg(e) {
  const [st, d1, d2] = e.data, cmd = st & 0xf0, ch = st & 0x0f;
  if (cmd === 0x90 && d2 > 0) bus.emit('midi:noteon', d1, d2 / 127, ch);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) bus.emit('midi:noteoff', d1, ch);
  else if (cmd === 0xb0 && d1 === 64) bus.emit('midi:sustain', d2 >= 64);
}
// 標準MIDIファイル(SMF format 0)を作る。notes: [{start(s),dur(s),midi,vel}]
export function notesToSMF(notes, bpm = 120, name = 'Voice') {
  const PPQ = 480, tps = (PPQ * bpm) / 60, ev = [];
  for (const n of notes) { const on = Math.round(n.start * tps), off = Math.max(on + 1, Math.round((n.start + n.dur) * tps)); ev.push({ t: on, d: [0x90, n.midi & 127, Math.max(1, Math.min(127, n.vel || 90))] }, { t: off, d: [0x80, n.midi & 127, 0] }); }
  ev.sort((a, b) => a.t - b.t || (a.d[0] === 0x80 ? -1 : 1));
  const vlq = (v) => { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; };
  const trk = []; const mpqn = Math.round(60000000 / bpm); trk.push(0, 0xff, 0x51, 3, (mpqn >> 16) & 255, (mpqn >> 8) & 255, mpqn & 255);
  const nm = Array.from(new TextEncoder().encode(name)); trk.push(0, 0xff, 0x03, nm.length, ...nm);
  let last = 0; for (const e of ev) { trk.push(...vlq(e.t - last), ...e.d); last = e.t; } trk.push(0, 0xff, 0x2f, 0);
  const hdr = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, PPQ >> 8, PPQ & 255], len = trk.length;
  return new Blob([new Uint8Array([...hdr, 0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...trk])], { type: 'audio/midi' });
}
