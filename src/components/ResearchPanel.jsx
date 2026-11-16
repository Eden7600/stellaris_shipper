import { useMemo, useState } from 'react';
import game from '../data/game.json';
import { techClosure, dependents } from '../lib/techs.js';
import { iconUrl } from './icon.js';
import { readSave } from '../lib/save.js';

const AREAS = ['physics', 'society', 'engineering'];
const byKey = new Map(game.techs.map((t) => [t.key, t]));

// What each tech unlocks (hulls, sections, components), for tooltips.
const unlocks = {};
for (const x of [...game.hulls, ...game.sections, ...game.components]) {
  for (const p of x.prerequisites) (unlocks[p] ??= new Set()).add(x.name);
}

const normal = (t) => !t.rare && !t.dangerous && !t.special;
const PRESETS = [
  ['Game start', () => game.techs.filter((t) => t.start)],
  ['Early (tier ≤ 2)', () => game.techs.filter((t) => t.tier <= 2 && normal(t))],
  ['Mid (tier ≤ 3)', () => game.techs.filter((t) => t.tier <= 3 && normal(t))],
  ['Late (all normal)', () => game.techs.filter(normal)],
  ['Everything', () => game.techs],
];
const pct = (g) => `+${g >= 0.1 ? Math.round(g * 100) : (g * 100).toFixed(1)}%`;

export default function ResearchPanel({ techs, setTechs, research, onImport }) {
  const selected = useMemo(() => new Set(techs), [techs]);
  const [query, setQuery] = useState('');
  const [hideLocked, setHideLocked] = useState(true);
  const q = query.trim().toLowerCase();
  // Researched techs and the ones you could research next; plus search by tech or unlocked part name.
  const visible = (t) => (!hideLocked || selected.has(t.key) || (!t.special && t.prerequisites.every((p) => selected.has(p))))
    && (!q || t.name.toLowerCase().includes(q) || [...(unlocks[t.key] ?? [])].some((n) => n.toLowerCase().includes(q)));
  // rank (1-3) and gain per suggested tech, from the worker's research scoring
  const suggested = useMemo(() => {
    const m = new Map();
    for (const list of Object.values(research ?? {})) list.forEach((r, i) => m.set(r.key, { rank: i + 1, gain: r.gain }));
    return m;
  }, [research]);

  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
      dependents(game, key).forEach((k) => next.delete(k));
    } else techClosure(game, [key]).forEach((k) => next.add(k));
    setTechs([...next]);
  };

  return (
    <section className="panel research">
      <h2>Research</h2>
      <SaveImport onImport={onImport} />

      <h3>Researched technology <small>{selected.size} / {game.techs.length}</small></h3>
      <div className="buttons">
        {PRESETS.map(([label, pick]) => (
          <button key={label} onClick={() => setTechs([...techClosure(game, pick().map((t) => t.key))])}>{label}</button>
        ))}
      </div>

      <h3>Best next research for your navy {!research && <span className="busy">Scoring…</span>}</h3>
      <div className="suggestions">
        {AREAS.map((area) => (
          <div key={area} className={`suggestcol ${area}`}>
            <h4><img src={iconUrl(game.ui[area])} alt="" /> {area}</h4>
            {research && !(research[area]?.length) && <p className="hint">Nothing here improves your fleet right now.</p>}
            {(research?.[area] ?? []).map((r, i) => {
              const t = byKey.get(r.key);
              return (
                <button key={r.key} className="suggestion" onClick={() => toggle(r.key)}
                  data-tip={`Researching this raises navy strength by ${pct(r.gain)} against your threats.` + (unlocks[r.key] ? `\nUnlocks: ${[...unlocks[r.key]].join(', ')}` : '') + '\nClick to mark it researched.'}>
                  <b>{i + 1}</b>
                  <img src={iconUrl(t.icon)} alt="" />
                  <span>{t.name}</span>
                  <em>{pct(r.gain)}</em>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="hint">
        Each available tech is scored by re-planning your navy with it added (enemy kept the same). Only techs that
        unlock a ship part, section or hull are scored.
      </p>

      <h3>Tech tree</h3>
      <div className="treetools">
        <input type="search" placeholder="Search techs or parts (e.g. plasma, cruiser, shields)…" value={query}
          onChange={(e) => setQuery(e.target.value)} aria-label="Search techs" />
        <label className="check">
          <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
          Only researched and available next
        </label>
      </div>
      <p className="hint">
        Selecting a tech also selects its prerequisites. Deselecting one removes the techs that depend on it.
        Gold tiles with a number are suggested next. Purple borders mark rare techs, red dangerous, dashed event-only.
      </p>
      <div className="techtree">
        {AREAS.map((area) => (
          <TechColumn key={area} area={area} selected={selected} suggested={suggested} toggle={toggle} visible={visible} />
        ))}
      </div>
    </section>
  );
}

function TechColumn({ area, selected, suggested, toggle, visible }) {
  const techs = game.techs.filter((t) => t.area === area && visible(t));
  const tiers = [...new Set(techs.map((t) => t.tier))].sort((a, b) => a - b);
  return (
    <div className={`techcol ${area}`}>
      <h4><img src={iconUrl(game.ui[area])} alt="" /> {area}</h4>
      {tiers.map((tier) => (
        <div key={tier} className="tier">
          <span className="tierlabel">T{tier}</span>
          <div className="techs">
            {techs.filter((t) => t.tier === tier).map((t) => {
              const s = suggested.get(t.key);
              return (
                <button key={t.key}
                  className={['tech', selected.has(t.key) && 'on', s && 'suggest', t.rare && 'rare', t.dangerous && 'dangerous', t.special && 'special'].filter(Boolean).join(' ')}
                  aria-pressed={selected.has(t.key)}
                  aria-label={t.name}
                  data-tip={`${t.name}  (tier ${t.tier}${t.rare ? ', rare' : ''}${t.dangerous ? ', dangerous' : ''}${t.special ? ', event-only' : ''})` +
                    (s ? `\nSuggested #${s.rank} in ${area}: navy strength ${pct(s.gain)}` : '') +
                    (unlocks[t.key] ? `\nUnlocks: ${[...unlocks[t.key]].join(', ')}` : '')}
                  onClick={() => toggle(t.key)}>
                  {s && <b className="rank">{s.rank}</b>}
                  <img src={iconUrl(t.icon)} alt="" loading="lazy" />
                  <span>{t.name}</span>
                  {s && <em>{pct(s.gain)}</em>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Load research (and used naval capacity) straight from a Stellaris save file. Nothing leaves the browser. */
function SaveImport({ onImport }) {
  const [save, setSave] = useState(null);
  const [status, setStatus] = useState('');
  const apply = (s, countryId) => {
    const c = s.country(countryId);
    const known = c.techs.filter((k) => byKey.has(k));
    onImport({ techs: [...techClosure(game, known)], navalUsed: c.navalUsed });
    setStatus(`Loaded ${c.name ?? `country ${countryId}`} (${s.meta.date}): ${known.length} ship-related techs` +
      (c.navalUsed != null ? `, ${c.navalUsed} naval capacity in use` : '') + '. Set total naval capacity and command limit on the left.');
  };
  const load = async (file) => {
    if (!file) return;
    setStatus('Reading save…');
    try {
      const s = await readSave(file);
      setSave(s);
      apply(s, s.players[0]?.country ?? 0);
    } catch (e) {
      setStatus(`Could not read that save: ${e.message}`);
    }
  };
  const countries = save ? [...new Map(save.players.map((p) => [p.country, p])).values()] : [];
  return (
    <div className="saveimport">
      <label className="btn filebtn" data-tip="Stellaris saves live in Documents/Paradox Interactive/Stellaris/save games. The file is read in your browser and never uploaded.">
        Load research from a save file…
        <input type="file" accept=".sav" onChange={(e) => load(e.target.files?.[0])} />
      </label>
      {countries.length > 1 && (
        <select aria-label="Which player" onChange={(e) => apply(save, Number(e.target.value))}>
          {countries.map((p) => <option key={p.country} value={p.country}>{p.name}</option>)}
        </select>
      )}
      {status && <span className="hint">{status}</span>}
    </div>
  );
}
