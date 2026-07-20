type Listener = (ts: string) => void;
let _lastSync: string | null = null;
const listeners = new Set<Listener>();

export function getLastSync(): string | null {
  return _lastSync;
}

export function notifySync(ts: string) {
  _lastSync = ts;
  listeners.forEach((fn) => fn(ts));
}

export function onSync(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
