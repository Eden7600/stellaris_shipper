import { useState } from 'react';
import FleetPanel from './FleetPanel.jsx';
import DesignView from './DesignView.jsx';
import DesignList from './DesignList.jsx';

export default function FleetTab({ result, busy, error, options }) {
  const [selected, setSelected] = useState(null);
  const designs = result?.designs ?? [];
  const current = designs.find((d) => d.id === selected) ?? result?.fleet?.ships[0]?.design ?? designs[0];
  const inPlan = new Map(result?.fleet?.ships.map((s) => [s.design.id, s.count]) ?? []);

  return (
    <div className="fleettab">
      <div className="fleetcol">
        <FleetPanel fleet={result?.fleet} busy={busy} error={error} options={options} onSelect={(d) => setSelected(d.id)} />
        <section className="panel">
          <h2>Designs</h2>
          {result && !designs.length && <p className="hint">No buildable warship yet. Research at least Corvettes.</p>}
          <DesignList designs={designs} inPlan={inPlan} selectedId={current?.id} onSelect={setSelected} />
        </section>
      </div>
      <section className="panel designcol">
        <h2>Ship Designer</h2>
        {current ? <DesignView design={current} enemy={result.enemy} options={options} /> : <p className="hint">Nothing to show yet.</p>}
      </section>
    </div>
  );
}
