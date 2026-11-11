// Per-browser view settings (Focus, Easy Wins). Storage can be unavailable; then defaults apply.
const PREFIX = 'bandwidth:';

export function loadPref(name, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(name, value) {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {}
}
