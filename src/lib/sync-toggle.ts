const STORAGE_KEY = "anota-auto-promote";
/** Chave antiga do toggle de sincronização (lida uma vez para migrar a escolha). */
const LEGACY_STORAGE_KEY = "anota-sync-enabled";

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

/** Toggle "Promover agendados automaticamente" (localStorage). */
export function isAutoPromoteEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  return stored === null ? true : stored === "true";
}

export function setAutoPromoteEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, String(enabled));
  listeners.forEach((fn) => fn(enabled));
}

export function onAutoPromoteToggle(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
