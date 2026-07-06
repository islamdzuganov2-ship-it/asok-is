/**
 * setup.ts — стаб localStorage для юнит-тестов (среда node, без DOM).
 * Слайсы governance/dynamics читают localStorage при инициализации модуля.
 */
const store = new Map<string, string>();

(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};
