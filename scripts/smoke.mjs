// Prints designs + fleet for early/mid/late tech vs each enemy preset. node scripts/smoke.mjs [preset]
import game from '../src/data/game.json' with { type: 'json' };
import { buildContext, allDesigns, planFleet, THREAT_PRESETS } from '../src/lib/planner.js';
import { techClosure } from '../src/lib/techs.js';

const stage = (maxTier) => techClosure(game, game.techs.filter((t) => t.tier <= maxTier && !t.rare && !t.dangerous && !t.special).map((t) => t.key));
const stages = { early: new Set(game.techs.filter((t) => t.start).map((t) => t.key)), mid: stage(2), late: stage(5) };
for (const p of process.argv[2] ? [process.argv[2]] : ['general']) {
  for (const [name, techs] of Object.entries(stages)) {
    const t0 = performance.now();
    const ctx = buildContext(game, techs, THREAT_PRESETS[p].mix);
    const designs = allDesigns(ctx);
    const fleet = planFleet(designs, { commandLimit: 60, navalTotal: 400, strategy: 'replace' }, game.combat, ctx.enemy.scenarios);
    if (fleet) console.log('COVERAGE', fleet.coverage.map((c) => `${c.label} ${Math.round(c.ratio * 100)}%`).join(' | '));
    console.log(`\n== ${p} / ${name} (${techs.size} techs, ${(performance.now() - t0).toFixed(0)}ms)`);
    for (const d of designs) {
      console.log(`${d.hull.key.padEnd(10)} ${d.role.padEnd(17)} ${d.behavior.padEnd(9)} value/cmd ${(d.value / d.hull.commandLimit).toFixed(0).padStart(5)} off ${d.stats.offense.toFixed(0)} ehp ${d.stats.ehp.toFixed(0)} pow ${d.stats.power.toFixed(0)} | ` +
        d.sections.map((s) => `${s.section.name}[${s.weapons.map((c) => c?.name ?? '-').join(', ')}] {${s.utilities.map((u) => u.c?.name ?? '-').join(', ')}}`).join(' + '));
    }
    console.log('FLEET', fleet && fleet.ships.map((s) => `${s.count}x ${s.design.hull.key} ${s.design.role}`).join(', '), fleet && `cmd ${fleet.commandUsed} nav ${fleet.navalUsed} fleets ${fleet.fleets.length} alloys ${Math.round(fleet.costs.alloys)}`);
  }
}
