// Ship design + fleet planner. Pure functions over the extracted game data.
// Combat model (simplified from game rules):
//  - damage per day = avg shot / ((cooldown + avg windup) / 10): CSV values are 0.1-day ticks; this reproduces
//    the wiki's per-weapon "day cooldown" table (e.g. Medium Laser (35+15)/10 = 5.0). Strike craft are in days.
//  - hit chance = accuracy - max(0, target evasion - tracking), evasion capped by SHIP_MAX_EVASION
//  - ships fight at their behaviour's preferred_attack_range (min/median/max of weapon ranges);
//    shorter weapons only fire part of the time
//  - surplus reactor power grants the ship_excess_power static modifier, scaled by surplus share
//  - layers: shields -> armor -> hull, each with the weapon's multiplier; penetration bypasses part of a layer
//  - size_damage_factor: damage x (1 + factor x target size), size = naval capacity of the target hull
//  - design score = offense x effective HP (Lanchester), fleet value = sqrt(score) per command/naval point

import { classOf, isPD, weaponStats, clamp } from './weapons.js';
import { buildEnemy } from './enemy.js';
export { weaponStats, WEAPON_CLASSES } from './weapons.js';
export { THREAT_PRESETS, ANY } from './enemy.js';

const MIN_HIT = 0.05;
// shortcut: share of a Nuclear Missile (3 hp + 3 armor) volley lost to full enemy PD/flak coverage; tougher
// missiles lose proportionally less, and it scales with the enemy's PD strength. No per-shot simulation.
const ENEMY_PD_INTERCEPT = 0.35;
const BASE_MISSILE_DURABILITY = 6;
const DESIRED_RANGE_MULT = 0.9; // COMBAT_DESIRED_RANGE_MULT in 00_defines.txt

// ---------------------------------------------------------------- context

/** `enemy` can be passed in to keep the enemy fixed while testing extra techs (the AI model scales with your tech). */
export function buildContext(game, researched, threatMix, flags = new Set(), enemy = null) {
  const ctx = { game, combat: game.combat, ...availability(game, researched, flags) };
  ctx.enemy = enemy ?? buildEnemy(game, threatMix, ctx, (techs) => availability(game, techs, flags));
  return ctx;
}

/** Hulls, sections and parts unlocked by a tech set. */
function availability(game, researched, flags) {
  const has = (x) => x.prerequisites.every((t) => researched.has(t)) && (x.requires ?? []).every((r) => flags.has(r));
  const avail = game.components.filter(has);
  const keys = new Set(avail.map((c) => c.key));
  // shortcut: a part whose upgrade is also unlocked is dropped (same slot, strictly higher tier). This could miss a
  // lower tier that fits a tight power budget better; it keeps the search fast enough for research scoring.
  const comps = avail.filter((c) => !(c.upgradesTo && keys.has(c.upgradesTo)));
  return { researched, hulls: game.hulls.filter(has), sections: game.sections.filter(has), comps };
}

// ---------------------------------------------------------------- evaluation

function collectMods(parts) {
  const m = {};
  for (const c of parts) {
    for (const src of [c.modifier, c.shipModifier]) {
      for (const [k, v] of Object.entries(src ?? {})) if (typeof v === 'number') m[k] = (m[k] ?? 0) + v;
    }
  }
  return m;
}

/** Share of this weapon's damage lost to enemy point-defense. */
export function interceptLoss(c, enemy) {
  if (!enemy.pd) return 0;
  if (c.kind === 'strike_craft') return ENEMY_PD_INTERCEPT * enemy.pd * 0.6; // craft regenerate mid-combat (STRIKE_CRAFT_COMBAT_REGEN)
  if (c.type !== 'missile') return 0;
  const s = c.stats;
  const durability = ((s.missile_health ?? 0) + (s.missile_armor ?? 0)) / Math.max(0.1, 1 - (s.missile_evasion ?? 0));
  return ENEMY_PD_INTERCEPT * enemy.pd * clamp(BASE_MISSILE_DURABILITY / Math.max(durability, 1), 0.1, 1);
}

/** Distance a ship keeps in combat for its behaviour (wiki: even count -> longer of the two middle ranges). */
export function preferredRange(rule, ranges) {
  if (typeof rule === 'number') return rule;
  if (!ranges.length) return 0;
  const s = [...ranges].sort((a, b) => a - b);
  return rule === 'min' ? s[0] : rule === 'max' ? s.at(-1) : s[Math.floor(s.length / 2)];
}

/**
 * Expected damage multiplier of one weapon over the enemy's targets: hit chance x size bonus x layer multiplier
 * (time to chew through each target's shield/armor/hull per unit damage -> harmonic mean). Memoised per
 * accuracy/tracking bonus because it's the hot path of the design search.
 */
function targetFactor(c, w, enemy, accAdd, trkAdd) {
  const key = `${c.key}|${accAdd}|${trkAdd}`;
  let v = enemy.memo?.get(key);
  if (v !== undefined) return v;
  const acc = w.acc + accAdd, trk = w.trk + trkAdd;
  const eS = Math.max((1 - w.sp) * w.sd + w.sp * w.ad, 0.05);
  const eA = Math.max((1 - w.ap) * w.ad + w.ap * w.hd, 0.05);
  const eH = Math.max(w.hd, 0.05);
  v = 0;
  for (const t of enemy.targets) {
    const L = t.layers;
    const hit = clamp(acc - Math.max(0, t.evasion - trk), MIN_HIT, 1);
    v += (t.share * hit * (1 + w.sizeF * t.size)) / (L.shield / eS + L.armor / eA + L.hull / eH);
  }
  enemy.memo?.set(key, v);
  return v;
}

/** Damage per day of one weapon against the configured enemy, with ship modifiers. */
export function weaponDps(c, enemy, mods = {}, engageRange = 0) {
  const w = weaponStats(c);
  const cls = classOf(c);
  const rate = 1 + (mods.ship_fire_rate_mult ?? 0) + (mods[`weapon_type_${cls}_weapon_fire_rate_mult`] ?? 0);
  const dmgMult = 1 + (mods[`weapon_type_${cls}_weapon_damage_mult`] ?? 0) + (mods.ship_weapon_damage ?? 0);
  const perTarget = targetFactor(c, w, enemy, (mods.ship_accuracy_add ?? 0) / 100, (mods.ship_tracking_add ?? 0) / 100);
  // shortcut: guns shorter than the engagement range fire only once the enemy closes in; modelled as half-time
  // at zero range rising to full-time at the engagement range. Strike craft fly to their targets.
  const rangeFit = c.kind === 'strike_craft' || !engageRange || w.range >= engageRange * DESIRED_RANGE_MULT
    ? 1 : 0.5 + 0.5 * (w.range / engageRange);
  return (w.avg / w.period) * rate * dmgMult * perTarget * (1 - interceptLoss(c, enemy)) * rangeFit;
}

/** How much a PD/flak gun protects against the enemy's missile/craft share (0..). */
function interceptPower(c, enemy) {
  const w = weaponStats(c);
  const missiles = enemy.weapons.find((x) => x.key === 'explosive')?.share ?? 0;
  const craft = enemy.weapons.find((x) => x.key === 'strike_craft')?.share ?? 0;
  // missiles carry armor (PD 2x), strike craft carry shields (flak 2x)
  return ((w.avg / w.period) * w.acc * (missiles * w.ad + craft * w.sd)) / 6;
}

export function evaluate(design, ctx) {
  const { hull } = design;
  const parts = design.parts();
  const mods = collectMods(parts);
  const weapons = parts.filter((c) => c.kind !== 'utility');
  const guns = weapons.filter((c) => !isPD(c));

  const reactor = parts.filter((c) => c.power > 0).reduce((a, c) => a + c.power, 0) * (1 + (mods.ship_reactor_power_mult ?? 0));
  const draw = parts.filter((c) => c.power < 0).reduce((a, c) => a - c.power, 0);
  const ex = ctx.combat.excessPower;
  const surplus = reactor > 0 ? 1 - draw / reactor : 0;
  const excess = surplus >= ex.min ? clamp(surplus / ex.max, 0, 1) : 0;
  for (const [k, v] of Object.entries(ex.modifier)) mods[k] = (mods[k] ?? 0) + v * excess;

  const rule = ctx.combat.behaviorRange[design.behavior] ?? 'median';
  const rangeParts = design.behavior === 'carrier' ? guns : guns.filter((c) => c.kind !== 'strike_craft');
  const engageRange = preferredRange(rule, rangeParts.map((c) => weaponStats(c).range));
  const offense = guns.reduce((a, c) => a + weaponDps(c, ctx.enemy, mods, engageRange), 0);

  const shield = parts.reduce((a, c) => a + (c.modifier?.ship_shield_add ?? 0), 0) * (1 + (mods.ship_shield_mult ?? 0));
  const armor = parts.reduce((a, c) => a + (c.modifier?.ship_armor_add ?? 0), 0) * (1 + (mods.ship_armor_mult ?? 0));
  const hp = (hull.hp + (mods.ship_hull_add ?? 0)) * (1 + (mods.ship_hull_mult ?? 0));
  const evasion = clamp(((hull.evasion + (mods.ship_evasion_add ?? 0)) * (1 + (mods.ship_evasion_mult ?? 0))) / 100, 0, ctx.combat.maxEvasion);
  const shieldHard = clamp(mods.ship_shield_hardening_add ?? 0, 0, 1);
  const armorHard = clamp(mods.ship_armor_hardening_add ?? 0, 0, 1);
  const pd = weapons.filter(isPD).reduce((a, c) => a + interceptPower(c, ctx.enemy), 0);

  let inv = 0;
  for (const w of ctx.enemy.weapons) {
    const sp = w.sp * (1 - shieldHard), ap = w.ap * (1 - armorHard);
    let ehp = ((1 - sp) * shield) / w.sd + ((1 - ap) * armor) / w.ad + hp / w.hd;
    ehp /= clamp(w.acc - Math.max(0, evasion - w.trk), MIN_HIT, 1);
    if (w.key === 'explosive' || w.key === 'strike_craft') ehp *= 1 + pd;
    inv += w.share / ehp;
  }
  const ehp = inv ? 1 / inv : hp + armor + shield;

  return {
    offense, ehp, shield, armor, hp, evasion, power: reactor - draw, reactor, draw, excess, engageRange,
    range: guns.length ? Math.max(...guns.map((c) => weaponStats(c).range)) : 0,
    speed: hull.speed * (1 + (mods.ship_speed_mult ?? 0)),
    score: offense * ehp * (reactor - draw >= 0 ? 1 : 0.001),
  };
}

// ---------------------------------------------------------------- design search

const bestBy = (arr, f) => arr.reduce((b, x) => (b == null || f(x) > f(b) ? x : b), null);

function coreParts(ctx, hull) {
  const of = (set) => ctx.comps.filter((c) => c.set === set && c.hulls.includes(hull.key));
  return {
    reactor: bestBy(of('power_core'), (c) => c.power),
    thruster: bestBy(of('thruster_components'), (c) => c.cost),
    sensor: bestBy(of('sensor_components'), (c) => c.cost),
    ftl: bestBy(of('ftl_components'), (c) => c.cost), // no combat effect; most advanced
  };
}

function combos(lists) {
  return lists.reduce((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]]);
}

/** Best design for one hull + combat-computer behaviour. */
export function designFor(ctx, hull, behavior) {
  const computer = bestBy(
    ctx.comps.filter((c) => c.set === 'combat_computers' && c.behavior === behavior && c.hulls.includes(hull.key)),
    (c) => c.cost,
  );
  if (!computer) return null;
  const core = coreParts(ctx, hull);
  if (!core.reactor) return null;
  const sectionLists = hull.slots.map((slot) => ctx.sections.filter((s) => s.hull === hull.key && s.slot === slot));
  if (sectionLists.some((l) => !l.length)) return null;

  const fits = (size, kind) => ctx.comps.filter((c) => c.hulls.includes(hull.key) && (
    kind === 'hangar' ? c.kind === 'strike_craft'
      : kind === 'weapon' ? c.kind === 'weapon' && c.size === size
        : c.kind === 'utility' && c.size === size && !c.set?.startsWith('combat_computers') && !CORE_SETS.has(c.set) && !c.set?.includes('CLOAK') && !c.set?.includes('cloaking')));

  let best = null;
  for (const combo of combos(sectionLists)) {
    const slots = [];
    combo.forEach((section, si) => {
      section.weapons.forEach((size) => slots.push({ si, cands: size === 'hangar' ? fits(null, 'hangar') : fits(size, 'weapon') }));
      for (const [size, n] of Object.entries(section.utility)) for (let i = 0; i < n; i++) slots.push({ si, cands: fits(size, 'utility'), util: size });
    });
    const fill = slots.map(() => null);
    const design = {
      hull, behavior, computer, core,
      sections: combo.map((section) => ({ section })),
      parts: () => [computer, ...Object.values(core).filter(Boolean), ...fill.filter(Boolean)],
    };
    // Coordinate ascent: each slot takes whichever candidate maximises the whole-ship score.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      slots.forEach((slot, i) => {
        let bestC = fill[i], bestS = evaluate(design, ctx).score;
        for (const c of [null, ...slot.cands]) {
          fill[i] = c;
          const s = evaluate(design, ctx).score;
          if (s > bestS * 1.0001) { bestS = s; bestC = c; changed = true; }
        }
        fill[i] = bestC;
      });
      if (!changed) break;
    }
    const stats = evaluate(design, ctx);
    if (!best || stats.score > best.stats.score) {
      Object.assign(stats, economy(hull, combo, design.parts()));
      best = {
        hull, behavior, computer, core, stats, parts: design.parts(),
        sections: combo.map((section, si) => ({
          section,
          weapons: slots.map((s, i) => [s, fill[i]]).filter(([s]) => s.si === si && !s.util).map(([, c]) => c),
          utilities: slots.map((s, i) => [s, fill[i]]).filter(([s]) => s.si === si && s.util).map(([s, c]) => ({ size: s.util, c })),
        })),
      };
    }
  }
  if (best) {
    best.value = Math.sqrt(best.stats.score);
    best.role = roleName(best);
    best.gameRole = gameRole(best);
  }
  return best;
}

const CORE_SETS = new Set(['power_core', 'ftl_components', 'thruster_components', 'sensor_components', 'combat_computers']);

// In-game designer role: the hull's roles that this computer is tagged for.
const ROLE_PREFERENCE = ['energy_torpedoes', 'explosive', 'carrier', 'screen', 'artillery', 'brawler', 'gunship'];
function gameRole(d) {
  const ws = d.sections.flatMap((s) => s.weapons).filter(Boolean);
  const options = d.hull.roles.filter((r) => d.computer.aiTags.includes(r));
  if (options.includes('energy_torpedoes') && !ws.some((c) => c.size === 'torpedo' && c.type !== 'missile')) options.splice(options.indexOf('energy_torpedoes'), 1);
  return ROLE_PREFERENCE.find((r) => options.includes(r)) ?? d.hull.roles[0] ?? null;
}

function roleName(d) {
  const ws = d.sections.flatMap((s) => s.weapons).filter(Boolean);
  if (ws.some((c) => c.kind === 'strike_craft')) return 'Carrier';
  if (ws.some((c) => c.size === 'torpedo' && c.type !== 'missile')) return 'Neutron Artillery';
  if (ws.some((c) => c.size === 'torpedo')) return 'Torpedo';
  if (ws.some((c) => ['extra_large', 'titanic'].includes(c.size))) return 'Spinal Artillery';
  if (d.behavior === 'artillery') return 'Artillery';
  if (ws.some(isPD)) return 'Picket';
  return d.behavior === 'swarm' ? 'Interceptor' : 'Gunship';
}

/** Full stats of a finished design against another enemy (same parts). */
function rescore(d, ctx) {
  const stats = evaluate({ hull: d.hull, behavior: d.behavior, sections: d.sections, parts: () => d.parts }, ctx);
  return Object.assign(stats, economy(d.hull, d.sections.map((s) => s.section), d.parts));
}

/**
 * Candidate designs: the best per hull and behaviour against the blended threat mix, plus (with several threats)
 * specialists optimised against each threat on its own. Every design is then scored against every scenario so the
 * fleet planner can cover weaknesses. Deduped by sections + weapons, sorted by blended value per command point.
 */
export function allDesigns(ctx, { specialists = true } = {}) {
  const out = [], seen = new Set();
  const add = (d, specialistFor = null) => {
    if (!d) return;
    const sig = d.hull.key + '|' + d.sections.map((s) => s.section.key + ':' + s.weapons.map((c) => c?.key).join(',')).join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    d.id = `${d.hull.key}-${d.behavior}-${out.length}`;
    d.specialistFor = specialistFor;
    out.push(d);
  };
  for (const hull of ctx.hulls) for (const b of hull.behaviors) add(designFor(ctx, hull, b));
  const groups = ctx.enemy.groups ?? [];
  if (specialists && groups.length > 1) {
    for (const g of groups) {
      const gctx = { ...ctx, enemy: g.enemy };
      for (const hull of ctx.hulls) for (const b of hull.behaviors) add(designFor(gctx, hull, b), g.label);
    }
  }
  const scenarios = ctx.enemy.scenarios?.length ? ctx.enemy.scenarios : [{ enemy: ctx.enemy }];
  for (const d of out) {
    if (d.specialistFor) {
      d.stats = rescore(d, ctx); // show specialists against the same blended enemy as everything else
      d.value = Math.sqrt(d.stats.score);
    }
    d.values = scenarios.map((sc) => Math.sqrt(rescore(d, { ...ctx, enemy: sc.enemy }).score));
  }
  return out.sort((a, b) => b.value / b.hull.commandLimit - a.value / a.hull.commandLimit);
}

// ---------------------------------------------------------------- economy

const addInto = (into, obj, mult = 1) => {
  for (const [k, v] of Object.entries(obj ?? {})) if (typeof v === 'number') into[k] = (into[k] ?? 0) + v * mult;
  return into;
};

/** Build cost (all resources) and base monthly upkeep of one ship. */
function economy(hull, sections, parts) {
  const costs = {}, upkeep = {};
  for (const x of [...sections, ...parts]) addInto(costs, x.costs);
  for (const x of [hull, ...sections, ...parts]) addInto(upkeep, x.upkeep);
  return { costs, cost: costs.alloys ?? 0, upkeep, logistics: hull.logistics ?? {} };
}

/**
 * Monthly upkeep of one ship for a fleet posture. Docked: ship upkeep reduced by docking buildings
 * (ship_orbit_upkeep_mult, e.g. Crew Quarters -25%) and logistics (trade) x LOGISTIC_FLEET_UPKEEP_DOCKED_MULT.
 * In friendly space logistics x LOGISTIC_FLEET_UPKEEP_FRIENDLY_SPACE_MULT; deployed pays it in full.
 */
export function shipUpkeep(stats, combat, posture = 'docked', dockedReduction = 0) {
  const out = addInto({}, stats.upkeep, posture === 'docked' ? 1 + dockedReduction : 1);
  return addInto(out, stats.logistics, combat.logistics[posture] ?? 1);
}

// ---------------------------------------------------------------- fleet

/** Power-mean exponent per fleet balance setting (see planFleet). */
// 0 = geometric mean (efficient), -1 = harmonic mean (balanced), -10 = close to "maximise the worst" (hedged).
export const BALANCE = { efficient: 0, balanced: -1, hedged: -10 };
const COVERAGE_FLOOR = 0.02; // keeps the utility finite for an empty navy (2% of the ideal)

/**
 * Plan what to build. Strategy 'expand' fills free naval capacity (total - used) and keeps existing ships;
 * 'replace' rebuilds the whole navy up to total capacity.
 *
 * Each design has a value per threat scenario (sqrt(DPS x EHP) against it). For each scenario we first plan the
 * best navy for that threat alone under the same constraints (S*_k). The real navy then maximises the weighted
 * power mean of coverage T_k = S_k / S*_k, with the exponent set by the balance option: geometric mean
 * ("efficient"), harmonic ("balanced") or a steep negative power ("hedged") that punishes the weakest coverage. Ships are added greedily by utility gain per
 * unit of the scarcest constraint (naval capacity, per-resource build and upkeep budgets), then split into
 * balanced fleets under the command limit.
 */
export function planFleet(designs, opts, combat, scenarios = null) {
  const { commandLimit, navalUsed = 0, navalTotal, strategy = 'expand', budget = {}, dockedReduction = 0, balance = 'balanced', minFleets = 1 } = opts;
  if (!designs.length || commandLimit <= 0) return null;
  const weights = scenarios?.length ? scenarios.map((s) => s.weight) : [1];
  const valueOf = (d, k) => (d.values ? d.values[k] : d.value);
  const K = weights.length;
  const p = BALANCE[balance] ?? BALANCE.balanced;
  const utility = (T) => (p === 0 ? Math.log(T + COVERAGE_FLOOR) : (T + COVERAGE_FLOOR) ** p / p);

  const navalFree = strategy === 'replace' ? navalTotal : Math.max(0, navalTotal - navalUsed);
  const caps = { naval: navalFree };
  for (const [r, v] of Object.entries(budget.build ?? {})) if (Number.isFinite(v) && v >= 0) caps[`build:${r}`] = v;
  // Upkeep limits are optional and independent: what you can afford with fleets docked, and when deployed.
  for (const [r, v] of Object.entries(budget.upkeepDocked ?? {})) if (Number.isFinite(v) && v >= 0) caps[`docked:${r}`] = v;
  for (const [r, v] of Object.entries(budget.upkeepDeployed ?? {})) if (Number.isFinite(v) && v >= 0) caps[`deployed:${r}`] = v;
  const use = new Map(designs.map((d) => {
    const u = { naval: d.hull.navalCap };
    for (const [r, v] of Object.entries(d.stats.costs)) u[`build:${r}`] = v;
    for (const [r, v] of Object.entries(shipUpkeep(d.stats, combat, 'docked', dockedReduction))) u[`docked:${r}`] = v;
    for (const [r, v] of Object.entries(shipUpkeep(d.stats, combat, 'deployed'))) u[`deployed:${r}`] = v;
    return [d, u];
  }));
  // shortcut: titan capacity per the wiki (one titan, plus naval capacity / 10 in titan-sized steps); not in defines
  const maxTitans = Math.floor((80 + navalTotal / 10) / 80);

  /** Greedy build: repeatedly add the ship with the best gain(d, S) per unit of resource pressure. */
  const build = (gain) => {
    const remaining = { ...caps };
    const counts = new Map();
    const S = new Array(K).fill(0);
    let titans = 0;
    for (let guard = 0; guard < 5000; guard++) {
      let best = null, bestScore = 0;
      for (const d of designs) {
        if (d.hull.commandLimit > commandLimit || (d.hull.key === 'titan' && titans >= maxTitans)) continue;
        const u = use.get(d);
        let pressure = 0, ok = true;
        for (const r in u) {
          if (!(r in remaining)) continue;
          if (u[r] > remaining[r] + 1e-9) { ok = false; break; }
          pressure += u[r] / Math.max(remaining[r], 1e-9); // share of what's left; the scarcest resource dominates
        }
        if (!ok) continue;
        const score = gain(d, S) / Math.max(pressure, 1e-9);
        if (score > bestScore) { best = d; bestScore = score; }
      }
      if (!best) break;
      counts.set(best, (counts.get(best) ?? 0) + 1);
      if (best.hull.key === 'titan') titans++;
      for (let k = 0; k < K; k++) S[k] += valueOf(best, k);
      for (const [r, v] of Object.entries(use.get(best))) if (r in remaining) remaining[r] -= v;
    }
    return { counts, S, remaining, titans };
  };

  // The best navy against each scenario alone, under the same constraints: the yardstick for coverage.
  const ideal = K > 1 ? weights.map((_, k) => Math.max(build((d) => valueOf(d, k)).S[k], 1e-9)) : [1];
  const objective = (s) => weights.reduce((a, w, k) => a + w * utility(s[k] / ideal[k]), 0);
  const plan = build((d, s) => weights.reduce((a, w, k) =>
    a + w * (utility((s[k] + valueOf(d, k)) / ideal[k]) - utility(s[k] / ideal[k])), 0));
  if (K > 1) improveBySwaps(plan, designs, use, valueOf, objective, maxTitans);
  const { counts, S, remaining, titans } = plan;

  const ships = [...counts].map(([design, count]) => ({ design, count })).sort((a, b) => b.design.hull.navalCap - a.design.hull.navalCap);
  const total = (fn) => ships.reduce((acc, s) => addInto(acc, fn(s.design), s.count), {});
  const commandUsed = ships.reduce((a, s) => a + s.design.hull.commandLimit * s.count, 0);

  // Balanced fleets: biggest hulls first, each ship into the emptiest fleet with room (one titan per fleet).
  const fleets = [];
  if (ships.length) {
    // At least `minFleets` fleets (e.g. one per front), so fleets may sit below the command limit.
    const n = Math.max(Math.ceil(commandUsed / commandLimit), titans, Math.min(minFleets, ships.reduce((a, s) => a + s.count, 0)), 1);
    for (let i = 0; i < n; i++) fleets.push({ cmd: 0, ships: new Map() });
    for (const { design, count } of ships) {
      for (let i = 0; i < count; i++) {
        let room = fleets.filter((f) => f.cmd + design.hull.commandLimit <= commandLimit
          && !(design.hull.key === 'titan' && [...f.ships.keys()].some((x) => x.hull.key === 'titan')));
        if (!room.length) room = [fleets[fleets.push({ cmd: 0, ships: new Map() }) - 1]];
        const f = room.reduce((a, b) => (b.cmd < a.cmd ? b : a));
        f.cmd += design.hull.commandLimit;
        f.ships.set(design, (f.ships.get(design) ?? 0) + 1);
      }
    }
  }
  return {
    ships, navalFree, commandUsed,
    coverage: weights.map((w, k) => ({ label: scenarios?.[k]?.label ?? 'All threats', weight: w, ratio: K > 1 ? S[k] / ideal[k] : 1 })),
    fleets: fleets.map((f) => ({ cmd: f.cmd, ships: [...f.ships].map(([design, count]) => ({ design, count })) })),
    navalUsed: ships.reduce((a, s) => a + s.design.hull.navalCap * s.count, 0),
    costs: total((d) => d.stats.costs),
    upkeep: Object.fromEntries(['docked', 'friendly', 'deployed'].map((p) => [p, total((d) => shipUpkeep(d.stats, combat, p, p === 'docked' ? dockedReduction : 0))])),
    // weighted geometric mean of value per scenario: a navy weak against any threat scores low
    strength: ships.length ? Math.exp(weights.reduce((a, w, k) => a + w * Math.log(Math.max(S[k], 1e-9)), 0)) : 0,
    limitedBy: limiting(designs, use, remaining),
  };
}

/**
 * Local search after the greedy build: remove one ship and refill the freed capacity/budget greedily with whatever
 * raises the objective most (so one cruiser can become four corvettes). Keep the change if the objective improves.
 * Fixes greedy lock-in, where early picks block a better mix.
 */
function improveBySwaps(plan, designs, use, valueOf, objective, maxTitans) {
  const K = plan.S.length;
  const fits = (d, rem, titans) => (d.hull.key !== 'titan' || titans < maxTitans)
    && Object.entries(use.get(d)).every(([r, v]) => !(r in rem) || v <= rem[r] + 1e-9);
  const apply = (state, d, sign) => {
    state.counts.set(d, (state.counts.get(d) ?? 0) + sign);
    if (!state.counts.get(d)) state.counts.delete(d);
    if (d.hull.key === 'titan') state.titans += sign;
    for (let k = 0; k < K; k++) state.S[k] += sign * valueOf(d, k);
    for (const [r, v] of Object.entries(use.get(d))) if (r in state.remaining) state.remaining[r] -= sign * v;
  };
  for (let iter = 0; iter < 200; iter++) {
    const base = objective(plan.S);
    let best = null;
    for (const a of [...plan.counts.keys()]) {
      const trial = { counts: new Map(plan.counts), S: [...plan.S], remaining: { ...plan.remaining }, titans: plan.titans };
      apply(trial, a, -1);
      for (let guard = 0; guard < 100; guard++) { // refill: best objective gain that fits, until nothing helps
        const now = objective(trial.S);
        let pick = null, pickGain = 1e-12;
        for (const b of designs) {
          if (!fits(b, trial.remaining, trial.titans)) continue;
          const gain = objective(trial.S.map((v, k) => v + valueOf(b, k))) - now;
          if (gain > pickGain) { pick = b; pickGain = gain; }
        }
        if (!pick) break;
        apply(trial, pick, +1);
      }
      const gain = objective(trial.S) - base;
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { gain, trial };
    }
    if (!best) return;
    Object.assign(plan, best.trial);
  }
}

/** The constraint most designs ran out of when the build stopped (null if nothing was limited). */
function limiting(designs, use, remaining) {
  const hits = {};
  for (const d of designs) for (const [r, v] of Object.entries(use.get(d))) if (r in remaining && v > remaining[r] + 1e-9) hits[r] = (hits[r] ?? 0) + 1;
  return Object.entries(hits).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ---------------------------------------------------------------- research advice

/**
 * Value of researching each available tech next: rebuild designs and the navy plan with that one tech added
 * (enemy kept fixed) and compare navy strength. Only techs that directly unlock a hull, section or part are
 * scored, without specialist designs to keep it fast. shortcut: stepping-stone techs score zero.
 */
export function researchAdvice(game, techs, threatMix, flags, fleetOpts, enemy) {
  const plan = (set) => {
    const ctx = buildContext(game, set, threatMix, flags, enemy);
    return planFleet(allDesigns(ctx, { specialists: false }), fleetOpts, game.combat, enemy.scenarios)?.strength ?? 0;
  };
  const unlocking = new Set([...game.hulls, ...game.sections, ...game.components].flatMap((x) => x.prerequisites));
  const base = plan(techs);
  const out = [];
  for (const t of game.techs) {
    if (techs.has(t.key) || t.special || !unlocking.has(t.key) || !t.prerequisites.every((p) => techs.has(p))) continue;
    const strength = plan(new Set([...techs, t.key]));
    const gain = base ? strength / base - 1 : strength > 0 ? 1 : 0;
    if (gain > 0.005) out.push({ key: t.key, area: t.area, gain });
  }
  const byArea = {};
  for (const r of out.sort((a, b) => b.gain - a.gain)) {
    const list = (byArea[r.area] ??= []);
    if (list.length < 3) list.push(r);
  }
  return byArea;
}
