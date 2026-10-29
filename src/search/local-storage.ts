export function readLocalStorage(key: string): string | null | undefined {
  try { return localStorage.getItem(key); } catch { return undefined; }
}

export function writeLocalStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable. */ }
}
