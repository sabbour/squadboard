import { Router } from 'express';
import { getRecoveryWarning } from '../db/pglite.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    recoveryWarning: getRecoveryWarning(),
  });
});

export default router;
