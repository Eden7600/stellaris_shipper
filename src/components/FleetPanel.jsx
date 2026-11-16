import { Fragment } from 'react';
import game from '../data/game.json';
import { iconUrl } from './icon.js';
import Resources from './Resources.jsx';
import { designName } from './DesignView.jsx';

const LIMIT_LABEL = (key) => {
  if (key === 'naval') return 'naval capacity';
  const [kind, r] = key.split(':');
  const what = { build: 'build budget', docked: 'docked upkeep limit', deployed: 'deployed upkeep limit' }[kind] ?? kind;
  return `${what} (${game.resources[r]?.name ?? r})`;
};
/** "15× Frigate, 9× Corvette": ship counts merged per hull. */
export const byHull = (ships) => Object.entries(ships.reduce((m, s) => ({ ...m, [s.design.hull.name]: (m[s.design.hull.name] ?? 0) + s.count }), {}))
  .map(([h, n]) => `${n}× ${h}`).join(', ');
const UPKEEP_LABEL = {
  docked: ['docked', 'Monthly upkeep at a starbase: no logistics (trade), docking buildings apply'],
  friendly: ['in friendly space', 'Monthly upkeep patrolling your own space: half logistics'],
  deployed: ['deployed', 'Monthly upkeep in the field: full ship upkeep plus logistics (trade)'],
};

export default function FleetPanel({ fleet, busy, error, options, onSelect }) {
  return (
    <section className="panel fleet">
      <h2>Build Plan {busy && <span className="busy">Calculating…</span>}</h2>
      {error && <pre className="error">{error}</pre>}
      {fleet && !fleet.ships.length && (
        <p className="hint">Nothing fits: {fleet.limitedBy ? `limited by ${LIMIT_LABEL(fleet.limitedBy)}` : 'no free naval capacity'}.</p>
      )}
      {fleet?.ships.length > 0 && (
        <>
          <p className="hint">
            {options.strategy === 'expand' ? 'New ships for your free naval capacity' : 'Your whole navy, rebuilt'}
            {fleet.limitedBy && <> · stopped by <b>{LIMIT_LABEL(fleet.limitedBy)}</b></>}
          </p>
          <ul className="fleetlist">
            {fleet.ships.map(({ design: d, count }) => (
              <li key={d.id}>
                <button onClick={() => onSelect?.(d)}>
                  <img src={iconUrl(game.roles[d.gameRole]?.icon ?? d.hull.icon)} alt="" />
                  <b>{count}×</b>
                  <span>{designName(d)}{d.specialistFor && <small className="spec">specialist vs {d.specialistFor}</small>}</span>
                  <small>{d.hull.navalCap * count} naval</small>
                </button>
              </li>
            ))}
          </ul>

          <h3>Organised into {fleet.fleets.length} fleet{fleet.fleets.length === 1 ? '' : 's'} <small>≤ {options.commandLimit} command each{options.minFleets > 1 ? ` · at least ${options.minFleets} requested` : ''}</small></h3>
          <ol className="fleets">
            {fleet.fleets.slice(0, 8).map((f, i) => (
              <li key={i}>
                <span>{byHull(f.ships)}</span>
                <small>{f.cmd} cmd</small>
              </li>
            ))}
            {fleet.fleets.length > 8 && <li className="dim">…and {fleet.fleets.length - 8} more</li>}
          </ol>

          <Coverage coverage={fleet.coverage} />

          <div className="ledger">
            <span>Naval capacity</span><b>{fleet.navalUsed} / {fleet.navalFree}</b>
            <span>Build cost</span><Resources values={fleet.costs} />
            {Object.entries(UPKEEP_LABEL).map(([k, [label, tip]]) => (
              <Fragment key={k}>
                <span data-tip={tip}>Upkeep {label}</span>
                <Resources values={fleet.upkeep[k]} digits={1} />
              </Fragment>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Navy strength against each threat, as a share of what a navy of the same naval size built only for that threat
 * would have. Sub-scenarios (per AI doctrine / FE type) are grouped under their threat, showing the weakest.
 */
function Coverage({ coverage }) {
  if (!coverage?.length || coverage.length < 2) return null;
  const groups = new Map();
  for (const c of coverage) {
    const [group, sub] = c.label.includes(': ') ? c.label.split(': ') : [c.label, null];
    const g = groups.get(group) ?? { label: group, weight: 0, worst: Infinity, subs: [] };
    g.weight += c.weight;
    g.worst = Math.min(g.worst, c.ratio);
    if (sub) g.subs.push(`${sub}: ${Math.round(c.ratio * 100)}%`);
    groups.set(group, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.worst - b.worst);
  return (
    <>
      <h3>Coverage per threat <small>vs a navy built only for it</small></h3>
      <div className="bars coverage">
        {rows.map((g) => (
          <div key={g.label} className={`bar${g.worst < 0.7 ? ' weak' : ''}`}
            data-tip={[`${g.label} (weight ${Math.round(g.weight * 100)}%)`, ...g.subs].join('\n')}>
            <span>{g.label}</span>
            <div><i style={{ width: `${Math.min(100, Math.round(g.worst * 100))}%` }} /></div>
            <b>{Math.round(g.worst * 100)}%</b>
          </div>
        ))}
      </div>
    </>
  );
}
