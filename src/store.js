// localStorage with a safety net (private mode / blocked storage must never break the app).
export const load = (k, fallback = null) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
export const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
};
export const wipe = (...keys) => { for (const k of keys) try { localStorage.removeItem(k); } catch { /* ignore */ } };
