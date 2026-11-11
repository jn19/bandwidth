import { Router } from 'express';
import { ticketContext } from '../services/notes.js';
import { listSessions } from '../services/claude.js';

const router = Router();

router.get('/tickets', async (_req, res) => {
  try {
    const sessions = await listSessions().catch(() => []);
    res.json(await ticketContext({ sessions }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
