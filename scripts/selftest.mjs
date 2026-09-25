// Voice DAW セルフテスト: DSP・解析・プロジェクト全体のミックスダウン・書き出しパイプラインを
// ブラウザなしで検証する回帰テスト。 `npm test` で実行。
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => path.join(root, '..', 'src', p);

const { EFFECTS, processBuffer, newFx } = await import(src('effects/registry.js'));
const { detectPitch } = await import(src('analysis/pitch.js'));
const { estimateBPM, autoChop, detectSilence, pitchTrack, pitchToNotes, integratedLufs, computeNoiseProfile } = await import(src('analysis/analyze.js'));
const { timeStretch, normalize, applyEffects } = await import(src('audio/edit.js'));
const { hzToMidi } = await import(src('utils/util.js'));
const { renderProject, projectEnd } = await import(src('sequencer/render.js'));
const { newProject, newTrack, newClip, newDrumClip } = await import(src('timeline/project.js'));
const { defaultPattern } = await import(src('audio/drums.js'));
const { encodeWav } = await import(src('export/wav.js'));
const { notesToSMF } = await import(src('midi/midi.js'));
const { BUILTIN_PRESETS, ELECTRONIZE_PRESETS, presetToFx, randomChain } = await import(src('effects/presets.js'));

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok -', name); }
  catch (e) { fail++; console.error('  FAIL -', name, '\n     ', e && e.message); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ok -', name); }
  catch (e) { fail++; console.error('  FAIL -', name, '\n     ', e && e.message); }
}

const sr = 44100;
function sine(f, secs, sr2 = sr) { const n = Math.round(secs * sr2), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin((2 * Math.PI * f * i) / sr2); return x; }
function isFiniteBuf(a) { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }
function peakOf(a) { let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return p; }

console.log('== 1. 全エフェクトの基本動作（NaN/爆音なし） ==');
{
  const x = sine(220, 1.5); for (let i = 0; i < x.length; i++) x[i] += (Math.random() - 0.5) * 0.02;
  for (const type of Object.keys(EFFECTS)) {
    test('effect:' + type, () => {
      const out = processBuffer(sr, [x, x], [newFx(type)]);
      assert.ok(isFiniteBuf(out[0]) && isFiniteBuf(out[1]), 'NaN/Infinityが含まれています');
      assert.ok(peakOf(out[0]) < 20 && peakOf(out[1]) < 20, 'ピークが異常に大きい: ' + peakOf(out[0]));
    });
  }
}

console.log('== 2. ピッチ・フォルマント・ボコーダーの精度 ==');
test('pitch shift +12半音でオクターブ上がる', () => { const x = sine(220, 2); const o = processBuffer(sr, [x, x], [newFx('pitch', { semi: 12 })]); const f0 = detectPitch(o[0], sr, 2048, sr, 300, 700).f0; assert.ok(Math.abs(f0 - 440) < 15, 'f0=' + f0); });
test('pitch shift -12半音でオクターブ下がる', () => { const x = sine(220, 2); const o = processBuffer(sr, [x, x], [newFx('pitch', { semi: -12 })]); const f0 = detectPitch(o[0], sr, 2048, sr, 60, 200).f0; assert.ok(Math.abs(f0 - 110) < 10, 'f0=' + f0); });
test('ハードチューン(クロマチック)が最寄りの半音に補正する', () => { const x = sine(226, 3); const o = processBuffer(sr, [x, x], [newFx('hardtune', { scale: 0, key: 0, speed: 1 })]); const f0 = detectPitch(o[0], sr * 2, 2048, sr, 150, 350).f0; const midi = hzToMidi(f0); assert.ok(Math.abs(midi - Math.round(midi)) < 0.15, 'midi=' + midi); });
test('フォルマントシフトはピッチを変えない', () => { const x = sine(220, 1.5); const o = processBuffer(sr, [x, x], [newFx('formant', { shift: 5 })]); const f0 = detectPitch(o[0], sr * 0.5, 2048, sr, 150, 350).f0; assert.ok(Math.abs(f0 - 220) < 8, 'f0=' + f0); });
test('ノイズ抑制でノイズのみ区間のRMSが下がる', () => { const n = new Float32Array(sr * 2); for (let i = 0; i < n.length; i++) n[i] = (Math.random() - 0.5) * 0.1; const o = processBuffer(sr, [n, n], [newFx('nr', { strength: 0.8 })]); const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length); assert.ok(rms(o[0]) < rms(n) * 0.8, '抑制されていない'); });
test('ボコーダーが無音にならない', () => { const v = new Float32Array(sr); for (let i = 0; i < v.length; i++) v[i] = 0.5 * Math.sin((2 * Math.PI * 400 * i) / sr) * (Math.sin((2 * Math.PI * 3 * i) / sr) > 0 ? 1 : 0); const o = processBuffer(sr, [v, v], [newFx('vocoder')]); assert.ok(peakOf(o[0]) > 0.05, 'peak=' + peakOf(o[0])); });

console.log('== 3. 解析（BPM・ピッチ→ノート・無音検出・LUFS・ノイズプロファイル） ==');
test('クリックトラックからBPMを推定できる', () => { const x = new Float32Array(sr * 8); for (let b = 0; b < 16; b++) { const p = Math.round(b * 0.5 * sr); for (let i = 0; i < 2000 && p + i < x.length; i++) x[p + i] += Math.exp(-i / 300) * Math.sin(i * 0.3) * 0.8; } const { bpm } = estimateBPM(x, sr); assert.ok(Math.abs(bpm - 120) < 2, 'bpm=' + bpm); });
test('自動分割で5音節を検出できる', () => { const v = new Float32Array(sr * 4); [0.2, 0.9, 1.6, 2.3, 3.0].forEach((t, k) => { const f = [261.6, 329.6, 392, 329.6, 261.6][k]; for (let i = 0; i < sr * 0.5; i++) v[Math.round(t * sr) + i] += 0.5 * Math.sin((2 * Math.PI * f * i) / sr) * Math.min(1, i / 500, (sr * 0.5 - i) / 500); }); const segs = autoChop(v, sr, 0.5); assert.equal(segs.length, 5, '検出数=' + segs.length); });
test('ピッチ→ノート変換でドミソミドが取れる', () => { const v = new Float32Array(sr * 4); [0.2, 0.9, 1.6, 2.3, 3.0].forEach((t, k) => { const f = [261.6, 329.6, 392, 329.6, 261.6][k]; for (let i = 0; i < sr * 0.5; i++) v[Math.round(t * sr) + i] += 0.5 * Math.sin((2 * Math.PI * f * i) / sr) * Math.min(1, i / 500, (sr * 0.5 - i) / 500); }); const notes = pitchToNotes(pitchTrack(v, sr)); assert.deepEqual(notes.map((n) => n.midi), [60, 64, 67, 64, 60]); });
test('無音区間を検出できる', () => { const v = new Float32Array(sr * 2); for (let i = 0; i < sr * 0.5; i++) v[i] = 0.3 * Math.sin((2 * Math.PI * 300 * i) / sr); const segs = detectSilence(v, sr, -45, 200); assert.ok(segs.length >= 1); });
test('LUFSが有限値で妥当な範囲', () => { const v = sine(300, 2); const l = integratedLufs([v, v], sr); assert.ok(isFinite(l) && l < 0 && l > -40, 'lufs=' + l); });
test('ノイズプロファイルのビン数が正しい', () => { const n = new Float32Array(sr); for (let i = 0; i < n.length; i++) n[i] = (Math.random() - 0.5) * 0.1; const p = computeNoiseProfile(n, 0, n.length); assert.equal(p.length, 513); });
test('タイムストレッチで長さが変わりピッチはほぼ保持', () => { const v = sine(300, 2); const s = timeStretch({ sr, ch: [v] }, 1.5); assert.ok(Math.abs(s.ch[0].length / sr - 3) < 0.05); const f0 = detectPitch(s.ch[0], Math.round(0.3 * sr * 1.5), 2048, sr, 200, 400).f0; assert.ok(Math.abs(f0 - 300) < 10, 'f0=' + f0); });
test('ノーマライズでピーク音量が指定dBに近づく', () => { const v = sine(300, 1); v[0] = 0.05; const n = normalize({ sr, ch: [v] }, -1); const pk = peakOf(n.ch[0]); const db = 20 * Math.log10(pk); assert.ok(Math.abs(db - -1) < 0.3, 'db=' + db); });

console.log('== 4. プロジェクト全体レンダリング（ドラム+音声トラック+マスター処理） ==');
await atest('renderProjectがドラム+音声のミックスを生成する', async () => {
  const P = newProject('テスト');
  const voice = sine(440, 1.0);
  const assetId = 'ast_test1';
  P.assets.push({ id: assetId, name: 'test', folder: 'VOICE', tags: [], fav: false, kind: 'voice', created: Date.now() });
  const assets = new Map([[assetId, { sr, ch: [voice, voice] }]]);
  const t1 = newTrack(1); t1.clips.push(newClip(assetId, 0, 1.0));
  const t2 = newTrack(2, 'drum'); t2.clips.push(newDrumClip(P.patterns[0].id, 0, 2));
  P.tracks = [t1, t2]; P.bpm = 120;
  const r = await renderProject(P, (id) => assets.get(id), { sr, tail: 0.5 });
  assert.ok(r.L.length > sr * 2, '長さ不足: ' + r.L.length);
  assert.ok(isFiniteBuf(r.L) && isFiniteBuf(r.R), 'NaNが含まれる');
  assert.ok(peakOf(r.L) > 0.01, 'ほぼ無音: peak=' + peakOf(r.L));
  assert.ok(peakOf(r.L) <= 1.01, 'クリップしている: peak=' + peakOf(r.L));
});
await atest('ミュート/ソロが正しく反映される', async () => {
  const P = newProject('ミュートテスト'); const voice = sine(440, 1.0); const assetId = 'ast_m';
  P.assets.push({ id: assetId, name: 'm', folder: 'VOICE', tags: [], fav: false, kind: 'voice', created: Date.now() });
  const assets = new Map([[assetId, { sr, ch: [voice, voice] }]]);
  const t1 = newTrack(1); t1.clips.push(newClip(assetId, 0, 1.0)); t1.mute = true;
  P.tracks = [t1]; P.master.limiter.on = false;
  const r = await renderProject(P, (id) => assets.get(id), { sr, tail: 0.2 });
  assert.ok(peakOf(r.L) < 1e-6, 'ミュートなのに音が出ている: ' + peakOf(r.L));
});
await atest('トラックFX(ディレイ)を通した音がドライと異なる', async () => {
  const P = newProject('FXテスト'); const voice = sine(440, 0.5); const assetId = 'ast_fx';
  P.assets.push({ id: assetId, name: 'fx', folder: 'VOICE', tags: [], fav: false, kind: 'voice', created: Date.now() });
  const assets = new Map([[assetId, { sr, ch: [voice, voice] }]]);
  const t1 = newTrack(1); t1.clips.push(newClip(assetId, 0, 0.5)); t1.fx = [{ id: 'd1', type: 'delay', on: true, mix: 1, params: { time: 200, fb: 0.5, tone: 8000, level: 0.8 } }];
  P.tracks = [t1]; P.master.limiter.on = false;
  const r = await renderProject(P, (id) => assets.get(id), { sr, tail: 1.5 });
  const tailEnergy = peakOf(r.L.slice(Math.round(0.6 * sr), Math.round(1.2 * sr)));
  assert.ok(tailEnergy > 0.02, 'ディレイのテイルが確認できない: ' + tailEnergy);
});

console.log('== 5. エフェクトプリセット・実験モード ==');
test('全てのビルトインプリセットが有効なエフェクトを参照している', () => { for (const p of [...BUILTIN_PRESETS, ...ELECTRONIZE_PRESETS]) { const fx = presetToFx(p); assert.ok(fx.length > 0, p.name + ' が空'); for (const f of fx) assert.ok(EFFECTS[f.type], p.name + ' の ' + f.type + ' が存在しない'); } });
test('プリセットを実際の音声に適用できる（エラーなし）', () => { const v = sine(300, 1); for (const p of BUILTIN_PRESETS) { const out = applyEffects({ sr, ch: [v, v] }, presetToFx(p)); assert.ok(isFiniteBuf(out.ch[0]), p.name + ' でNaN'); } });
test('ランダムチェーンが生成でき適用できる', () => { const v = sine(300, 1); const chain = randomChain(false); const out = applyEffects({ sr, ch: [v, v] }, chain); assert.ok(isFiniteBuf(out.ch[0])); });

console.log('== 6. 書き出し（WAV / MIDI）とプロジェクトの直列化 ==');
test('WAVエンコードのヘッダーとサイズが正しい', () => { const v = sine(300, 0.2); const blob = encodeWav([v, v], sr, 16); const expect = 44 + v.length * 2 * 2; assert.equal(blob.size, expect); });
test('MIDIファイルのヘッダーが正しい(MThd)', async () => { const blob = notesToSMF([{ start: 0, dur: 0.5, midi: 60, vel: 100 }], 120, 'test'); const buf = new Uint8Array(await blob.arrayBuffer()); const hdr = String.fromCharCode(...buf.slice(0, 4)); assert.equal(hdr, 'MThd'); });
test('プロジェクトのJSON往復（新規作成→シリアライズ相当の構造）', () => { const P = newProject('往復テスト'); const json = JSON.stringify(P); const P2 = JSON.parse(json); assert.equal(P2.name, '往復テスト'); assert.equal(P2.tracks.length, 1); assert.equal(P2.patterns.length, 1); });
test('projectEndがクリップの終端を正しく計算する', () => { const P = newProject('end'); P.tracks[0].clips.push(newClip('a', 2, 3)); assert.equal(projectEnd(P), 5); });

console.log(`\n合計: ${pass} 件成功 / ${fail} 件失敗`);
if (fail > 0) process.exit(1);
