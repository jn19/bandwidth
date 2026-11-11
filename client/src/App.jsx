import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import NewWorktree from './components/NewWorktree.jsx';
import NewJiraIssue from './components/NewJiraIssue.jsx';
import Snoozed from './components/Snoozed.jsx';
import ClaudeSessions from './components/ClaudeSessions.jsx';
import ClaudeProjects from './components/ClaudeProjects.jsx';
import AskedOfYou from './components/AskedOfYou.jsx';
import TodayPanel from './components/TodayPanel.jsx';
import DoNext from './components/DoNext.jsx';
import HeaderStats from './components/HeaderStats.jsx';
import CategoryChips from './components/CategoryChips.jsx';
import CommitmentForm from './components/CommitmentForm.jsx';
import { ActionGroup, CollapsedGroup, EasyWins } from './components/ActionGroups.jsx';
import { isSnoozed, DORMANT_AFTER_DAYS } from './signals.js';
import { buildPriorities, easyExtras, GROUPS, GROUP_BY_ID } from './priority.js';
import { ProjectsContext } from './projectsContext.js';
import { ActionsContext } from './actionsContext.js';
import { parseQuery, matches, worktreeMatches } from './search.js';
import { loadPref, savePref } from './prefs.js';

function hashCategory() {
  return decodeURIComponent(window.location.hash.slice(1)) || null;
}

export default function App() {
  const [items, setItems] = useState([]);
  const [worktrees, setWorktrees] = useState({});
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [jiraReadOnly, setJiraReadOnly] = useState(false);
  const [categories, setCategories] = useState([]);
  const [quickWins, setQuickWins] = useState([]);
  const [evidenceReadyLabel, setEvidenceReadyLabel] = useState('Evidence ready');
  const [followUpDays, setFollowUpDays] = useState(5);
  const [configError, setConfigError] = useState(null);
  const [activeCat, setActiveCat] = useState(hashCategory);
  const [focus, setFocus] = useState(() => loadPref('focus', false));
  const [claudeProjects, setClaudeProjects] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [contextWarnTokens, setContextWarnTokens] = useState(400000);
  const [feed, setFeed] = useState([]);
  const [journal, setJournal] = useState(null);
  const [repos, setRepos] = useState([]);
  const [annotations, setAnnotations] = useState({});
  const [commitments, setCommitments] = useState([]);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  // "/" jumps to search from anywhere that isn't already a text field
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // The category filter lives in the URL hash (#helpdesk), so a link or reload keeps it
  useEffect(() => {
    const onHash = () => setActiveCat(hashCategory());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function pickCategory(id) {
    setActiveCat(id);
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', id ? `#${encodeURIComponent(id)}` : pathname + search);
  }

  function toggleFocus() {
    setFocus(f => { savePref('focus', !f); return !f; });
  }

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => {
        setJiraReadOnly(!!c.jiraReadOnly);
        if (c.contextWarnTokens) setContextWarnTokens(c.contextWarnTokens);
        if (c.evidenceReadyLabel) setEvidenceReadyLabel(c.evidenceReadyLabel);
        if (c.followUpDays) setFollowUpDays(c.followUpDays);
        setCategories(c.categories ?? []);
        setQuickWins(c.quickWins ?? []);
        if (c.rulesError) setConfigError('Categories: ' + c.rulesError);
      })
      .catch(() => {});
    fetch('/api/repos')
      .then(r => r.json())
      .then(list => setRepos(Array.isArray(list) ? list : []))
      .catch(() => {});
    fetch('/api/claude/projects/all')
      .then(r => r.json())
      .then(list => setAllProjects(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    const errs = [];

    const [githubRes, jiraRes, stateRes, notesRes, projectsRes, feedRes, journalRes] = await Promise.allSettled([
      fetch('/api/github/items').then(r => r.json()),
      fetch('/api/jira/items').then(r => r.json()),
      fetch('/api/state').then(r => r.json()),
      fetch('/api/notes/tickets').then(r => r.json()),
      fetch('/api/claude/projects').then(r => r.json()),
      fetch('/api/feed?fresh=1').then(r => r.json()),
      fetch('/api/journal').then(r => r.json())
    ]);
    const feedItems = feedRes.status === 'fulfilled' && Array.isArray(feedRes.value) ? feedRes.value : [];
    if (feedRes.status === 'fulfilled' && feedRes.value?.error) errs.push('Feed: ' + feedRes.value.error);
    setJournal(journalRes.status === 'fulfilled' && !journalRes.value?.error ? journalRes.value : null);
    const signalsByKey = {};
    for (const f of feedItems) if (f.key) (signalsByKey[f.key] ??= []).push({ label: f.signal || f.title, url: f.url });
    const notesByKey = notesRes.status === 'fulfilled' && !notesRes.value.error ? notesRes.value : {};
    setClaudeProjects(projectsRes.status === 'fulfilled' && Array.isArray(projectsRes.value) ? projectsRes.value : []);

    if (stateRes.status === 'fulfilled' && !stateRes.value.error) {
      setAnnotations(stateRes.value.annotations || {});
      setCommitments(stateRes.value.commitments || []);
    } else {
      errs.push('Notes: ' + (stateRes.reason?.message || stateRes.value?.error || 'failed'));
    }

    const githubItems = githubRes.status === 'fulfilled' && Array.isArray(githubRes.value)
      ? githubRes.value
      : (errs.push('GitHub: ' + (githubRes.reason?.message || 'failed')), []);

    const jiraItems = jiraRes.status === 'fulfilled' && Array.isArray(jiraRes.value)
      ? jiraRes.value.map(i => ({
        ...i,
        ...(notesByKey[i.key] && {
          notes: notesByKey[i.key].notes,
          projectGuess: notesByKey[i.key].project,
          localActivityAt: notesByKey[i.key].localActivityAt
        }),
        ...(signalsByKey[i.key] && { feedSignals: signalsByKey[i.key] })
      }))
      : (errs.push('Jira: ' + (jiraRes.reason?.message || jiraRes.value?.error || 'failed')), []);

    const allItems = [...githubItems, ...jiraItems];
    setItems(allItems);
    // Feed items about a card on the page became its signals; the rest are "Asked of you"
    const onPage = new Set(jiraItems.map(i => i.key));
    setFeed(feedItems.filter(f => !(f.key && onPage.has(f.key))));
    setErrors(errs);

    // Fetch all worktrees across all repos in one call
    const wtMap = {};
    try {
      const res = await fetch('/api/worktrees');
      if (res.ok) {
        const wts = await res.json();
        for (const wt of wts) {
          if (wt.branch && wt.repoName) wtMap[`${wt.repoName}/${wt.branch}`] = wt;
        }
      }
    } catch {}
    setWorktrees(wtMap);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleCreateWorktree(item, override = {}) {
    const repoName = override.repoName || item.repoName;
    const branch = override.branch || item.branch;
    const res = await fetch('/api/worktrees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName, branch })
    });
    const data = await res.json();
    if (data.path) {
      setWorktrees(prev => ({
        ...prev,
        [`${repoName}/${branch}`]: { path: data.path, branch, repoName }
      }));
    }
    return { ...data, repoName, branch };
  }

  function handleCreateAdHocWorktree(branch, repoName) {
    return handleCreateWorktree({}, { repoName, branch });
  }

  async function handleAnnotate(item, patch) {
    const res = await fetch('/api/state/annotations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, ...patch })
    });
    const data = await res.json();
    if (data.error) {
      setErrors(prev => [...prev, 'Notes: ' + data.error]);
      return;
    }
    setAnnotations(prev => {
      const next = { ...prev };
      if (data.annotation) next[item.id] = data.annotation;
      else delete next[item.id];
      return next;
    });
  }

  async function handleAddCommitment(commitment) {
    const res = await fetch('/api/state/commitments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(commitment)
    });
    const data = await res.json();
    if (data.id) setCommitments(prev => [...prev, data]);
    return data;
  }

  async function handleCompleteCommitment(item) {
    await fetch(`/api/state/commitments/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    setCommitments(prev => prev.filter(c => c.id !== item.id));
    setAnnotations(prev => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
  }

  async function handleRemoveWorktree(item, override = {}) {
    const repoName = override.repoName || item.repoName;
    const branch = override.branch || item.branch;
    await fetch('/api/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName, branch })
    });
    setWorktrees(prev => {
      const next = { ...prev };
      delete next[`${repoName}/${branch}`];
      return next;
    });
  }

  const prio = buildPriorities(items, worktrees, {
    annotations, commitments, projects: claudeProjects, categories, quickWins, followUpDays
  });
  // Rules match in file order; chips and pickers follow `order`
  const chipCategories = [...categories].sort((a, b) => a.order - b.order);
  const cat = categories.some(c => c.id === activeCat) ? activeCat : null;
  const groupLabel = g => (g.id === 'unsent' ? evidenceReadyLabel : g.label);

  // Search and the category filter narrow every section; the header stats stay whole
  const terms = parseQuery(query);
  const searching = terms.length > 0;
  const shown = prio.entries.filter(e =>
    (!cat || e.category === cat) && matches(terms, e.item, e.worktree, e.annotation));
  const inGroup = id => shown.filter(e => e.group === id);
  const doNext = shown.filter(e => GROUP_BY_ID[e.group]).slice(0, 3);
  const waitingEntries = inGroup('waiting').sort((a, b) => (b.idleMs ?? 0) - (a.idleMs ?? 0));
  const laterEntries = inGroup('later');
  const visibleSnoozed = prio.snoozed.filter(e => matches(terms, e.item, e.worktree, e.annotation));

  const countOf = id => prio.entries.filter(e => e.group === id).length;
  const categoryCounts = {};
  const respondIn = new Set();
  for (const e of prio.entries) {
    if (!e.category) continue;
    categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
    if (e.group === 'respond') respondIn.add(e.category);
  }

  // Orphan worktrees: on disk but no active item references them
  const activeKeys = new Set(
    items.filter(i => i.repoName && i.branch).map(i => `${i.repoName}/${i.branch}`)
  );
  const orphanWorktrees = Object.entries(worktrees)
    .filter(([key]) => !activeKeys.has(key) && !prio.worktreeKeys.has(key))
    .map(([key, wt]) => ({ key, ...wt }))
    .filter(wt => worktreeMatches(terms, wt));
  const visibleProjects = claudeProjects.filter(p => matches(terms, { title: p.name }, p, null));
  const workProjects = visibleProjects.filter(p => !p.personal);
  const personalProjects = visibleProjects.filter(p => p.personal);
  const waitingSessions = claudeProjects.flatMap(p => p.claudeSessions).filter(s => s.running && s.state === 'waiting').length;
  const visibleAsked = feed
    .filter(f => !isSnoozed(annotations[f.id]))
    .filter(f => matches(terms, { title: `${f.title} ${f.subtitle ?? ''} ${f.source}` }, null, annotations[f.id]))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const easyWins = [
    ...(cat ? [] : easyExtras(claudeProjects, visibleAsked, contextWarnTokens)
      .filter(e => matches(terms, e.item, null, null))),
    ...shown.filter(e => e.estimate)
  ].sort((a, b) => (a.estimate - b.estimate) || (b.score - a.score));
  const matchCount = shown.length + visibleProjects.length + visibleAsked.length + visibleSnoozed.length +
    orphanWorktrees.length;
  const dormantLater = laterEntries.filter(e => e.dormant).length;

  async function handleRemoveOrphan(wt) {
    await fetch('/api/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName: wt.repoName, branch: wt.branch })
    });
    setWorktrees(prev => {
      const next = { ...prev };
      delete next[wt.key];
      return next;
    });
  }

  async function handleOpenOrphan(wt) {
    await fetch('/api/worktrees/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: wt.path })
    });
  }

  const actions = {
    repos, categories: chipCategories,
    onAnnotate: handleAnnotate,
    onCompleteCommitment: handleCompleteCommitment,
    onCreateWorktree: handleCreateWorktree,
    onRemoveWorktree: handleRemoveWorktree
  };
  const allErrors = configError ? [configError, ...errors] : errors;

  return (
    <ProjectsContext.Provider value={{ all: allProjects, recent: claudeProjects, contextWarnTokens }}>
    <ActionsContext.Provider value={actions}>
    <div className={`app ${focus ? 'focus-on' : ''}`}>
      <header className="app-header">
        <div className="header-top">
          <div>
            <h1>What needs you</h1>
            {!loading && searching && (
              <p className="item-count">{matchCount} match{matchCount !== 1 ? 'es' : ''}</p>
            )}
          </div>
          <div className="search-field">
            <input
              ref={searchRef}
              className="search-input"
              type="search"
              placeholder="Search title, key, #number, branch…  ( / )"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
              aria-label="Search items"
            />
          </div>
          <div className="focus-toggle">
            <input id="focus-toggle" type="checkbox" checked={focus} onChange={toggleFocus} />
            <label htmlFor="focus-toggle">Focus: top 3 only</label>
          </div>
          <button
            className="refresh-btn"
            onClick={fetchAll}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh"
          >
            <span className={refreshing ? 'spin' : ''}>↺</span>
          </button>
        </div>
        {!loading && (
          <>
            <HeaderStats
              respond={countOf('respond')}
              unsent={countOf('unsent')}
              unsentLabel={evidenceReadyLabel}
              overdue={prio.entries.filter(e => e.dueDays !== null && e.dueDays < 0).length}
              follow={countOf('follow')}
              journal={journal}
              waitingSessions={waitingSessions}
            />
            <CategoryChips
              categories={chipCategories}
              counts={categoryCounts}
              total={prio.entries.length}
              respondIn={respondIn}
              active={cat}
              onPick={pickCategory}
            />
          </>
        )}
        {allErrors.length > 0 && (
          <div className="fetch-errors">
            {allErrors.map(e => <span key={e} className="fetch-error">{e}</span>)}
          </div>
        )}
      </header>

      <main className="app-main">
        {loading ? (
          <div className="loading">
            <span className="spin">↺</span> Loading your work items…
          </div>
        ) : (
          <>
            <DoNext entries={doNext} groupLabel={groupLabel} filtered={!!cat || searching} />
            {!focus && <>
            {GROUPS.map(g => (
              <ActionGroup
                key={g.id}
                group={g}
                label={groupLabel(g)}
                purpose={g.id === 'follow'
                  ? `Waiting on someone for over ${followUpDays} days. A nudge is yours.`
                  : g.purpose}
                entries={inGroup(g.id)}
                showAll={searching || !!cat}
              />
            ))}
            <EasyWins entries={easyWins} forceOpen={searching} />
            <CollapsedGroup
              title="Waiting on others"
              purpose={`Sent or handed off; under ${followUpDays} days, so no nudge yet.`}
              entries={waitingEntries}
              open={searching}
            />
            <CollapsedGroup
              title="Later"
              purpose={`Everything else.${dormantLater ? ` ${dormantLater} idle ${DORMANT_AFTER_DAYS}+ days: close or snooze them (Easy Wins).` : ''}`}
              entries={laterEntries}
              open={searching}
            />
            <section className="collapsed-group commitment-section">
              <h2 className="group-title">Add a commitment <span className="group-purpose">Something you said you'd do that isn't a ticket.</span></h2>
              <CommitmentForm onAdd={handleAddCommitment} />
            </section>
            <AskedOfYou items={visibleAsked} onAnnotate={handleAnnotate} />
            <ClaudeProjects projects={workProjects} searching={searching} />
            <ClaudeProjects
              projects={personalProjects}
              searching={searching}
              title="Personal projects"
              hint="Recent sessions in your personal projects."
              startCollapsed
            />
            <TodayPanel journal={journal} />
            <NewWorktree repos={repos} onCreate={handleCreateAdHocWorktree} />
            {!jiraReadOnly && <NewJiraIssue onCreated={fetchAll} />}
            <Snoozed
              entries={visibleSnoozed}
              searching={searching}
              repos={repos}
              onAnnotate={handleAnnotate}
              onCompleteCommitment={handleCompleteCommitment}
              onCreateWorktree={handleCreateWorktree}
              onRemoveWorktree={handleRemoveWorktree}
            />
            {orphanWorktrees.length > 0 && (
              <section className="orphan-section">
                <h2 className="orphan-title">
                  Stale worktrees
                  <span className="orphan-count">{orphanWorktrees.length}</span>
                </h2>
                <p className="orphan-hint">
                  These worktrees exist on disk but no longer match an active PR or issue.
                </p>
                <ul className="orphan-list">
                  {orphanWorktrees.map(wt => (
                    <li key={wt.key} className="orphan-item">
                      <div className="orphan-info">
                        <span className="orphan-repo">{wt.repoName}</span>
                        <span className="orphan-branch">{wt.branch}</span>
                        <code className="orphan-path">{wt.path}</code>
                        <ClaudeSessions sessions={wt.claudeSessions} />
                      </div>
                      <div className="orphan-actions">
                        <button
                          className="worktree-btn open"
                          onClick={() => handleOpenOrphan(wt)}
                        >
                          Open in Code
                        </button>
                        <button
                          className="worktree-btn remove"
                          onClick={() => handleRemoveOrphan(wt)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            </>}
          </>
        )}
      </main>
    </div>
    </ActionsContext.Provider>
    </ProjectsContext.Provider>
  );
}
