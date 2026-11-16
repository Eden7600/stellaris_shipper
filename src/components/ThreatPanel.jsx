import game from '../data/game.json';
import { THREAT_PRESETS, ANY } from '../lib/planner.js';

const WEAPON_LABEL = { energy: 'Energy', kinetic: 'Kinetic', explosive: 'Explosive', strike_craft: 'Strike Craft' };
const TECH_LABEL = { behind: 'Behind you', same: 'About the same', ahead: 'Ahead of you' };
const pct = (x) => `${Math.round(x * 100)}%`;
const idOf = (e) => e.id ?? e.key;

const THREATS = [
  { key: 'ai', name: 'AI Empires (typical)', desc: 'Regular empires, modelled from the AI fleet rules at your tech level.' },
  ...game.threats.map((t) => ({ key: t.key, name: t.name, variants: t.variants, desc: `${t.designs.length} warship designs: ${[...new Set(t.designs.map((d) => d.name))].join(', ')}` })),
];

/** Counter advice derived from what the planner expects to fight. */
function advice(s) {
  const out = [];
  if (s.evasion >= 0.4) out.push('Evasive enemies: favour high-tracking guns (autocannons, small slots), strike craft and picket computers.');
  if (s.size >= 25) out.push('Big targets: torpedoes and neutron launchers gain bonus damage from target size.');
  if (s.defense.shield >= 0.4) out.push('Shield-heavy: kinetics hit shields 1.5–2×, and missiles and strike craft bypass them.');
  if (s.defense.armor >= 0.4) out.push('Armor-heavy: plasma, lasers and lances do 1.5–2× to armor. Avoid autocannons (0.25×).');
  if ((s.weapons.energy ?? 0) >= 0.5) out.push('Mostly energy weapons incoming: they do half damage or less to shields, so shields hold best.');
  if ((s.weapons.kinetic ?? 0) >= 0.5) out.push('Mostly kinetic weapons incoming: they do 0.5× or less to armor, so armor holds best.');
  if ((s.weapons.explosive ?? 0) >= 0.2) out.push('Significant missile fire: point-defense does 2× to missile armor.');
  if ((s.weapons.strike_craft ?? 0) >= 0.2) out.push('Significant strike craft: flak does 2× to their shields.');
  if (s.pd >= 0.4) out.push('Heavy enemy point-defense: tough missiles (Swarmers) and direct-fire guns lose less damage.');
  return out;
}

export default function ThreatPanel({ threats, setThreats, summary, busy }) {
  const entry = (id) => threats.find((t) => idOf(t) === id);
  const set = (id, patch, key = id) => {
    setThreats(entry(id) ? threats.map((t) => (idOf(t) === id ? { ...t, ...patch } : t)) : [...threats, { id, key, weight: 1, ...patch }]);
  };
  const setOpt = (id, k, v) => set(id, { options: { ...(entry(id)?.options ?? {}), [k]: v } });
  const empires = threats.filter((t) => t.key === 'ai' && idOf(t) !== 'ai');
  const addEmpire = () => setThreats([...threats, {
    id: `empire-${Date.now()}`, key: 'ai', name: `Rival empire ${empires.length + 1}`, weight: 2, options: { tech: 'same' },
  }]);

  return (
    <div className="threattab">
      <section className="panel">
        <h2>Threats To Prepare For</h2>
        <div className="buttons">
          {Object.entries(THREAT_PRESETS).map(([k, p]) => (
            <button key={k} onClick={() => setThreats(structuredClone(p.mix))}>{p.label}</button>
          ))}
        </div>
        <p className="hint">
          Turn on everything you expect to fight. The weight sets how much each threat counts. Profiles come from the
          game's AI fleet rules and the crises' and Fallen Empires' real ship designs.
        </p>

        <ul className="threatlist">
          {THREATS.map((t) => {
            const e = entry(t.key);
            const on = (e?.weight ?? 0) > 0;
            return (
              <li key={t.key} className={on ? 'on' : ''}>
                <label className="threathead" data-tip={t.desc}>
                  <input type="checkbox" checked={on} onChange={(ev) => set(t.key, { weight: ev.target.checked ? 1 : 0 })} />
                  <span>{t.name}</span>
                </label>
                <Weight value={e?.weight ?? 0} onChange={(weight) => set(t.key, { weight })} />
                {on && t.key === 'ai' && <AiOptions options={e.options} onChange={(k, v) => setOpt(t.key, k, v)} />}
                {on && t.variants && (
                  <div className="aiopts">
                    <Select label="Which Fallen Empire" value={e.options?.type} onChange={(v) => setOpt(t.key, 'type', v)}
                      anyLabel="Any (all five types)" options={t.variants.map((v) => [v.key, v.name, v.designs.map((d) => d.name).join(', ')])} />
                    <p className="hint">Militant Isolationists and Enigmatic Observers bring about half kinetic damage. The others are about 80% energy.</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <h3>Specific empires you're facing</h3>
        <p className="hint">
          Add a rival you know about. Their fleet doctrine and weapon/defense preferences are policies you can see
          in-game once you have enough intel.
        </p>
        <ul className="threatlist">
          {empires.map((e) => (
            <li key={idOf(e)} className="on">
              <label className="threathead">
                <input className="name" value={e.name ?? ''} aria-label="Empire name" onChange={(ev) => set(idOf(e), { name: ev.target.value })} />
              </label>
              <Weight value={e.weight} onChange={(weight) => set(idOf(e), { weight })} />
              <AiOptions options={e.options} onChange={(k, v) => setOpt(idOf(e), k, v)} withTech />
              <button className="btn remove" onClick={() => setThreats(threats.filter((t) => idOf(t) !== idOf(e)))}>Remove</button>
            </li>
          ))}
        </ul>
        <div className="buttons"><button onClick={addEmpire}>+ Add an empire</button></div>
      </section>

      <section className="panel">
        <h2>What The Planner Expects {busy && <span className="busy">Calculating…</span>}</h2>
        {!summary && <p className="hint">Select at least one threat.</p>}
        {summary && (
          <>
            <h3>Enemy ships (share of hulls)</h3>
            <Bars rows={summary.hulls.slice(0, 8)} />
            <h3>Incoming damage</h3>
            <Bars rows={Object.entries(summary.weapons).sort((a, b) => b[1] - a[1]).map(([k, v]) => [WEAPON_LABEL[k] ?? k, v])} cls="w" />
            <h3>Enemy defenses</h3>
            <div className="stack">
              {['shield', 'armor', 'hull'].map((k) => (
                <span key={k} className={k} style={{ flexGrow: summary.defense[k] }} data-tip={`${k}: ${pct(summary.defense[k])} of their HP pool`}>
                  {k} {pct(summary.defense[k])}
                </span>
              ))}
            </div>
            <div className="fleetstats">
              <span className="pill" data-tip="Average evasion of enemy ships">Evasion {pct(summary.evasion)}</span>
              <span className="pill" data-tip="Average ship size (torpedoes and neutron launchers scale with it)">Avg size {Math.round(summary.size)}</span>
              <span className="pill" data-tip="How much point-defense / flak cover they bring">PD cover {pct(summary.pd)}</span>
            </div>
            <ul className="assessment">
              {advice(summary).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function Weight({ value, onChange }) {
  return (
    <label className="weight">
      Weight
      <input type="range" min={0} max={10} step={1} value={value} onChange={(ev) => onChange(Number(ev.target.value))} />
      <output>{value}</output>
    </label>
  );
}

function AiOptions({ options = {}, onChange, withTech = false }) {
  return (
    <div className="aiopts">
      <Select label="Fleet doctrine" value={options.doctrine} onChange={(v) => onChange('doctrine', v)}
        options={Object.entries(game.ai.doctrines).map(([k, d]) => [k, d.name, d.desc])} />
      <Select label="Weapon preference" value={options.weapon} onChange={(v) => onChange('weapon', v)}
        options={Object.keys(game.ai.weaponPrefFreq).map((k) => [k, WEAPON_LABEL[k] ?? k])} />
      <Select label="Defense preference" value={options.defense} onChange={(v) => onChange('defense', v)}
        options={Object.entries(game.ai.defensePrefs).map(([k, d]) => [k, d.name])} />
      {withTech && (
        <label className="select">
          <span>Their technology</span>
          <select value={options.tech ?? 'same'} onChange={(e) => onChange('tech', e.target.value)}>
            {Object.entries(TECH_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      )}
      <p className="hint">"Any" uses the odds the AI personalities roll at game start.</p>
    </div>
  );
}

function Select({ label, value, onChange, options, anyLabel = 'Any (game odds)' }) {
  return (
    <label className="select">
      <span>{label}</span>
      <select value={value ?? ANY} onChange={(e) => onChange(e.target.value)}>
        <option value={ANY}>{anyLabel}</option>
        {options.map(([k, name, desc]) => <option key={k} value={k} title={desc}>{name}</option>)}
      </select>
    </label>
  );
}

function Bars({ rows, cls = '' }) {
  return (
    <div className={`bars ${cls}`}>
      {rows.map(([label, v]) => (
        <div key={label} className="bar">
          <span>{label}</span>
          <div><i style={{ width: pct(v) }} /></div>
          <b>{pct(v)}</b>
        </div>
      ))}
    </div>
  );
}
