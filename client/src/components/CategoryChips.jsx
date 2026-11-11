// Work-area filter chips (CATEGORY_RULES_FILE). A red dot means someone is waiting on you there.
export default function CategoryChips({ categories, counts, total, respondIn, active, onPick }) {
  if (categories.length === 0) return null;
  const chip = (id, label, n) => (
    <button key={id} className={`cat-chip ${active === id ? 'on' : ''}`} aria-pressed={active === id} onClick={() => onPick(id)}>
      {label} <span className="cat-n">{n}</span>
      {respondIn.has(id) && <>
        <span className="cat-dot" aria-hidden="true" />
        <span className="visually-hidden">(someone is waiting on you here)</span>
      </>}
    </button>
  );
  return (
    <div className="cat-chips" role="group" aria-label="Filter by area">
      {chip(null, 'All', total)}
      {categories.map(c => chip(c.id, `${c.icon} ${c.label}`, counts[c.id] ?? 0))}
    </div>
  );
}
