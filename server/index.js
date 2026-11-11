import express from 'express';
import { existsSync } from 'fs';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import githubRoutes from './routes/github.js';
import jiraRoutes from './routes/jira.js';
import worktreeRoutes from './routes/worktrees.js';
import repoRoutes from './routes/repos.js';
import stateRoutes from './routes/state.js';
import claudeRoutes from './routes/claude.js';
import notesRoutes from './routes/notes.js';
import { localOnly } from './security.js';
import { getFeed } from './services/feed.js';
import { getJournal } from './services/journal.js';
import { getCategoryRules } from './services/categories.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;
// Loopback only by default; see security.js before changing it
const HOST = process.env.HOST || '127.0.0.1';

app.use(localOnly);
app.use(express.json());

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/config', async (_, res) => {
  let rules = { categories: [], quickWins: [] };
  let rulesError = null;
  try {
    rules = await getCategoryRules();
  } catch (err) {
    rulesError = err.message;
  }
  res.json({
    jiraReadOnly: process.env.JIRA_READ_ONLY === 'true',
    contextWarnTokens: Number(process.env.CONTEXT_WARN_TOKENS) || 400000,
    evidenceReadyLabel: process.env.EVIDENCE_READY_LABEL || 'Evidence ready',
    followUpDays: Number(process.env.FOLLOW_UP_DAYS) || 5,
    ...rules,
    rulesError
  });
});
app.get('/api/feed', async (req, res) => {
  try {
    res.json(await getFeed({ fresh: req.query.fresh === '1' }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get('/api/journal', async (_req, res) => {
  try {
    res.json(await getJournal());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.use('/api/github', githubRoutes);
app.use('/api/jira', jiraRoutes);
app.use('/api/worktrees', worktreeRoutes);
app.use('/api/repos', repoRoutes);
app.use('/api/state', stateRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/notes', notesRoutes);

// `npm start` builds the client; serve it here so one loopback port is all that runs
const DIST = resolve(__dirname, '../client/dist');
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(DIST, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`bandwidth server → http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});
