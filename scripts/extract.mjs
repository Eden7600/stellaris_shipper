// Reads a local Stellaris install and writes src/data/game.json + public/icons/*.png.
// Usage: node scripts/extract.mjs "D:/SteamLibrary/steamapps/common/Stellaris"
import fs from 'node:fs';
import path from 'node:path';
import { parse, all, list } from './pdx.mjs';
import { decodeDDS, cropFrame, encodePNG, downscale } from './dds.mjs';

const GAME = process.argv[2] ?? 'D:/SteamLibrary/steamapps/common/Stellaris';
const ROOT = path.resolve(import.meta.dirname, '..');
const ICON_DIR = path.join(ROOT, 'public/icons');
const HULLS = ['corvette', 'frigate', 'destroyer', 'cruiser', 'battleship', 'titan'];

const g = (...p) => path.join(GAME, ...p);
const read = (f) => fs.readFileSync(f, 'utf8');
const txtFiles = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) => path.join(dir, f)) : [];

// ---------- variables, localisation, sprites ----------
const globalVars = {};
for (const f of txtFiles(g('common/scripted_variables'))) parse(read(f), globalVars);
const parseFile = (f) => parse(read(f), { ...globalVars });
const parseDir = (d) => txtFiles(g(d)).map(parseFile);

const loc = {};
function walkYml(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkYml(p);
    else if (e.name.endsWith('.yml')) {
      for (const m of read(p).matchAll(/^\s*([\w.\-@]+):\d*\s*"(.*)"/gm)) loc[m[1]] = m[2];
    }
  }
}
walkYml(g('localisation/english'));
function name(key, depth = 0) {
  let s = loc[key];
  if (s == null) return key;
  if (depth < 3) s = s.replace(/\$([\w.\-]+)\$/g, (_, k) => (k in loc ? name(k, depth + 1) : _));
  return s.replace(/§[A-Za-z!]/g, '').replace(/£[^£]*£/g, '').replace(/\\n/g, '\n').trim();
}

const sprites = {};
const sheetRefs = [];
for (const f of fs.readdirSync(g('interface')).filter((f) => f.endsWith('.gfx'))) {
  const doc = parse(read(g('interface', f)));
  for (const types of all(doc, 'spriteTypes')) {
    for (const s of all(types, 'spriteType')) {
      const file = s.texturefile ?? s.textureFile;
      if (s.name && file) sprites[s.name] = { file, frames: Number(s.noOfFrames ?? 1) };
      else if (s.name && s.sprite_sheet_sprite_type) sheetRefs.push(s);
    }
  }
}

for (const s of sheetRefs) {
  const sheet = sprites[s.sprite_sheet_sprite_type];
  if (sheet) sprites[s.name] = { ...sheet, frame: Number(s.default_frame ?? 1) - 1 };
}

const iconsWritten = new Set();
fs.mkdirSync(ICON_DIR, { recursive: true });
/** Convert a game texture to public/icons/<id>.png; returns the URL path or null. */
function icon(id, file, frames = 1, frame = 0) {
  if (!file) return null;
  const src = g(file.replace(/\.tga$/, '.dds'));
  if (!fs.existsSync(src)) return null;
  const out = `${id}.png`;
  if (!iconsWritten.has(out)) {
    try {
      fs.writeFileSync(path.join(ICON_DIR, out), encodePNG(cropFrame(decodeDDS(fs.readFileSync(src)), frames, frame)));
    } catch (e) {
      console.warn(`icon ${file}: ${e.message}`);
      return null;
    }
    iconsWritten.add(out);
  }
  return `icons/${out}`;
}
const spriteIcon = (gfx, frame = 0) => {
  const s = sprites[gfx];
  if (!s) return null;
  const f = Math.min(s.frame ?? frame, s.frames - 1);
  return icon(gfx.replace(/^GFX_/, '') + (s.frames > 1 ? `_${f}` : ''), s.file, s.frames, f);
};

// ---------- scripted triggers: which hull sizes a `ship_uses_*` trigger covers ----------
const triggerSizes = {};
for (const doc of parseDir('common/scripted_triggers')) {
  for (const [k, , v] of doc._entries) {
    if (k.startsWith('ship_uses_') && typeof v === 'object') triggerSizes[k] = shipSizesIn(v);
  }
}
/** Positive `is_ship_size` / `ship_uses_*` references in a trigger tree (NOT blocks ignored). */
function shipSizesIn(node, out = new Set()) {
  for (const [k, , v] of node._entries ?? []) {
    if (k === 'NOT' || k === 'NOR') continue;
    // An OR only restricts hull size if every branch is a size check.
    if (k === 'OR' && typeof v === 'object' && !v._entries.every(([k2]) => k2 === 'is_ship_size' || k2 === 'is_arkship_ship' || k2 in triggerSizes)) continue;
    if (k === 'is_ship_size' && typeof v === 'string') out.add(v);
    else if (k in triggerSizes && v === 'yes') triggerSizes[k].forEach((s) => out.add(s));
    else if (typeof v === 'object') shipSizesIn(v, out);
  }
  return out;
}
function mentions(node, key, val) {
  for (const [k, , v] of node?._entries ?? []) {
    if (k === 'NOT' || k === 'NOR') continue;
    if (k === key && v === val) return true;
    if (typeof v === 'object' && mentions(v, key, val)) return true;
  }
  return false;
}

/** Country-level `x = yes` gates inside `from = {}` blocks (e.g. is_galvanic_empire). */
function countryReqs(node, inFrom = false, out = []) {
  for (const [k, , v] of node?._entries ?? []) {
    if (k === 'NOT' || k === 'NOR') continue;
    if (inFrom && v === 'yes' && k !== 'country_uses_bio_ships') out.push(k);
    if (typeof v === 'object') countryReqs(v, inFrom || k === 'from', out);
  }
  return out;
}
const yes = (v) => [].concat(v ?? []).includes('yes');

/** Numeric resource entries of a cost/upkeep block (drops inline_scripts and other nested data). */
const numbers = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => !k.startsWith('_') && typeof v === 'number'));

// ---------- hulls ----------
const sizeDocs = parseFile(g('common/ship_sizes/00_ship_sizes.txt'));
const behaviorHulls = Object.fromEntries(
  ['swarm', 'torpedo', 'picket', 'line', 'artillery', 'carrier'].map((b) => [b, [...(triggerSizes[`ship_uses_${b}_role`] ?? [])].filter((h) => HULLS.includes(h))]),
);
const hulls = HULLS.map((key) => {
  const s = sizeDocs[key];
  const gfx = sprites[`GFX_${s.icon}`] ? `GFX_${s.icon}` : `GFX_ship_size_${s.icon}`;
  return {
    key,
    name: name(key),
    hp: s.max_hitpoints,
    evasion: s.modifier?.ship_evasion_add ?? 0,
    speed: s.max_speed,
    commandLimit: s.fleet_slot_size,
    navalCap: s.size_multiplier,
    buildDays: s.base_buildtime,
    upkeep: numbers(s.resources?.upkeep),
    logistics: numbers(s.resources?.logistics), // trade upkeep; scaled by LOGISTIC_FLEET_UPKEEP_*_MULT
    slots: Object.keys(s.section_slots).filter((k) => !k.startsWith('_')),
    prerequisites: list(s.prerequisites),
    // static roles plus tech-triggered ones (e.g. energy_torpedoes); stealth variants are the same role cloaked
    roles: [...list(s.ship_roles), ...list(s.triggered_ship_roles).map((r) => r.name)].filter((r) => r && !r.endsWith('_stealth')),
    behaviors: Object.keys(behaviorHulls).filter((b) => behaviorHulls[b].includes(key)),
    icon: spriteIcon(gfx),
  };
});

// ---------- components ----------
const slotTemplates = {};
for (const doc of parseDir('common/component_slot_templates')) {
  for (const [k, , v] of doc._entries) slotTemplates[k] = { size: String(v.size).toLowerCase(), component: v.component };
}

const csv = {};
const csvLines = read(g('common/component_templates/weapon_components.csv')).split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const header = csvLines.shift().split(';');
for (const line of csvLines) {
  const cells = line.split(';');
  csv[cells[0]] = Object.fromEntries(header.slice(1).map((h, i) => [h, Number(cells[i + 1])]).filter(([h, v]) => h && h !== 'end' && !Number.isNaN(v)));
}

const strip = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, strip(v)])) : o);
const componentStats = (kind, c) => kind === 'strike_craft_component_template'
  ? strip({ count: c.count, damage: c.damage, cooldown: c.cooldown, range: c.engagement_range, accuracy: c.accuracy, tracking: c.tracking,
      shield_damage: c.shield_damage ?? 1, armor_damage: c.armor_damage ?? 1, hull_damage: c.hull_damage ?? 1, shield_penetration: c.shield_penetration ?? 0,
      armor_penetration: c.armor_penetration ?? 0, health: c.health, armor: c.armor, shield: c.shield, evasion: c.evasion, regen: c.regeneration_per_day, speed: c.speed })
  : csv[c.key] ?? {};

const components = [];
const rawComps = {}; // every component in the game (monsters, crises, FEs included), for threat profiles
const CORE_SETS = ['power_core', 'ftl_components', 'thruster_components', 'sensor_components', 'combat_computers'];
for (const f of txtFiles(g('common/component_templates'))) {
  const doc = parseFile(f);
  for (const [kind, , c] of doc._entries) {
    if (!/^(weapon|utility|strike_craft)_component_template$/.test(kind) || !c.key) continue;
    rawComps[c.key] = { kind: kind.replace('_component_template', ''), size: String(c.size).toLowerCase(), type: c.type ?? null,
      tags: list(c.tags), modifier: strip(c.modifier) ?? {}, stats: componentStats(kind, c) };
    // shortcut: bioships and Grand Archive fauna live in their own files; skipped until bio hulls are modelled.
    if (/mutation|biogenesis/.test(path.basename(f))) continue;
    const prerequisites = list(c.prerequisites);
    const set = c.component_set ?? null;
    if (!prerequisites.length && (!CORE_SETS.includes(set) || (c.hidden === 'yes' && set !== 'combat_computers'))) continue; // monster/event-only parts
    if (mentions(c.potential, 'country_uses_bio_ships', 'yes') || /_bio$/.test(set ?? '')) continue; // shortcut: bioships not modelled yet
    const sizes = shipSizesIn(c.potential ?? {});
    const hullsFor = sizes.size ? HULLS.filter((h) => sizes.has(h)) : HULLS;
    if (!hullsFor.length) continue;
    const stats = rawComps[c.key].stats;
    components.push({
      key: c.key,
      name: name(c.key),
      kind: kind.replace('_component_template', ''),
      size: String(c.size).toLowerCase(),
      type: c.type ?? null,
      set,
      hulls: hullsFor,
      tags: list(c.tags),
      aiTags: list(c.ai_tags),
      prerequisites,
      upgradesTo: c.upgrades_to ?? null,
      behavior: c.ship_behavior ?? null,
      hidden: c.hidden === 'yes',
      requires: countryReqs(c.potential),
      power: stats.power ?? c.power ?? 0,
      cost: stats.cost ?? c.resources?.cost?.alloys ?? 0,
      costs: { ...numbers(c.resources?.cost), ...(stats.cost != null ? { alloys: stats.cost } : {}) },
      upkeep: numbers(c.resources?.upkeep),
      modifier: strip(c.modifier) ?? {},
      shipModifier: strip(c.ship_modifier) ?? {},
      stats,
      icon: c.icon ? spriteIcon(c.icon, Math.max(0, Number(c.icon_frame ?? 1) - 1)) : null,
    });
  }
}

// ---------- sections ----------
const sections = [];
for (const doc of parseDir('common/section_templates')) {
  for (const s of all(doc, 'ship_section_template')) {
    if (!HULLS.includes(s.ship_size)) continue;
    const weapons = all(s, 'component_slot').map((cs) => slotTemplates[cs.template]).filter(Boolean)
      .map((t) => (t.component === 'strike_craft' ? 'hangar' : t.size));
    sections.push({
      key: s.key,
      name: name(s.key),
      hull: s.ship_size,
      slot: s.fits_on_slot,
      prerequisites: list(s.prerequisites),
      aiTags: list(s.ai_tags),
      weapons,
      utility: { small: s.small_utility_slots ?? 0, medium: s.medium_utility_slots ?? 0, large: s.large_utility_slots ?? 0, aux: s.aux_utility_slots ?? 0 },
      cost: s.resources?.cost?.alloys ?? 0,
      costs: numbers(s.resources?.cost),
      upkeep: numbers(s.resources?.upkeep),
    });
  }
}

// ---------- AI fleet model (doctrines, preferences, hull composition) ----------
const policyDoc = parseFile(g('common/policies/06_policies_fleets_and_starbases.txt'));
const DOCTRINE_ARG = { SPEARHEAD: 'spearhead', BATTLELINE: 'battleline', BARRAGE: 'barrage', STRIKE_WING: 'strike_wing', AMBUSH: 'ambush', PHALANX: 'phalanx' };
const doctrines = Object.fromEntries(all(policyDoc.fleet_doctrine, 'option').map((o) => {
  const key = o.name.replace('_fleet_doctrine', '');
  const roles = {};
  for (const [h, , v] of o.on_enabled?.set_ai_ship_roles?._entries ?? []) {
    if (HULLS.includes(h)) roles[h] = typeof v === 'object' ? Object.fromEntries(v._entries.map(([r, , w]) => [r, w])) : { [v]: 100 };
  }
  return [key, { name: name(o.name), desc: name(`${o.name}_desc`), roles }];
}));
const defensePrefs = Object.fromEntries(all(policyDoc.defense_preference, 'option').map((o) => [o.name, {
  name: name(o.name), armor: o.on_enabled?.set_ai_armor_ratio ?? 0.4, shields: o.on_enabled?.set_ai_shields_ratio ?? 0.4,
}]));
const aiHulls = {};
for (const h of HULLS) {
  const fr = sizeDocs[h]?.ai_ship_data?.fraction;
  if (!fr) continue;
  const mods = all(fr, 'modifier');
  const taper = mods.find((m) => m.factor && m.has_technology);
  const doctrineArgs = all(fr, 'inline_script').find((x) => x.script === 'ai/doctrine_composition_weight') ?? {};
  aiHulls[h] = {
    base: mods.filter((m) => m.add).reduce((a, m) => a + m.add, 0),
    taper: taper ? { factor: taper.factor, tech: taper.has_technology } : null,
    doctrine: Object.fromEntries(Object.entries(DOCTRINE_ARG).map(([arg, d]) => [d, doctrineArgs[arg] ?? 1])),
    weaponPrefBoost: all(fr, 'inline_script').some((x) => x.script === 'ai/weapon_preference_composition_weight'),
  };
}
// How often each weapon/defense preference is rolled, from the AI personalities' starting weights.
const personalities = parseFile(g('common/personalities/00_personalities.txt'));
const weaponPrefFreq = {}, defensePrefFreq = {};
for (const [, , p] of personalities._entries) {
  if (typeof p !== 'object' || !p.weapon_preferences) continue;
  const w = p.weapon_preferences.replace('weapon_type_', '');
  weaponPrefFreq[w] = (weaponPrefFreq[w] ?? 0) + 1;
  const d = p.shields_ratio > p.armor_ratio ? 'shields_preference' : p.armor_ratio > p.shields_ratio ? 'armor_preference' : 'balanced_defenses';
  defensePrefFreq[d] = (defensePrefFreq[d] ?? 0) + 1;
}
const ai = {
  doctrines, defensePrefs, hulls: aiHulls, weaponPrefFreq, defensePrefFreq,
  weaponPrefFavored: globalVars['@weapon_pref_composition_favored'] ?? 1.5,
  titan: strip(sizeDocs.titan?.ai_ship_data) ?? {},
};

// ---------- threat profiles from real crisis / Fallen Empire / marauder designs ----------
const allSizes = {};
for (const doc of parseDir('common/ship_sizes')) for (const [k, , v] of doc._entries) if (typeof v === 'object') allSizes[k] = v;
const weaponClass = (rc) => rc.kind === 'strike_craft' ? 'strike_craft' : rc.type === 'missile' ? 'explosive'
  : ['energy', 'kinetic', 'explosive'].find((k) => rc.tags.includes(`weapon_type_${k}`)) ?? 'energy';
function weaponProfile(rc) {
  const s = rc.stats;
  if (rc.kind === 'strike_craft') {
    if (!s.damage) return null;
    return { cls: 'strike_craft', dps: (((s.damage.min + s.damage.max) / 2) * (s.count ?? 1) / (s.cooldown || 1)) * (s.accuracy ?? 1),
      sd: s.shield_damage, ad: s.armor_damage, hd: s.hull_damage, sp: s.shield_penetration, ap: s.armor_penetration, acc: s.accuracy ?? 1, trk: s.tracking ?? 0 };
  }
  if (!s.max_damage) return null;
  const period = (s.cooldown + ((s.min_windup ?? 0) + (s.max_windup ?? 0)) / 2) / 10 || 1;
  return { cls: weaponClass(rc), dps: (((s.min_damage + s.max_damage) / 2) / period) * s.accuracy,
    sd: s.shield_damage, ad: s.armor_damage, hd: s.hull_damage, sp: s.shield_penetration, ap: s.armor_penetration, acc: s.accuracy, trk: s.tracking };
}
function designProfile(d) {
  const size = allSizes[d.ship_size];
  // shortcut: fleet battles only; stations/starbases/portals skipped (several aren't flagged is_space_station)
  if (!size || size.is_space_station === 'yes' || /starbase|citadel|station|portal/.test(d.ship_size)) return null;
  const comps = all(d, 'section').flatMap((sec) => all(sec, 'component')).map((c) => rawComps[c.template]).filter(Boolean);
  const mod = (k) => (size.modifier?.[k] ?? 0) + comps.reduce((a, c) => a + (c.modifier?.[k] ?? 0), 0);
  const guns = comps.filter((c) => c.kind !== 'utility' && c.size !== 'point_defence' && c.size !== 'planet_killer').map(weaponProfile).filter(Boolean);
  if (!guns.length) return null; // transports, constructors, colony ships
  const pd = comps.filter((c) => c.size === 'point_defence').map(weaponProfile).filter(Boolean).reduce((a, w) => a + w.dps, 0);
  return {
    name: name(d.name), sizeKey: d.ship_size,
    size: Number(size.size_multiplier ?? size.fleet_slot_size ?? 1),
    hp: ((size.max_hitpoints ?? 0) + mod('ship_hull_add')) * (1 + mod('ship_hull_mult')),
    armor: mod('ship_armor_add') * (1 + mod('ship_armor_mult')),
    shield: mod('ship_shield_add') * (1 + mod('ship_shield_mult')),
    evasion: Math.min(90, mod('ship_evasion_add')) / 100,
    weapons: guns, pd,
  };
}
const THREAT_FILES = [
  ['prethoryn', 'Prethoryn Scourge', 'swarm_ship_designs.txt'],
  ['unbidden', 'Extradimensional Invaders', 'extra_dimensional_ship_designs.txt'],
  ['contingency', 'Contingency', 'ai_ship_designs.txt', (d) => !/Cybrex/.test(d.name)],
  ['fallen', 'Fallen Empires', 'fallen_empire_ship_designs.txt'],
  ['marauders', 'Marauders', 'marauder_ship_designs.txt'],
];
// Fallen Empire designs are listed per FE type, each group named by its citadels (NAME_FE_<TYPE>_Citadel_N).
const FE_TYPES = {
  MACHINE: 'Ancient Caretakers (machine)', MATERIALIST: 'Keepers of Knowledge (materialist)', SPIRITUALIST: 'Holy Guardians (spiritualist)',
  XENOPHOBE: 'Militant Isolationists (xenophobe)', XENOPHILE: 'Enigmatic Observers (xenophile)',
};
function feVariants(designs) {
  const groups = [];
  for (const d of designs) {
    if (/Surplus/.test(d.name)) continue; // shortcut: surplus designs are sold FE ships, not an FE's own fleet
    if (d.ship_size === 'colossus' || !groups.length) groups.push([]); // each FE type's block starts with its colossus
    groups.at(-1).push(d);
  }
  return groups.map((g) => {
    const type = g.map((d) => d.name.match(/NAME_FE_([A-Z]+)_Citadel/)?.[1]).find(Boolean);
    return { key: (type ?? 'other').toLowerCase(), name: FE_TYPES[type] ?? type ?? 'Other', designs: g.map(designProfile).filter(Boolean) };
  }).filter((v) => v.designs.length);
}
const threats = THREAT_FILES.map(([key, label, file, keep = () => true]) => {
  const raw = all(parseFile(g('common/global_ship_designs', file)), 'ship_design').filter(keep);
  const t = { key, name: label, designs: raw.map(designProfile).filter(Boolean) };
  if (key === 'fallen') t.variants = feVariants(raw);
  return t;
}).filter((t) => t.designs.length);

// ---------- technologies (only the ship-relevant subtree) ----------
const techDefs = {};
for (const doc of parseDir('common/technology')) {
  for (const [k, , v] of doc._entries) if (k.startsWith('tech_') && typeof v === 'object') techDefs[k] = v;
}
const needed = new Set();
const want = (t) => {
  if (needed.has(t) || !techDefs[t]) return;
  needed.add(t);
  list(techDefs[t].prerequisites).forEach(want);
};
[...components, ...sections, ...hulls].forEach((x) => x.prerequisites.forEach(want));
const techs = [...needed].map((key) => {
  const t = techDefs[key];
  const ic = typeof t.icon === 'string' ? t.icon : key;
  return {
    key,
    name: name(key),
    area: t.area,
    tier: Number(t.tier ?? 0),
    category: list(t.category)[0] ?? null,
    cost: typeof t.cost === 'number' ? t.cost : null,
    prerequisites: list(t.prerequisites).filter((p) => techDefs[p]),
    start: yes(t.start_tech),
    rare: yes(t.is_rare),
    dangerous: yes(t.is_dangerous),
    // event/relic/debris-only (weight 0, or an unconditional weight_modifier factor 0): never a normal research option
    special: t.weight === 0 || [].concat(t.weight_modifier ?? []).some((w) => w.factor === 0),
    icon: ic.startsWith('GFX_') ? spriteIcon(ic) : icon(`tech_${ic.replace(/^tech_/, '')}`, `gfx/interface/icons/technologies/${ic}.dds`),
  };
}).sort((a, b) => a.tier - b.tier || a.area.localeCompare(b.area) || a.name.localeCompare(b.name));

// Drop parts whose techs don't exist (e.g. removed DLC hooks).
const known = new Set(techs.map((t) => t.key));
const ok = (x) => x.prerequisites.every((p) => known.has(p));

// ---------- UI art ----------
const ui = {};
for (const [id, file] of Object.entries({
  alloys: 'gfx/interface/icons/resources/alloys.dds',
  energy: 'gfx/interface/icons/resources/energy.dds',
  physics: 'gfx/interface/icons/resources/physics_research.dds',
  society: 'gfx/interface/icons/resources/society_research.dds',
  engineering: 'gfx/interface/icons/resources/engineering_research.dds',
  navalCap: 'gfx/interface/icons/fleet_capacity_icon.dds',
  commandLimit: 'gfx/interface/icons/fleet_size_icon.dds',
  trade: 'gfx/interface/icons/resources/trade.dds',
})) ui[id] = icon(`ui_${id}`, file);
// Every resource a ship part can cost, with its name and icon (for budgets and cost read-outs).
const resources = {};
for (const r of new Set(['alloys', 'energy', 'trade', ...components.flatMap((c) => [...Object.keys(c.costs), ...Object.keys(c.upkeep)])])) {
  resources[r] = { name: name(r), icon: icon(`res_${r}`, `gfx/interface/icons/resources/${r}.dds`) };
}
// Ship designer art: slot frames, slot-size badges, stat icons, per-hull role art and role icons.
const SD = 'gfx/interface/ship_designer';
ui.slotBg = icon('ui_slot_bg', `${SD}/slot_bg.dds`);
ui.partBg = icon('ui_part_bg', `${SD}/ship_part_bg.dds`);
ui.valuesBg = icon('ui_values_bg', `${SD}/ship_designer_values_bg.dds`);
ui.slotFrames = [...Array(16).keys()].map((f) => icon(`ui_slot_${f}`, `${SD}/ship_designer_slot.dds`, 16, f));
ui.slotSize = Object.fromEntries(['weapon', 'utility', 'hangar'].map((k) =>
  [k, [...Array(5).keys()].map((f) => icon(`ui_slotsize_${k}_${f}`, `${SD}/component_slot_size_${k}_icons.dds`, 5, f))]));
ui.stats = Object.fromEntries(['armor', 'build_cost', 'build_time', 'damage', 'evasion', 'hit_points', 'maintenance', 'power', 'shield', 'speed', 'special']
  .map((k) => [k, icon(`ui_stat_${k}`, `gfx/interface/icons/ship_stats/${k}.dds`)]));
ui.roles = Object.fromEntries(fs.readdirSync(g(SD, 'role_selection')).filter((f) => f.endsWith('.dds'))
  .map((f) => [f.replace('.dds', ''), icon(`ui_role_${f.replace('.dds', '')}`, `${SD}/role_selection/${f}`)]));
ui.hullArt = Object.fromEntries(HULLS.map((h) => [h, icon(`ui_hullart_${h}`, `${SD}/role_selection_background/${h}.dds`)]));

// ---------- combat rules ----------
const behaviorRange = {};
for (const doc of parseDir('common/ship_behaviors')) {
  for (const b of all(doc, 'ship_behavior')) if (b.name) behaviorRange[b.name] = b.preferred_attack_range ?? 'max';
}
const defines = read(g('common/defines/00_defines.txt'));
const define = (k) => Number(defines.match(new RegExp(String.raw`\b${k}\s*=\s*([\d.]+)`))?.[1]);
const staticMods = Object.assign({}, ...parseDir('common/static_modifiers'));
const dockedUpkeep = [];
for (const doc of parseDir('common/starbase_buildings')) {
  for (const [k, , b] of doc._entries) {
    if (typeof b !== 'object') continue;
    const m = JSON.stringify(strip(b)).match(/"ship_orbit_upkeep_mult":(-[\d.]+)/);
    if (m) dockedUpkeep.push({ key: k, name: name(`sm_${k}`) !== `sm_${k}` ? name(`sm_${k}`) : name(k), mult: Number(m[1]) });
  }
}

const combat = {
  dockedUpkeep,
  behaviorRange,
  maxEvasion: define('SHIP_MAX_EVASION'),
  excessPower: { min: define('EXCESS_POWER_BONUS_THRESHOLD_MIN'), max: define('EXCESS_POWER_BONUS_THRESHOLD_MAX'), modifier: strip(staticMods.ship_excess_power) },
  strikeCraftCombatRegen: define('STRIKE_CRAFT_COMBAT_REGEN'),
  logistics: { docked: define('LOGISTIC_FLEET_UPKEEP_DOCKED_MULT'), friendly: define('LOGISTIC_FLEET_UPKEEP_FRIENDLY_SPACE_MULT'), deployed: 1 },
  evasionAvoid: { minSize: define('COMBAT_SHIP_EVASION_AVOID_MIN_SHIP_SIZE'), threshold: define('COMBAT_SHIP_EVASION_AVOID_THRESHOLD') },
};

const bg = g('gfx/loadingscreens/load_3.dds');
if (fs.existsSync(bg)) {
  const img = decodeDDS(fs.readFileSync(bg));
  fs.writeFileSync(path.join(ICON_DIR, 'ui_background.png'), encodePNG(downscale(img, img.width > 1600 ? 2 : 1)));
  ui.background = 'icons/ui_background.png';
}

const version = JSON.parse(read(g('launcher-settings.json'))).version;
const roles = Object.fromEntries([...new Set(hulls.flatMap((h) => h.roles))].map((r) => [r, { name: name(r), icon: ui.roles[r] ?? null }]));
const out = { version, ui, combat, resources, roles, ai, threats, hulls, sections: sections.filter(ok), components: components.filter(ok), techs };
fs.mkdirSync(path.join(ROOT, 'src/data'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/data/game.json'), JSON.stringify(out));
console.log(`${version}: ${hulls.length} hulls, ${out.sections.length} sections, ${out.components.length} components, ${techs.length} techs, ${iconsWritten.size} icons`);
