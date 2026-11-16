const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
/** Public URL for an extracted icon path like "icons/foo.png". */
export const iconUrl = (p) => (p ? base + p : undefined);
export const fmt = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString());
