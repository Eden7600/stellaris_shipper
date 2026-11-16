import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, all, list } from '../scripts/pdx.mjs';
import game from '../src/data/game.json' with { type: 'json' };
import { buildContext, allDesigns, planFleet, THREAT_PRESETS } from '../src/lib/planner.js';
import { techClosure, dependents } from '../src/lib/techs.js';

test('pdx parser: vars, repeated keys, lists, operators', () => {
  const doc = parse(`@x = 5\n# comment\na = { k = @x l = { "q" b } }\na = { k = 2 }\nc >= 3`);
  assert.equal(all(doc, 'a').length, 2);
  assert.equal(all(doc, 'a')[0].k, 5);
  assert.deepEqual(list(all(doc, 'a')[0].l), ['q', 'b']);
  assert.deepEqual(doc._entries.at(-1), ['c', '>=', 3]);
});

test('tech closure and dependents are consistent', () => {
  const closure = techClosure(game, ['tech_battleships']);
  assert.ok(closure.has('tech_cruisers'));
  assert.ok(dependents(game, 'tech_cruisers').has('tech_battleships'));
});

const normal = game.techs.filter((t) => !t.rare && !t.dangerous && !t.special).map((t) => t.key);
const SLOT_OK = (slot, c) => (slot === 'hangar' ? c.kind === 'strike_craft' : c.kind === 'weapon' && c.size === slot);

for (const [name, techs] of [['start', game.techs.filter((t) => t.start).map((t) => t.key)], ['late', normal]]) {
  test(`designs and fleet are valid (${name})`, () => {
    const ctx = buildContext(game, techClosure(game, techs), THREAT_PRESETS.general.mix);
    const designs = allDesigns(ctx);
    assert.ok(designs.length > 0);
    for (const d of designs) {
      assert.ok(d.stats.power >= 0, `${d.hull.key} ${d.role} power ${d.stats.power}`);
      for (const { section, weapons, utilities } of d.sections) {
        weapons.forEach((c, i) => c && assert.ok(SLOT_OK(section.weapons[i], c), `${c.key} in ${section.weapons[i]}`));
        utilities.forEach(({ size, c }) => c && assert.equal(c.size, size));
      }
    }
    const plans = [
      { commandLimit: 50, navalUsed: 15, navalTotal: 50, strategy: 'expand' },
      { commandLimit: 120, navalUsed: 500, navalTotal: 2000, strategy: 'replace', budget: { build: { alloys: 20000 }, upkeepDeployed: { energy: 300 }, upkeepDocked: { alloys: 100 } } },
    ];
    for (const opts of plans) {
      const fleet = planFleet(designs, opts, game.combat, ctx.enemy.scenarios);
      const free = opts.strategy === 'replace' ? opts.navalTotal : opts.navalTotal - opts.navalUsed;
      assert.ok(fleet.navalUsed <= free, 'naval capacity respected');
      for (const f of fleet.fleets) assert.ok(f.cmd <= opts.commandLimit, 'each fleet within command limit');
      assert.equal(fleet.fleets.reduce((a, f) => a + f.cmd, 0), fleet.commandUsed, 'every ship assigned to a fleet');
      for (const [r, cap] of Object.entries(opts.budget?.build ?? {})) assert.ok((fleet.costs[r] ?? 0) <= cap + 1e-6, `build ${r} within budget`);
      for (const [r, cap] of Object.entries(opts.budget?.upkeepDeployed ?? {})) assert.ok((fleet.upkeep.deployed[r] ?? 0) <= cap + 1e-6, `deployed upkeep ${r} within limit`);
      for (const [r, cap] of Object.entries(opts.budget?.upkeepDocked ?? {})) assert.ok((fleet.upkeep.docked[r] ?? 0) <= cap + 1e-6, `docked upkeep ${r} within limit`);
      for (const f of fleet.fleets) assert.ok(f.ships.filter((s) => s.design.hull.key === 'titan').reduce((a, s) => a + s.count, 0) <= 1, 'one titan per fleet');
    }
  });
}

test('threat mix: shares normalised, AI options narrow the profile', () => {
  const techs = techClosure(game, normal);
  const shares = (mix) => {
    const e = buildContext(game, techs, mix).enemy;
    return { t: e.targets.reduce((a, x) => a + x.share, 0), w: e.weapons.reduce((a, x) => a + x.share, 0), e };
  };
  const general = shares(THREAT_PRESETS.general.mix);
  assert.ok(Math.abs(general.t - 1) < 1e-6 && Math.abs(general.w - 1) < 1e-6);
  const kinetic = shares([{ key: 'ai', weight: 1, options: { weapon: 'kinetic', defense: 'armor_preference', doctrine: 'battleline' } }]).e;
  assert.ok(kinetic.summary.weapons.kinetic > 0.8);
  assert.ok(kinetic.summary.defense.armor > kinetic.summary.defense.shield);
  assert.ok(buildContext(game, techs, []).enemy.targets.length === 1); // nothing selected -> neutral fallback
});

test('threat options: FE type narrows scenarios, AI tech level shifts their hulls', () => {
  const start = new Set(game.techs.filter((t) => t.start).map((t) => t.key));
  const fe = (type) => buildContext(game, start, [{ id: 'fallen', key: 'fallen', weight: 1, options: { type } }]).enemy.scenarios.length;
  assert.equal(fe('any'), game.threats.find((t) => t.key === 'fallen').variants.length);
  assert.equal(fe('xenophobe'), 1);
  const hulls = (tech) => buildContext(game, start, [{ id: 'x', key: 'ai', weight: 1, options: { tech, doctrine: 'battleline' } }]).enemy.summary.hulls.map(([h]) => h);
  assert.deepEqual(hulls('same'), ['Corvette']);
  assert.ok(hulls('ahead').length > 1, 'an AI ahead of you fields bigger hulls');
});

test('min fleets: navy split into at least the requested number of fleets', () => {
  const ctx = buildContext(game, techClosure(game, normal), THREAT_PRESETS.ai.mix);
  const fleet = planFleet(allDesigns(ctx, { specialists: false }), { commandLimit: 200, navalTotal: 600, strategy: 'replace', minFleets: 3 }, game.combat, ctx.enemy.scenarios);
  assert.ok(fleet.fleets.length >= 3);
  assert.ok(fleet.fleets.every((f) => f.cmd > 0), 'no empty fleets');
});
