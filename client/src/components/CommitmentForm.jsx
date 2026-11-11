import { useState } from 'react';

// A free-text promise with an optional due date; it shows in Due soon or In progress
export default function CommitmentForm({ onAdd }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await onAdd({ title: title.trim(), dueDate: dueDate || null });
      if (result?.error) setErr(result.error);
      else { setTitle(''); setDueDate(''); }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="commitment-form" onSubmit={handleSubmit}>
      <input
        className="new-worktree-input commitment-input"
        type="text"
        placeholder="I said I'd…"
        value={title}
        onChange={e => setTitle(e.target.value)}
        disabled={busy}
      />
      <input
        className="new-worktree-input commitment-date"
        type="date"
        value={dueDate}
        onChange={e => setDueDate(e.target.value)}
        disabled={busy}
        aria-label="Due date (optional)"
      />
      <button className="worktree-btn create" type="submit" disabled={busy || !title.trim()}>
        {busy ? '…' : 'Add commitment'}
      </button>
      {err && <span className="worktree-error">{err}</span>}
    </form>
  );
}
