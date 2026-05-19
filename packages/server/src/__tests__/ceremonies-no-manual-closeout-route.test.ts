import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { ceremoniesRouter } from '../routes/ceremonies.js';

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response, next: NextFunction) => void }>;
  };
};

function findHandler(path: string, method: 'post') {
  const stack = (ceremoniesRouter as unknown as { stack: RouteLayer[] }).stack;
  for (const layer of stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack[0]?.handle;
    }
  }
  return null;
}

describe('close-out API routes', () => {
  it('does not expose the legacy /end-wave route', () => {
    expect(findHandler('/end-wave', 'post')).toBeNull();
  });
});
