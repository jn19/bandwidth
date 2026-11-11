import { Router } from 'express';
import { notesByTicket } from '../services/notes.js';

const router = Router();

router.get('/tickets', async (_req, res) => {
  try {
    res.json(await notesByTicket());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
