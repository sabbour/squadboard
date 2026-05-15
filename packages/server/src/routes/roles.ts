/**
 * GET /api/roles            — list all curated roles, optional ?category= filter
 * GET /api/roles/categories — list available categories
 * GET /api/roles/:id        — single role detail
 */
import { Router, type Request, type Response } from 'express';
import {
  listRoles,
  getRoleById,
  searchRoles,
  listCategories,
  type RoleCategory,
} from '../services/curated-roles.js';

const router = Router();

router.get('/categories', (_req: Request, res: Response) => {
  res.json({ ok: true, data: listCategories() });
});

router.get('/', (req: Request, res: Response) => {
  const categoryRaw = req.query.category;
  const category =
    typeof categoryRaw === 'string' && categoryRaw.length > 0 ? (categoryRaw as RoleCategory) : undefined;
  const qRaw = req.query.q;
  const q = typeof qRaw === 'string' ? qRaw.trim() : '';

  let roles = q ? searchRoles(q) : listRoles(category);
  if (q && category) {
    roles = roles.filter((r) => r.category === category);
  }
  res.json({ ok: true, data: roles });
});

router.get('/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const role = getRoleById(id);
  if (!role) {
    res.status(404).json({ ok: false, error: `Role '${id}' not found` });
    return;
  }
  res.json({ ok: true, data: role });
});

export default router;
