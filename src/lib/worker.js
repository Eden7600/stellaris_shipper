import game from '../data/game.json';
import { buildContext, allDesigns, planFleet, researchAdvice } from './planner.js';

let latest = 0;

self.onmessage = ({ data }) => {
  const { id, techs, threats, flags, fleet: fleetOpts } = data;
  latest = id;
  try {
    const researched = new Set(techs);
    const ctx = buildContext(game, researched, threats, new Set(flags));
    const designs = allDesigns(ctx);
    const scenarios = ctx.enemy.scenarios;
    const fleet = planFleet(designs, fleetOpts, game.combat, scenarios);
    self.postMessage({ id, designs, fleet, enemy: { pd: ctx.enemy.pd, summary: ctx.enemy.summary, scenarios: scenarios.map(({ id: sid, label, weight }) => ({ id: sid, label, weight })) } });
    // Research scoring reruns the whole search per candidate tech, so it follows as a second message and is
    // skipped if newer input has already arrived.
    setTimeout(() => {
      if (latest !== id) return;
      const research = researchAdvice(game, researched, threats, new Set(flags), fleetOpts, ctx.enemy);
      self.postMessage({ id, research });
    });
  } catch (e) {
    self.postMessage({ id, error: String(e?.stack ?? e) });
  }
};
