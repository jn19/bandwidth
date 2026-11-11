import { createContext } from 'react';

// Handlers and lists every action row needs, so the groups don't pass them down by hand
export const ActionsContext = createContext({
  repos: [],
  categories: [],
  onAnnotate: null,
  onCompleteCommitment: null,
  onCreateWorktree: null,
  onRemoveWorktree: null
});

export async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch (e) {
    return { error: e.message };
  }
}
