export class Bus {
  constructor() { this.m = new Map(); }
  on(e, f) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e).add(f); return () => this.off(e, f); }
  off(e, f) { this.m.get(e)?.delete(f); }
  emit(e, ...a) { this.m.get(e)?.forEach((f) => { try { f(...a); } catch (err) { console.error('bus error', e, err); } }); }
}
export const bus = new Bus();
