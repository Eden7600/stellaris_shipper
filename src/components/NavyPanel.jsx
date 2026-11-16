import game from '../data/game.json';
import { iconUrl } from './icon.js';

// Resources ship parts can cost to build, in the order the game lists them.
const BUILD_RESOURCES = ['alloys', 'rare_crystals', 'exotic_gases', 'volatile_motes', 'sr_zro', 'sr_dark_matter', 'sr_living_metal', 'nanites', 'minor_artifacts']
  .filter((r) => game.resources[r]);
const UPKEEP_RESOURCES = ['energy', 'alloys', 'trade'];
const STRATEGIES = {
  expand: ['Expand', 'Keep your current ships and fill the free naval capacity with new ones.'],
  replace: ['Replace', 'Plan the whole navy from scratch, as if you scrapped and rebuilt every ship.'],
};
const BALANCES = {
  efficient: ['Efficient', 'Maximise average strength. Accepts a weak spot against one threat if it pays off elsewhere.'],
  balanced: ['Balanced', 'Trade a little average strength to lift the weakest threat coverage.'],
  hedged: ['Hedged', 'Strongly favour covering every threat. Expect a more mixed navy and lower average strength.'],
};

export default function NavyPanel({ state, update }) {
  const budget = state.budget ?? { build: {}, upkeepDocked: {}, upkeepDeployed: {} };
  const setBudget = (kind, r, raw) => {
    const v = raw === '' ? undefined : Math.max(0, Number(raw) || 0);
    update({ budget: { ...budget, [kind]: { ...budget[kind], [r]: v } } });
  };
  const docking = state.docking ?? [];

  return (
    <section className="panel navy">
      <h2>Navy &amp; Economy</h2>

      <label className="stat">
        <img src={iconUrl(game.ui.commandLimit)} alt="" />
        <span>Command Limit</span>
        <NumberInput value={state.commandLimit} max={1000} onChange={(commandLimit) => update({ commandLimit })} />
      </label>
      <div className="stat naval">
        <img src={iconUrl(game.ui.navalCap)} alt="" />
        <span>Naval Capacity</span>
        <span className="pair" data-tip="Used / total naval capacity, as shown on the in-game top bar">
          <NumberInput value={state.navalUsed} max={9999} label="Used" onChange={(navalUsed) => update({ navalUsed })} />
          <i>/</i>
          <NumberInput value={state.navalTotal} max={9999} label="Total" onChange={(navalTotal) => update({ navalTotal })} />
        </span>
        <Segmented options={STRATEGIES} value={state.strategy} onChange={(strategy) => update({ strategy })} />
      </div>

      <label className="stat" data-tip="Split the navy into at least this many fleets, e.g. one per front. Fleets may then sit below the command limit.">
        <img src={iconUrl(game.ui.commandLimit)} alt="" />
        <span>Minimum fleets</span>
        <NumberInput value={state.minFleets ?? 1} max={50} onChange={(minFleets) => update({ minFleets: Math.max(1, minFleets) })} />
      </label>

      <h3>Fleet balance</h3>
      <Segmented options={BALANCES} value={state.balance} onChange={(balance) => update({ balance })} />
      <p className="hint">{BALANCES[state.balance]?.[1]} The Fleet tab shows coverage per threat.</p>

      <h3>Docking at your shipyard starbase</h3>
      {game.combat.dockedUpkeep.map((b) => (
        <label key={b.key} className="check">
          <input type="checkbox" checked={docking.includes(b.key)}
            onChange={(e) => update({ docking: e.target.checked ? [...docking, b.key] : docking.filter((k) => k !== b.key) })} />
          {b.name} ({Math.round(b.mult * 100)}% docked ship upkeep)
        </label>
      ))}

      <label className="check">
        <input type="checkbox" checked={state.galvanic} onChange={(e) => update({ galvanic: e.target.checked })} />
        Galvanic empire (Living Metal parts)
      </label>

      <h3>Build budget <small>leave blank for no limit</small></h3>
      <div className="budget">
        {BUILD_RESOURCES.map((r) => (
          <Resource key={r} r={r} value={budget.build?.[r]} onChange={(v) => setBudget('build', r, v)} />
        ))}
      </div>
      <h3>Monthly upkeep limits <small>for the ships being planned, blank for no limit</small></h3>
      <p className="hint">
        Docked fleets pay no logistics (trade) and get docking discounts. Deployed fleets pay everything. Set either,
        both or neither; the build plan shows upkeep docked, in friendly space and deployed.
      </p>
      <div className="upkeepgrid">
        <span />
        {UPKEEP_RESOURCES.map((r) => <span key={r} className="ugh"><img src={iconUrl(game.resources[r].icon)} alt="" /> {game.resources[r].name}</span>)}
        <span>While docked</span>
        {UPKEEP_RESOURCES.map((r) => <LimitInput key={r} value={budget.upkeepDocked?.[r]} onChange={(v) => setBudget('upkeepDocked', r, v)} />)}
        <span>While deployed</span>
        {UPKEEP_RESOURCES.map((r) => <LimitInput key={r} value={budget.upkeepDeployed?.[r]} onChange={(v) => setBudget('upkeepDeployed', r, v)} />)}
      </div>
    </section>
  );
}

function NumberInput({ value, max, onChange, label }) {
  return (
    <input type="number" min={0} max={max} value={value} aria-label={label}
      onChange={(e) => onChange(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="buttons radio" role="radiogroup">
      {Object.entries(options).map(([k, [label, tip]]) => (
        <button key={k} role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} data-tip={tip} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function LimitInput({ value, onChange }) {
  return <input type="number" min={0} placeholder="∞" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

function Resource({ r, value, onChange }) {
  const res = game.resources[r];
  return (
    <label className="res" data-tip={res.name}>
      <img src={iconUrl(res.icon)} alt="" />
      <span>{res.name}</span>
      <input type="number" min={0} placeholder="∞" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
