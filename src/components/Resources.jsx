import game from '../data/game.json';
import { iconUrl, fmt } from './icon.js';

/** Resource amounts with their in-game icons, e.g. build costs or monthly upkeep. */
export default function Resources({ values, digits = 0 }) {
  const entries = Object.entries(values ?? {}).filter(([, v]) => Math.abs(v) > 1e-6);
  if (!entries.length) return <span className="dim">-</span>;
  return (
    <span className="resources">
      {entries.map(([r, v]) => (
        <span key={r} data-tip={game.resources[r]?.name ?? r}>
          <img src={iconUrl(game.resources[r]?.icon)} alt={game.resources[r]?.name ?? r} />
          {digits ? v.toFixed(digits) : fmt(v)}
        </span>
      ))}
    </span>
  );
}
