import { useEffect, useMemo, useRef, useState } from 'react';
import game from '../data/game.json';
import { THREAT_PRESETS } from '../lib/planner.js';
import NavyPanel from './NavyPanel.jsx';
import ResearchPanel from './ResearchPanel.jsx';
import ThreatPanel from './ThreatPanel.jsx';
import FleetTab from './FleetTab.jsx';
import { byHull } from './FleetPanel.jsx';
import Tooltip from './Tooltip.jsx';

const STORAGE_KEY = 'shipwright.v2';
const TABS = [
  { key: 'empire', label: 'Empire & Research' },
  { key: 'threats', label: 'Threats' },
  { key: 'fleet', label: 'Fleet & Designs' },
];

const defaults = () => ({
  tab: 'empire',
  techs: game.techs.filter((t) => t.start).map((t) => t.key),
  commandLimit: 50, // COMMAND_LIMIT_BASE in 00_defines.txt
  navalUsed: 0,
  navalTotal: 50, // NAVAL_CAPACITY_BASE
  strategy: 'expand',
  balance: 'balanced',
  minFleets: 1,
  docking: [],
  budget: { build: {}, upkeepDocked: {}, upkeepDeployed: {} },
  galvanic: false,
  threats: structuredClone(THREAT_PRESETS.general.mix),
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.techs) {
      if (saved.navalCapacity != null && saved.navalTotal == null) saved.navalTotal = saved.navalCapacity; // pre-budget saves
      delete saved.navalCapacity;
      if (saved.budget?.upkeep) saved.budget = { build: saved.budget.build ?? {}, upkeepDocked: {}, upkeepDeployed: saved.budget.upkeep };
      delete saved.posture;
      saved.threats = saved.threats?.map((t) => ({ ...t, id: t.id ?? t.key })); // entries are keyed by id since custom empires
      return { ...defaults(), ...saved };
    }
  } catch {}
  return defaults();
}

/** The fleet-planning options the worker needs, derived from UI state. */
function fleetOptions(s) {
  const clean = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null && v !== ''));
  const dockedReduction = Math.max(-0.9, game.combat.dockedUpkeep.filter((b) => s.docking.includes(b.key)).reduce((a, b) => a + b.mult, 0));
  return {
    commandLimit: s.commandLimit, navalUsed: s.navalUsed, navalTotal: s.navalTotal, strategy: s.strategy, balance: s.balance, minFleets: s.minFleets,
    dockedReduction,
    budget: { build: clean(s.budget.build), upkeepDocked: clean(s.budget.upkeepDocked), upkeepDeployed: clean(s.budget.upkeepDeployed) },
  };
}

/** Runs the planner in a worker, debounced, ignoring stale replies. Research scores arrive in a second message. */
function usePlanner(input) {
  const worker = useRef(null);
  const lastId = useRef(0);
  const [state, setState] = useState({ result: null, research: null, busy: true, error: null });

  useEffect(() => {
    worker.current = new Worker(new URL('../lib/worker.js', import.meta.url), { type: 'module' });
    worker.current.onmessage = ({ data }) => {
      if (data.id !== lastId.current) return;
      if (data.research) setState((s) => ({ ...s, research: data.research }));
      else setState({ result: data.error ? null : data, research: null, busy: false, error: data.error ?? null });
    };
    return () => worker.current.terminate();
  }, []);

  useEffect(() => {
    setState((s) => ({ ...s, busy: true, research: null }));
    const t = setTimeout(() => {
      const id = ++lastId.current;
      worker.current?.postMessage({ id, ...input });
    }, 200);
    return () => clearTimeout(t);
  }, [input]);

  return state;
}

export default function App() {
  const [state, setState] = useState(loadState);
  const update = (patch) => setState((s) => ({ ...s, ...patch }));
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)), [state]);

  const plannerInput = useMemo(() => ({
    techs: state.techs, threats: state.threats, flags: state.galvanic ? ['is_galvanic_empire'] : [], fleet: fleetOptions(state),
  }), [state.techs, state.threats, state.galvanic, state.commandLimit, state.navalUsed, state.navalTotal, state.strategy, state.balance, state.minFleets, state.docking, state.budget]);
  const { result, research, busy, error } = usePlanner(plannerInput);
  const fleetSummary = result?.fleet?.ships.length ? byHull(result.fleet.ships) : '';

  return (
    <>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={state.tab === t.key} className={state.tab === t.key ? 'on' : ''}
            onClick={() => update({ tab: t.key })}>
            {t.label}
          </button>
        ))}
        <span className="tabsummary">{busy ? 'Calculating…' : fleetSummary && `Build: ${fleetSummary}`}</span>
      </nav>
      <main className="page">
        {state.tab === 'empire' && (
          <div className="empiretab">
            <NavyPanel state={state} update={update} />
            <ResearchPanel techs={state.techs} setTechs={(techs) => update({ techs })} research={research}
              onImport={({ techs, navalUsed }) => update({ techs, ...(navalUsed != null ? { navalUsed } : {}) })} />
          </div>
        )}
        {state.tab === 'threats' && <ThreatPanel threats={state.threats} setThreats={(threats) => update({ threats })} summary={result?.enemy.summary} busy={busy} />}
        {state.tab === 'fleet' && <FleetTab result={result} busy={busy} error={error} state={state} options={plannerInput.fleet} />}
      </main>
      <Tooltip />
    </>
  );
}
