import { useState } from 'react';
import PrimaryButton from './PrimaryButton.jsx';
import { ItemTitle, CategoryTag, Details, toneOf } from './ActionRow.jsx';
import { GROUP_BY_ID, reasonText, itemLabel } from '../priority.js';

function Card({ entry, rank, groupLabel }) {
  const [open, setOpen] = useState(false);
  const g = GROUP_BY_ID[entry.group];
  return (
    <li className={`do-next-card tone-${toneOf(entry)}`}>
      <div className="do-next-rank" aria-hidden="true">{rank}</div>
      <div className="do-next-body">
        <div className="do-next-tag"><span aria-hidden="true">{g.icon}</span> {groupLabel(g)}</div>
        <ItemTitle item={entry.item} className="do-next-item" />
        <div className="row-reason"><CategoryTag id={entry.category} />Why now: {reasonText(entry)}</div>
        <div className="do-next-actions">
          <PrimaryButton entry={entry} big onNeedDetails={() => setOpen(true)} />
          <button className="row-more" aria-expanded={open} aria-label={`Details: ${itemLabel(entry.item)}`}
            onClick={() => setOpen(o => !o)}>▸</button>
        </div>
        {open && <Details entry={entry} />}
      </div>
    </li>
  );
}

// The top three by score, each with why it's first and one button
export default function DoNext({ entries, groupLabel, filtered }) {
  return (
    <section className="do-next" aria-label="Do next">
      <h2 className="do-next-title">Do next</h2>
      {entries.length === 0 ? (
        <p className="group-purpose">{filtered ? 'Nothing needs action here right now.' : 'Nothing needs action right now.'}</p>
      ) : (
        <ol className="do-next-grid" role="list">
          {entries.map((e, n) => <Card key={e.item.id} entry={e} rank={n + 1} groupLabel={groupLabel} />)}
        </ol>
      )}
    </section>
  );
}
