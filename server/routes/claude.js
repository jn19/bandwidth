import { Router } from 'express';
import { resumeSession, assignToClaude, listClaudeProjects } from '../services/claude.js';
import { listAllProjects } from '../services/projects.js';

const router = Router();

router.get('/projects', async (_req, res) => {
  try {
    res.json(await listClaudeProjects());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/resume', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  try {
    await resumeSession(sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/all', async (_req, res) => {
  try {
    res.json(await listAllProjects());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/assign', async (req, res) => {
  const { item, worktreePath, projectPath } = req.body;
  if (!item || !(worktreePath || projectPath)) {
    return res.status(400).json({ error: 'item and a worktreePath or projectPath are required' });
  }
  try {
    res.json(await assignToClaude(item, { worktreePath, projectPath }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
