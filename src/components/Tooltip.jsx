import { useEffect, useState } from 'react';

/** One floating tooltip for every element with a `data-tip` attribute. */
export default function Tooltip() {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    const move = (e) => {
      const el = e.target.closest?.('[data-tip]');
      setTip(el ? { text: el.dataset.tip, x: e.clientX, y: e.clientY } : null);
    };
    document.addEventListener('mousemove', move);
    return () => document.removeEventListener('mousemove', move);
  }, []);
  if (!tip) return null;
  const left = Math.min(tip.x + 16, window.innerWidth - 400);
  return <div className="tooltip" style={{ left, top: tip.y + 18 }}>{tip.text}</div>;
}
