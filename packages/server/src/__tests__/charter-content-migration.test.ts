/**
 * charter-content-migration.test.ts — W29 MC-5 Migration Safety
 *
 * Verifies:
 * - Schema includes charterContent column
 * - Migration SQL contains ALTER TABLE ADD COLUMN directive
 * - Rollback SQL contains ALTER TABLE DROP COLUMN directive
 * - Types are correctly exported
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as schema from '../db/schema.js';

// Mock the DB connection
const mockQuery = vi.fn();
const mockPool = {
  query: mockQuery,
  connect: vi.fn(),
  end: vi.fn(),
};

vi.mock('../db/pglite.js', () => ({
  getPglite: vi.fn(() => ({})),
  PGLITE_SENTINEL: 'pglite://',
  createPoolAdapter: vi.fn(() => mockPool),
  type: 'PoolLike',
}));

describe('Charter Content Migration (W29 MC-5)', () => {
  describe('Type exports', () => {
    it('Agent type is exported', () => {
      type Agent = schema.Agent;
      const sample: Partial<Agent> = { charterContent: 'test' };
      expect(sample.charterContent).toBe('test');
    });

    it('NewAgent type is exported', () => {
      type NewAgent = schema.NewAgent;
      const sample: Partial<NewAgent> = { charterContent: 'new' };
      expect(sample.charterContent).toBe('new');
    });

    it('charterContent field is assignable in Agent type', () => {
      // Type-level check: Agent has charterContent: string
      const agent: schema.Agent = {
        id: 'test',
        projectId: 'test',
        name: 'test',
        role: 'test',
        charterPath: '/test/charter.md',
        charterContent: '# Test Charter',
        status: 'active',
        agentKind: 'squad',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(agent.charterContent).toBe('# Test Charter');
    });
  });

  describe('Migration files', () => {
    it('0003_agents_charter_content.sql exists', async () => {
      const filePath = path.join(
        process.cwd(),
        'src',
        'db',
        'migrations',
        '0003_agents_charter_content.sql'
      );

      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });

    it('0003_agents_charter_content.sql contains ALTER TABLE ADD COLUMN', async () => {
      const filePath = path.join(
        process.cwd(),
        'src',
        'db',
        'migrations',
        '0003_agents_charter_content.sql'
      );

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('ALTER TABLE agents ADD COLUMN');
      expect(content).toContain('charter_content');
    });

    it('0003_agents_charter_content.sql sets NOT NULL DEFAULT', async () => {
      const filePath = path.join(
        process.cwd(),
        'src',
        'db',
        'migrations',
        '0003_agents_charter_content.sql'
      );

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('NOT NULL DEFAULT');
    });

    it('0003_agents_charter_content.rollback.sql exists', async () => {
      const filePath = path.join(
        process.cwd(),
        'src',
        'db',
        'migrations',
        '0003_agents_charter_content.rollback.sql'
      );

      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });

    it('0003_agents_charter_content.rollback.sql contains ALTER TABLE DROP COLUMN', async () => {
      const filePath = path.join(
        process.cwd(),
        'src',
        'db',
        'migrations',
        '0003_agents_charter_content.rollback.sql'
      );

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('ALTER TABLE agents DROP COLUMN');
      expect(content).toContain('charter_content');
    });

    it('Migration forward and rollback use IF EXISTS / IF NOT EXISTS guards', async () => {
      const forwardPath = path.join(
        process.cwd(),
        'src',
        'db',
        'migrations',
        '0003_agents_charter_content.sql'
      );

      const rollbackPath = path.join(
        process.cwd(),
        'src',
        'db',
        'migrations',
        '0003_agents_charter_content.rollback.sql'
      );

      const forward = await fs.readFile(forwardPath, 'utf-8');
      const rollback = await fs.readFile(rollbackPath, 'utf-8');

      expect(forward).toContain('IF NOT EXISTS');
      expect(rollback).toContain('IF EXISTS');
    });
  });
});

