import { Router } from 'express';
import { listWorktrees, listAllWorktrees, createWorktree, removeWorktree, openInCode } from '../services/git.js';
import { attachClaudeSessions } from '../services/claude.js';
import { listAllProjects } from '../services/projects.js';
import { notePaths } from '../services/notes.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json(await attachClaudeSessions(await listAllWorktrees()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:repoName', async (req, res) => {
  try {
    res.json(await listWorktrees(req.params.repoName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { repoName, branch } = req.body;
  if (!repoName || !branch) {
    return res.status(400).json({ error: 'repoName and branch are required' });
  }
  try {
    const path = await createWorktree(repoName, branch);
    res.json({ path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/open', async (req, res) => {
  const { path } = req.body;
  if (!path) {
    return res.status(400).json({ error: 'path is required' });
  }
  try {
    // Besides worktrees, Claude project folders and indexed notes may be opened
    const projects = (await listAllProjects()).map(p => p.path);
    await openInCode(path, { allowed: [...projects, ...(await notePaths())] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  const { repoName, branch } = req.body;
  if (!repoName || !branch) {
    return res.status(400).json({ error: 'repoName and branch are required' });
  }
  try {
    await removeWorktree(repoName, branch);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
