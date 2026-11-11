import { Router } from 'express';
import { ticketContext } from '../services/notes.js';

const router = Router();

router.get('/tickets', async (_req, res) => {
  try {
    res.json(await ticketContext());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
