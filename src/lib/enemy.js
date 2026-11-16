// Enemy model built from game data:
//  - AI empires: the AI's own fleet rules (ai_ship_data fractions, fleet doctrine composition and roles,
//    weapon/defense preference policies), evaluated at the player's tech level as a parity proxy.
//  - Crises / Fallen Empires / Marauders: their real global_ship_designs (hull, armor, shields, weapons).
// A threat mix blends several of these by weight, e.g. for a general-purpose fleet.
import { WEAPON_CLASSES, classOf, isPD, weaponStats, clamp } from './weapons.js';

export const ANY = 'any';
export const THREAT_PRESETS = {
  general: { label: 'General purpose', mix: [{ id: 'ai', key: 'ai', weight: 4 }, { id: 'fallen', key: 'fallen', weight: 1 }, { id: 'prethoryn', key: 'prethoryn', weight: 1 }, { id: 'unbidden', key: 'unbidden', weight: 1 }, { id: 'contingency', key: 'contingency', weight: 1 }] },
  ai: { label: 'AI rivals', mix: [{ id: 'ai', key: 'ai', weight: 1 }] },
  crisis: { label: 'Endgame crisis', mix: [{ id: 'prethoryn', key: 'prethoryn', weight: 1 }, { id: 'unbidden', key: 'unbidden', weight: 1 }, { id: 'contingency', key: 'contingency', weight: 1 }] },
  fallen: { label: 'Fallen Empires', mix: [{ id: 'fallen', key: 'fallen', weight: 1 }] },
};

// Role the weapon_preference composition boost looks for (inline_scripts/ai/weapon_preference_composition_weight).
const PREF_ROLE = { explosive: 'explosive', energy: 'energy_torpedoes', strike_craft: 'carrier' };
// shortcut: share of AI ships carrying PD/flak outside dedicated screen roles; AI section choice not simulated.
const AI_BASE_PD = 0.2;

const layers = (shield, armor, hull) => {
  const t = shield + armor + hull || 1;
  return { shield: shield / t, armor: armor / t, hull: hull / t };
};

/** What the player's tech level implies for an AI at parity: evasion, defense capacity and weapon stats. */
function parity(game, ctx) {
  const best = (hull, size, key) => Math.max(0, ...ctx.comps
    .filter((c) => c.kind === 'utility' && c.size === size && c.hulls.includes(hull))
    .map((c) => c.modifier?.[key] ?? 0));
  const evasion = {}, defense = {};
  for (const h of ctx.hulls) {
    const thruster = Math.max(0, ...ctx.comps.filter((c) => c.set === 'thruster_components' && c.hulls.includes(h.key))
      .map((c) => (c.modifier?.ship_evasion_add ?? 0) + (c.shipModifier?.ship_evasion_add ?? 0)));
    evasion[h.key] = clamp((h.evasion + thruster) / 100, 0, game.combat.maxEvasion);
    // Utility capacity: per hull slot, the average utility slots of the sections available for it.
    let armor = 0, shield = 0;
    for (const slot of h.slots) {
      const secs = ctx.sections.filter((s) => s.hull === h.key && s.slot === slot);
      for (const size of ['small', 'medium', 'large']) {
        const n = secs.reduce((a, s) => a + s.utility[size], 0) / (secs.length || 1);
        armor += n * best(h.key, size, 'ship_armor_add');
        shield += n * best(h.key, size, 'ship_shield_add');
      }
    }
    defense[h.key] = { armor, shield };
  }
  const classStats = {};
  for (const cls of WEAPON_CLASSES) {
    const usable = (pool) => pool.filter((c) => classOf(c) === cls && !isPD(c) && (c.kind === 'strike_craft' || c.stats.max_damage));
    const pool = usable(ctx.comps).length ? usable(ctx.comps) : usable(game.components);
    const mean = (f) => pool.reduce((a, c) => a + f(weaponStats(c)), 0) / (pool.length || 1);
    classStats[cls] = { sd: mean((s) => s.sd), ad: mean((s) => s.ad), hd: mean((s) => s.hd), sp: mean((s) => s.sp),
      ap: mean((s) => s.ap), acc: mean((s) => s.acc), trk: mean((s) => s.trk) };
  }
  return { evasion, defense, classStats, hasCraft: ctx.comps.some((c) => c.kind === 'strike_craft') };
}

/** Weapon classes an AI ship of `role` carries, given its weapon preference. */
function roleWeapons(role, pref, par) {
  const gun = pref === 'strike_craft' ? { energy: 0.5, kinetic: 0.5 } : { [pref]: 1 };
  if (role === 'explosive') return { explosive: 1 };
  if (role === 'energy_torpedoes') return { energy: 1 };
  if (role === 'carrier') return par.hasCraft ? { strike_craft: 0.5, ...Object.fromEntries(Object.entries(gun).map(([k, v]) => [k, v / 2])) } : gun;
  return gun;
}

function aiProfile(game, ctx, par, doctrine, pref, defense) {
  const ai = game.ai, d = ai.doctrines[doctrine], dp = ai.defensePrefs[defense];
  const targets = [], weapons = [];
  let total = 0, screen = 0;
  for (const hull of ctx.hulls) {
    const h = ai.hulls[hull.key];
    if (!h) continue; // titans are capped separately (ai_ship_data min/max); not in the line composition
    const roles = d.roles[hull.key] ?? { gunship: 100 };
    const roleSum = Object.values(roles).reduce((a, b) => a + b, 0) || 1;
    let frac = h.base * (h.taper && ctx.researched.has(h.taper.tech) ? h.taper.factor : 1) * (h.doctrine[doctrine] ?? 1);
    if (h.weaponPrefBoost) frac *= 1 + (ai.weaponPrefFavored - 1) * ((roles[PREF_ROLE[pref]] ?? 0) / roleSum);
    if (!frac) continue;
    total += frac;
    const def = par.defense[hull.key];
    // shortcut: ai_ship_data fractions read as naval-capacity shares, so ship count = fraction / hull size
    targets.push({ label: hull.name, share: frac / hull.navalCap, evasion: par.evasion[hull.key], size: hull.navalCap,
      layers: layers(def.shield * dp.shields, def.armor * dp.armor, hull.hp) });
    for (const [role, w] of Object.entries(roles)) {
      const share = (frac * w) / roleSum;
      if (role === 'screen') screen += share;
      for (const [cls, k] of Object.entries(roleWeapons(role, pref, par))) weapons.push({ key: cls, share: share * k, ...par.classStats[cls] });
    }
  }
  return { targets, weapons, pd: clamp(AI_BASE_PD + screen / (total || 1), 0, 1) };
}

function designProfile(threat) {
  const n = threat.designs.length;
  // shortcut: every design weighs the same; real spawn ratios live in event scripts
  return {
    targets: threat.designs.map((d) => ({ label: d.name, share: 1 / n, evasion: d.evasion, size: d.size, layers: layers(d.shield, d.armor, d.hp) })),
    weapons: threat.designs.flatMap((d) => d.weapons.map((w) => ({ key: w.cls, share: w.dps / n, ...w }))),
    pd: threat.designs.filter((d) => d.pd > 0).length / n,
  };
}

const normalized = (items) => {
  const t = items.reduce((a, x) => a + x.share, 0) || 1;
  return items.map((x) => ({ ...x, share: x.share / t }));
};

// shortcut: an empire's "tier" is the highest tier where it has at least half the normal techs; an AI ahead or
// behind you is modelled with every normal tech up to that tier +/- 1. Good enough to shift hulls and parts.
function shiftedTechs(game, researched, shift) {
  const normal = game.techs.filter((t) => !t.rare && !t.dangerous && !t.special);
  let tier = 0;
  for (let k = 0; k <= 5; k++) {
    const ts = normal.filter((t) => t.tier === k);
    if (ts.length && ts.filter((t) => researched.has(t.key)).length >= ts.length / 2) tier = k;
  }
  const target = clamp(tier + shift, 0, 5);
  return new Set([...game.techs.filter((t) => t.start).map((t) => t.key), ...normal.filter((t) => t.tier <= target).map((t) => t.key)]);
}
const TECH_SHIFT = { behind: -1, same: 0, ahead: 1 };

/**
 * Scenarios for one threat-mix entry, each a list of [weight, profile]. "Any" doctrine / FE type splits into one
 * scenario per option so the fleet planner sees each separately; weapon and defense preference stay blended.
 */
function scenariosFor(game, entry, parityFor) {
  const o = entry.options ?? {};
  const t = game.threats.find((x) => x.key === entry.key);
  if (t) {
    const variants = t.variants?.length ? (o.type && o.type !== ANY ? t.variants.filter((v) => v.key === o.type) : t.variants) : [t];
    return variants.map((v) => ({ label: t.variants ? `${t.name}: ${v.name}` : t.name, weight: 1 / variants.length, profiles: [[1, designProfile(v)]] }));
  }
  if (entry.key !== 'ai') return [];
  const ai = game.ai;
  const { ctx, par } = parityFor(TECH_SHIFT[o.tech] ?? 0);
  const pick = (value, freq) => (value && value !== ANY ? [[value, 1]] : Object.entries(freq));
  const doctrines = pick(o.doctrine, Object.fromEntries(Object.keys(ai.doctrines).map((k) => [k, 1])));
  const prefs = pick(o.weapon, ai.weaponPrefFreq);
  const defenses = pick(o.defense, ai.defensePrefFreq);
  const dSum = doctrines.reduce((a, [, w]) => a + w, 0);
  const name = entry.name || 'AI Empires';
  return doctrines.map(([dk, dw]) => {
    const profiles = [];
    for (const [wk, ww] of prefs) for (const [fk, fw] of defenses) profiles.push([ww * fw, aiProfile(game, ctx, par, dk, wk, fk)]);
    const sum = profiles.reduce((a, [w]) => a + w, 0) || 1;
    return { label: doctrines.length > 1 ? `${name}: ${ai.doctrines[dk].name}` : name, weight: dw / dSum, profiles: profiles.map(([w, p]) => [w / sum, p]) };
  });
}

/** Merge weighted profiles into one enemy model: merged targets, per-class weapon stats, PD strength, summary. */
function blend(list) {
  const targets = new Map(), weapons = new Map();
  let pd = 0;
  const wSum = list.reduce((a, [w]) => a + w, 0) || 1;
  for (const [w, p] of list) {
    const weight = w / wSum;
    pd += weight * p.pd;
    for (const t of normalized(p.targets)) {
      const L = t.layers;
      const key = `${t.label}|${t.evasion.toFixed(2)}|${t.size}|${[L.shield, L.armor].map((x) => x.toFixed(2))}`;
      const prev = targets.get(key);
      if (prev) prev.share += t.share * weight;
      else targets.set(key, { ...t, share: t.share * weight });
    }
    for (const x of normalized(p.weapons)) {
      const s = x.share * weight;
      const prev = weapons.get(x.key) ?? { key: x.key, share: 0, sd: 0, ad: 0, hd: 0, sp: 0, ap: 0, acc: 0, trk: 0 };
      // running share-weighted mean of the class stats
      for (const k of ['sd', 'ad', 'hd', 'sp', 'ap', 'acc', 'trk']) prev[k] = (prev[k] * prev.share + (x[k] ?? 0) * s) / (prev.share + s || 1);
      prev.share += s;
      weapons.set(x.key, prev);
    }
  }
  const T = [...targets.values()].filter((t) => t.share > 1e-4);
  const W = [...weapons.values()].filter((w) => w.share > 1e-4);
  if (!T.length) T.push({ label: 'Unknown', share: 1, evasion: 0.1, size: 20, layers: layers(1, 1, 1) });
  const byLabel = {};
  for (const t of T) byLabel[t.label] = (byLabel[t.label] ?? 0) + t.share;
  const defense = { shield: 0, armor: 0, hull: 0 };
  for (const t of T) for (const k in defense) defense[k] += t.share * t.layers[k];
  return {
    targets: T, weapons: W, pd, memo: new Map(),
    summary: {
      hulls: Object.entries(byLabel).sort((a, b) => b[1] - a[1]),
      weapons: Object.fromEntries(W.map((w) => [w.key, w.share])),
      defense, pd,
      evasion: T.reduce((a, t) => a + t.share * t.evasion, 0),
      size: T.reduce((a, t) => a + t.share * t.size, 0),
    },
  };
}

/**
 * Enemy model for a threat mix. Returns the blended enemy (used for design search) plus:
 *  - groups: one blended enemy per mix entry (for specialist designs)
 *  - scenarios: finer splits (per AI doctrine / FE type) with weights, scored separately when picking the fleet
 * `availFor(techSet)` gives hulls/sections/parts for a tech set, used for AIs ahead of or behind you.
 */
export function buildEnemy(game, mix, ctx, availFor) {
  const parities = new Map();
  const parityFor = (shift) => {
    if (!parities.has(shift)) {
      const c = shift && availFor ? availFor(shiftedTechs(game, ctx.researched, shift)) : ctx;
      parities.set(shift, { ctx: c, par: parity(game, c) });
    }
    return parities.get(shift);
  };
  const active = (mix ?? []).filter((m) => m.weight > 0);
  const wSum = active.reduce((a, m) => a + m.weight, 0) || 1;
  const all = [], groups = [], scenarios = [];
  for (const entry of active) {
    const subs = scenariosFor(game, entry, parityFor);
    const groupList = [];
    for (const sc of subs) {
      const weight = (entry.weight / wSum) * sc.weight;
      scenarios.push({ id: `${entry.id ?? entry.key}:${sc.label}`, label: sc.label, weight, enemy: blend(sc.profiles) });
      for (const [w, p] of sc.profiles) {
        all.push([weight * w, p]);
        groupList.push([sc.weight * w, p]);
      }
    }
    if (groupList.length) groups.push({ id: entry.id ?? entry.key, label: entry.name || subs[0].label.split(':')[0], weight: entry.weight / wSum, enemy: blend(groupList) });
  }
  return { ...blend(all), groups, scenarios };
}
