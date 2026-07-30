const STORAGE_KEY = "anota-sync-enabled";

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

export function isSyncEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export function setSyncEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, String(enabled));
  listeners.forEach((fn) => fn(enabled));
}

export function onSyncToggle(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
