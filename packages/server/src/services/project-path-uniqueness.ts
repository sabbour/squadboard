import { getDb, schema } from '../db/index.js';
import { assertSelectableSquadWorkspace, normalizeSquadPath } from './squad-path-safety.js';

export interface ProjectPathOwner {
  id: string;
  name: string;
  path: string;
}

function canonicalizeStoredPath(inputPath: string): string {
  if (!inputPath.trim()) {
    throw Object.assign(new Error('Project folder path is required.'), {
      status: 400,
      code: 'missing_project_path',
    });
  }
  return normalizeSquadPath(inputPath);
}

function projectPathConflict(owner: ProjectPathOwner, squadPath: string): Error & {
  status: number;
  code: string;
  projectId: string;
  projectName: string;
  path: string;
} {
  return Object.assign(
    new Error(
      `Folder path is already registered to project "${owner.name}". ` +
      `Open that project or remove/update it before reusing ${squadPath}.`,
    ),
    {
      status: 409,
      code: 'duplicate_project_path',
      projectId: owner.id,
      projectName: owner.name,
      path: owner.path,
    },
  );
}

export async function findProjectBySquadPath(
  inputPath: string,
  options: { excludeProjectId?: string } = {},
): Promise<ProjectPathOwner | null> {
  const squadPath = canonicalizeStoredPath(inputPath);
  const rows = await getDb()
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      path: schema.projects.path,
    })
    .from(schema.projects);

  return rows.find((project) => {
    if (options.excludeProjectId && project.id === options.excludeProjectId) return false;
    return canonicalizeStoredPath(project.path) === squadPath;
  }) ?? null;
}

export async function assertProjectPathAvailable(
  inputPath: string,
  options: { excludeProjectId?: string } = {},
): Promise<string> {
  const squadPath = assertSelectableSquadWorkspace(canonicalizeStoredPath(inputPath));
  const owner = await findProjectBySquadPath(squadPath, options);
  if (owner) throw projectPathConflict(owner, squadPath);
  return squadPath;
}
