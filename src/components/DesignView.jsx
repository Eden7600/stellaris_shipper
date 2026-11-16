import { useState } from 'react';
import game from '../data/game.json';
import { weaponStats, interceptLoss, shipUpkeep } from '../lib/planner.js';
import Resources from './Resources.jsx';
import { iconUrl, fmt } from './icon.js';

// Frames of ship_designer_slot.dds (the in-game slot boxes with their size letter).
const WEAPON_FRAME = { point_defence: 3, small: 4, medium: 5, large: 6, torpedo: 7, extra_large: 8, titanic: 9, hangar: 13 };
const UTILITY_FRAME = { small: 0, medium: 1, large: 2, aux: 11 };
const SECTION_LABEL = { bow: 'Bow', mid: 'Core', stern: 'Stern' };
const CORE_LABEL = { reactor: 'Reactor', thruster: 'Thrusters', ftl: 'Hyperdrive', sensor: 'Sensors' };

export const designName = (d) => `${game.roles[d.gameRole]?.name ?? d.role} ${d.hull.name}`;

function partTip(c, enemy) {
  if (!c) return 'Leave empty: the power is worth more as surplus';
  const lines = [c.name];
  if (c.kind !== 'utility') {
    const s = weaponStats(c);
    lines.push(`Damage ${Math.round(s.avg)} every ${s.period.toFixed(2)} days, range ${s.range}`);
    lines.push(`Accuracy ${Math.round(s.acc * 100)}%, tracking ${Math.round(s.trk * 100)}%`);
    lines.push(`vs shields ${s.sd}×, armor ${s.ad}×, hull ${s.hd}×`);
    if (s.sp || s.ap) lines.push(`Penetration: shields ${Math.round(s.sp * 100)}%, armor ${Math.round(s.ap * 100)}%`);
    if (s.sizeF) lines.push(`+${s.sizeF * 100}% damage per point of target size`);
    const loss = enemy?.pd ? interceptLoss(c, enemy) : 0;
    if (loss) lines.push(`~${Math.round(loss * 100)}% lost to enemy point-defense`);
  }
  for (const [k, v] of Object.entries({ ...c.modifier, ...c.shipModifier })) {
    if (typeof v === 'number') lines.push(`${k.replace(/^ship_/, '').replaceAll('_', ' ')}: ${v > 0 ? '+' : ''}${v}`);
  }
  lines.push(`Power ${c.power > 0 ? '+' : ''}${c.power} · Cost ${c.cost} alloys`);
  return lines.join('\n');
}

function Slot({ c, frame, enemy }) {
  return (
    <div className="sd-slot" data-tip={partTip(c, enemy)}>
      <div className="sd-frame" style={{ backgroundImage: `url(${iconUrl(game.ui.slotFrames[frame])})` }}>
        {c && <img src={iconUrl(c.icon)} alt="" />}
      </div>
      <span className="sd-name">{c?.name ?? 'Empty'}</span>
    </div>
  );
}

/** Plain-text version for pasting into notes while rebuilding the design in-game. */
function asText(d) {
  const lines = [`${designName(d)}  (role: ${game.roles[d.gameRole]?.name ?? '-'})`];
  for (const { section, weapons, utilities } of d.sections) {
    lines.push(`${SECTION_LABEL[section.slot] ?? section.slot}: ${section.name}`);
    weapons.forEach((c, i) => lines.push(`  [${section.weapons[i]}] ${c?.name ?? 'empty'}`));
    utilities.forEach((u) => lines.push(`  [${u.size}] ${u.c?.name ?? 'empty'}`));
  }
  for (const [k, c] of Object.entries(d.core)) if (c) lines.push(`${CORE_LABEL[k]}: ${c.name}`);
  lines.push(`Combat computer: ${d.computer.name}`);
  return lines.join('\n');
}

export default function DesignView({ design: d, enemy, options }) {
  const [copied, setCopied] = useState(false);
  const s = d.stats;
  const role = game.roles[d.gameRole];
  const st = game.ui.stats;
  const copy = async () => {
    await navigator.clipboard.writeText(asText(d));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className="sd">
      <header className="sd-head">
        {role?.icon && <img className="sd-roleicon" src={iconUrl(role.icon)} alt="" />}
        <div>
          <h3>{designName(d)}</h3>
          <div className="sd-sub">
            Hull <b>{d.hull.name}</b> · Role <b>{role?.name ?? '-'}</b> · Loadout <b>{d.role}</b>
          </div>
        </div>
        <button className="btn" onClick={copy}>{copied ? 'Copied' : 'Copy as text'}</button>
      </header>

      <div className="sd-body">
        <aside className="sd-left">
          <h4>Ship Sections</h4>
          {d.sections.map(({ section }) => (
            <div key={section.key} className="sd-select">
              <span>{SECTION_LABEL[section.slot] ?? section.slot}</span>
              <div>{section.name}</div>
            </div>
          ))}
          <h4>Core Components</h4>
          {Object.entries(d.core).map(([k, c]) => c && (
            <div key={k} className="sd-core" data-tip={partTip(c)}>
              <img src={iconUrl(c.icon)} alt="" />
              <div><small>{CORE_LABEL[k]}</small>{c.name}</div>
            </div>
          ))}
          <div className="sd-core" data-tip={partTip(d.computer)}>
            <img src={iconUrl(d.computer.icon)} alt="" />
            <div><small>Combat Computer</small>{d.computer.name}</div>
          </div>
        </aside>

        <div className="sd-center" style={{ backgroundImage: `url(${iconUrl(game.ui.hullArt[d.hull.key])})` }}>
          {d.sections.map(({ section, weapons, utilities }) => (
            <section key={section.key} className="sd-section">
              <h5>{SECTION_LABEL[section.slot] ?? section.slot}: {section.name}</h5>
              {weapons.length > 0 && (
                <div className="sd-row">
                  {weapons.map((c, i) => <Slot key={i} c={c} frame={WEAPON_FRAME[section.weapons[i]] ?? 4} enemy={enemy} />)}
                </div>
              )}
              {utilities.length > 0 && (
                <div className="sd-row">
                  {utilities.map((u, i) => <Slot key={i} c={u.c} frame={UTILITY_FRAME[u.size] ?? 0} enemy={enemy} />)}
                </div>
              )}
            </section>
          ))}
        </div>

        <aside className="sd-stats" style={{ backgroundImage: `url(${iconUrl(game.ui.valuesBg)})` }}>
          <h4>Ship Stats</h4>
          <Stat icon={st.hit_points} label="Hull" value={fmt(s.hp)} />
          <Stat icon={st.armor} label="Armor" value={fmt(s.armor)} />
          <Stat icon={st.shield} label="Shields" value={fmt(s.shield)} />
          <Stat icon={st.evasion} label="Evasion" value={`${Math.round(s.evasion * 100)}%`} />
          <Stat icon={st.speed} label="Speed" value={Math.round(s.speed)} />
          <Stat icon={st.power} label="Power" value={`${fmt(s.draw)} / ${fmt(s.reactor)}`} bad={s.power < 0}
            tip={s.excess > 0 ? `Surplus power bonus: +${(s.excess * 10).toFixed(1)}% evasion, speed and weapon damage` : 'No surplus power bonus'} />
          <Stat icon={st.build_cost} label="Cost" value={<Resources values={s.costs} />} />
          <Stat icon={st.maintenance} label="Upkeep (docked)" tip="Monthly upkeep at a starbase: no logistics, docking buildings apply"
            value={<Resources values={shipUpkeep(s, game.combat, 'docked', options?.dockedReduction ?? 0)} digits={2} />} />
          <Stat icon={st.maintenance} label="Upkeep (deployed)" tip="Monthly upkeep in the field: full ship upkeep plus logistics (trade)"
            value={<Resources values={shipUpkeep(s, game.combat, 'deployed')} digits={2} />} />
          <Stat icon={st.build_time} label="Build time" value={`${d.hull.buildDays} days`} />
          <h4>Vs. these threats</h4>
          <Stat icon={st.damage} label="Damage / day" value={fmt(s.offense)} tip="After hit chance, damage multipliers, PD losses and range" />
          <Stat icon={st.special} label="Effective HP" value={fmt(s.ehp)} tip="Hull + armor + shields weighted by the enemy's weapons and your evasion" />
          <Stat label="Engagement range" value={s.engageRange || '-'} tip={`The ${d.behavior} computer keeps this distance. Shorter guns fire less often.`} />
          <Stat label="Command / Naval" value={`${d.hull.commandLimit} / ${d.hull.navalCap}`} />
        </aside>
      </div>
    </article>
  );
}

function Stat({ icon, label, value, tip, bad }) {
  return (
    <div className={`sd-stat${bad ? ' bad' : ''}`} data-tip={tip}>
      {icon ? <img src={iconUrl(icon)} alt="" /> : <span />}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
