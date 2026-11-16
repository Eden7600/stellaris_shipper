/** Tech keys plus all their prerequisites. */
export function techClosure(game, keys) {
  const byKey = new Map(game.techs.map((t) => [t.key, t]));
  const out = new Set();
  const visit = (k) => {
    if (out.has(k) || !byKey.has(k)) return;
    out.add(k);
    byKey.get(k).prerequisites.forEach(visit);
  };
  keys.forEach(visit);
  return out;
}

/** Techs that (transitively) require `key`. */
export function dependents(game, key) {
  const out = new Set();
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of game.techs) {
      if (!out.has(t.key) && t.prerequisites.some((p) => p === key || out.has(p))) { out.add(t.key); grew = true; }
    }
  }
  return out;
}
