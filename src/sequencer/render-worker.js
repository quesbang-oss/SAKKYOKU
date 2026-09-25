import { renderProject } from './render.js';
const assets = new Map();
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'assets') { for (const a of data.list) assets.set(a.id, { sr: a.sr, ch: a.ch }); self.postMessage({ type: 'assets-ok', tag: data.tag }); }
    else if (data.type === 'render') {
      const r = await renderProject(data.project, (id) => assets.get(id), { ...data.opts, onProgress: (p) => self.postMessage({ type: 'progress', job: data.job, p }) });
      self.postMessage({ type: 'done', job: data.job, r }, [r.L.buffer, r.R.buffer]);
    }
  } catch (e) { self.postMessage({ type: 'error', job: data && data.job, message: String((e && e.stack) || e) }); }
};
