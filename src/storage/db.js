// IndexedDB ラッパー：素材・プロジェクト・バックアップ・録音復旧データ・プリセット
const DB_NAME = 'voice-daw', VER = 1, STORES = ['assets', 'projects', 'backups', 'recovery', 'presets', 'kv'];
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return rej(new Error('IndexedDBが使えません'));
    const r = indexedDB.open(DB_NAME, VER);
    r.onupgradeneeded = () => { const db = r.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error || new Error('DBを開けません')); r.onblocked = () => rej(new Error('DBがブロックされています'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(store, mode), s = t.objectStore(store); let out; try { out = fn(s); } catch (e) { rej(e); return; } t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('トランザクション中断')); });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
export const db = {
  async put(store, key, val) { const d = await open(); return req(d.transaction(store, 'readwrite').objectStore(store).put(val, key)); },
  async get(store, key) { const d = await open(); return req(d.transaction(store, 'readonly').objectStore(store).get(key)); },
  async del(store, key) { const d = await open(); return req(d.transaction(store, 'readwrite').objectStore(store).delete(key)); },
  async keys(store) { const d = await open(); return req(d.transaction(store, 'readonly').objectStore(store).getAllKeys()); },
  async all(store) { const d = await open(); const s = d.transaction(store, 'readonly').objectStore(store); const [k, v] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]); return k.map((key, i) => ({ key, value: v[i] })); },
  async clear(store) { const d = await open(); return req(d.transaction(store, 'readwrite').objectStore(store).clear()); },
  async estimate() { try { return await navigator.storage.estimate(); } catch { return null; } },
  async persist() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; } },
};
export async function kvGet(k, def) { try { const v = await db.get('kv', k); return v === undefined ? def : v; } catch { return def; } }
export async function kvSet(k, v) { try { await db.put('kv', k, v); } catch (e) { console.warn(e); } }
