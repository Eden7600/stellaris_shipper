import game from '../data/game.json';
import { shipUpkeep } from '../lib/planner.js';
import { designName } from './DesignView.jsx';
import { iconUrl, fmt } from './icon.js';

// In-game names of the combat computer behaviours (torpedo computers are called Siege).
const BEHAVIOR = { swarm: 'Swarm', picket: 'Picket', line: 'Line', artillery: 'Artillery', carrier: 'Carrier', torpedo: 'Siege' };
const HULL_ORDER = ['titan', 'battleship', 'cruiser', 'destroyer', 'frigate', 'corvette'];

/** Combat power per command point, per 100 alloys of build cost, and per point of monthly upkeep (deployed). */
export function efficiency(d) {
  const upkeep = Object.values(shipUpkeep(d.stats, game.combat, 'deployed')).reduce((a, v) => a + v, 0);
  return {
    perCmd: d.value / d.hull.commandLimit,
    perAlloy: (d.value / Math.max(d.stats.costs.alloys ?? 0, 1)) * 100,
    perUpkeep: d.value / Math.max(upkeep, 0.01),
  };
}

export default function DesignList({ designs, inPlan, selectedId, onSelect }) {
  if (!designs.length) return null;
  const eff = new Map(designs.map((d) => [d.id, efficiency(d)]));
  const max = (k) => Math.max(...[...eff.values()].map((e) => e[k]));
  const best = { perCmd: max('perCmd'), perAlloy: max('perAlloy') };
  const hulls = HULL_ORDER.filter((h) => designs.some((d) => d.hull.key === h));

  return (
    <div className="designtable">
      <div className="dt-head">
        <span />
        <span>Design</span>
        <span data-tip="Combat power per command point against your threats. Higher means stronger fleets at the same command limit.">Power / cmd</span>
        <span data-tip="Combat power per 100 alloys of build cost. Higher means more fight for your alloys.">Power / 100 alloys</span>
      </div>
      {hulls.map((h) => (
        <div key={h} className="dt-group">
          <h4>{game.hulls.find((x) => x.key === h)?.name}</h4>
          {designs.filter((d) => d.hull.key === h).map((d) => {
            const e = eff.get(d.id);
            return (
              <button key={d.id} className={`dt-row${d.id === selectedId ? ' on' : ''}`} onClick={() => onSelect(d.id)}>
                <img src={iconUrl(game.roles[d.gameRole]?.icon ?? d.hull.icon)} alt="" />
                <span className="dt-name">
                  {designName(d)}
                  <span className="chips">
                    <i>{d.role}</i>
                    <i>{BEHAVIOR[d.behavior] ?? d.behavior}</i>
                    {d.specialistFor && <i className="chip-spec" data-tip={`Designed against ${d.specialistFor} only`}>vs {d.specialistFor}</i>}
                    {inPlan.get(d.id) && <i className="chip-plan" data-tip="Ships of this design in the build plan">{inPlan.get(d.id)}× in plan</i>}
                  </span>
                </span>
                <Meter value={e.perCmd} best={best.perCmd} />
                <Meter value={e.perAlloy} best={best.perAlloy}
                  tip={`Power per 100 alloys: ${fmt(e.perAlloy)}\nPower per monthly upkeep (deployed): ${fmt(e.perUpkeep)}\nBuild cost: ${fmt(d.stats.costs.alloys ?? 0)} alloys`} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Meter({ value, best, tip }) {
  const share = best ? value / best : 0;
  return (
    <span className={`meter${share >= 0.95 ? ' top' : ''}`} data-tip={tip}>
      <b>{fmt(value)}</b>
      <span><i style={{ width: `${Math.round(share * 100)}%` }} /></span>
    </span>
  );
}
