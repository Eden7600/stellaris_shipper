// Weapon helpers shared by the planner and the enemy model.
export const WEAPON_CLASSES = ['energy', 'kinetic', 'explosive', 'strike_craft'];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isPD = (c) => c.size === 'point_defence';
export const classOf = (c) =>
  c.kind === 'strike_craft' ? 'strike_craft'
    : c.type === 'missile' ? 'explosive'
      : WEAPON_CLASSES.find((k) => c.tags.includes(`weapon_type_${k}`)) ?? null;

/** Normalised weapon stats for any weapon or strike craft component (period in days). */
export function weaponStats(c) {
  const s = c.stats;
  if (c.kind === 'strike_craft') {
    return {
      avg: ((s.damage.min + s.damage.max) / 2) * (s.count ?? 1), period: s.cooldown, range: s.range ?? 125,
      acc: s.accuracy ?? 1, trk: s.tracking ?? 0, sd: s.shield_damage, ad: s.armor_damage, hd: s.hull_damage,
      sp: s.shield_penetration, ap: s.armor_penetration, sizeF: 0,
    };
  }
  return {
    avg: (s.min_damage + s.max_damage) / 2, period: (s.cooldown + ((s.min_windup ?? 0) + (s.max_windup ?? 0)) / 2) / 10, range: s.range,
    acc: s.accuracy, trk: s.tracking, sd: s.shield_damage, ad: s.armor_damage, hd: s.hull_damage,
    sp: s.shield_penetration, ap: s.armor_penetration, sizeF: s.size_damage_factor ?? 0,
  };
}
