import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface PathEnvironment {
  platform: NodeJS.Platform;
  isWsl: boolean;
  homePath: string;
  workspacePath: string;
  separator: string;
}

export interface BrowseRoot {
  label: string;
  path: string;
}

export interface BrowseDirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseDirectoryResult {
  path: string;
  parentPath: string | null;
  roots: BrowseRoot[];
  entries: BrowseDirectoryEntry[];
  environment: PathEnvironment;
}

const WINDOWS_DRIVE_PATH = /^([A-Za-z]):[\\/](.*)$/;
const MAX_BROWSE_ENTRIES = 500;

export function isWsl(): boolean {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    const release = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf-8').toLowerCase();
    return release.includes('microsoft') || release.includes('wsl');
  } catch {
    return false;
  }
}

function wslAutomountRoot(): string {
  if (!isWsl()) return '/mnt';
  try {
    const conf = fs.readFileSync('/etc/wsl.conf', 'utf-8');
    let inAutomount = false;
    for (const rawLine of conf.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*/, '').trim();
      if (!line) continue;
      if (/^\[.*\]$/.test(line)) {
        inAutomount = line.toLowerCase() === '[automount]';
        continue;
      }
      if (inAutomount) {
        const match = line.match(/^root\s*=\s*(.+)$/i);
        if (match?.[1]) return match[1].trim().replace(/[\\/]+$/, '') || '/mnt';
      }
    }
  } catch {
    // Default WSL automount root.
  }
  return '/mnt';
}

export function getPathEnvironment(): PathEnvironment {
  return {
    platform: process.platform,
    isWsl: isWsl(),
    homePath: os.homedir(),
    workspacePath: process.cwd(),
    separator: path.sep,
  };
}

export function normalizeUserSuppliedPath(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (!trimmed) return trimmed;

  let candidate = trimmed;
  if (candidate === '~' || candidate.startsWith('~/') || candidate.startsWith('~\\')) {
    candidate = path.join(os.homedir(), candidate.slice(2));
  }

  const driveMatch = candidate.match(WINDOWS_DRIVE_PATH);
  if (driveMatch && process.platform !== 'win32') {
    if (!isWsl()) {
      throw Object.assign(
        new Error('Windows drive paths are only accepted when Squadboard is running under WSL. Use a path on the server filesystem.'),
        { status: 422, code: 'unsupported_windows_path' },
      );
    }
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replace(/\\/g, '/');
    candidate = path.posix.join(wslAutomountRoot(), drive, rest);
  }

  return path.resolve(candidate);
}

async function existingDirectory(pathValue: string): Promise<string | null> {
  try {
    const stat = await fsp.stat(pathValue);
    if (!stat.isDirectory()) return null;
    return await fsp.realpath(pathValue);
  } catch {
    return null;
  }
}

async function buildBrowseRoots(): Promise<BrowseRoot[]> {
  const candidates: BrowseRoot[] = [
    { label: 'Home', path: os.homedir() },
    { label: 'Workspace', path: process.cwd() },
  ];

  if (process.platform === 'win32') {
    for (const root of new Set([path.parse(os.homedir()).root, path.parse(process.cwd()).root])) {
      if (root) candidates.push({ label: root.replace(/[\\/]$/, ''), path: root });
    }
  } else if (isWsl()) {
    const mountRoot = wslAutomountRoot();
    try {
      const mounts = await fsp.readdir(mountRoot, { withFileTypes: true });
      for (const mount of mounts) {
        if (mount.isDirectory() && /^[a-z]$/i.test(mount.name)) {
          candidates.push({
            label: `Windows drive ${mount.name.toUpperCase()}:`,
            path: path.posix.join(mountRoot, mount.name),
          });
        }
      }
    } catch {
      // WSL automounts are optional.
    }
  }

  const roots: BrowseRoot[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const real = await existingDirectory(candidate.path);
    if (!real || seen.has(real)) continue;
    roots.push({ label: candidate.label, path: real });
    seen.add(real);
  }
  return roots;
}

function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel));
}

async function assertBrowseAllowed(requestedPath: string, roots: BrowseRoot[]): Promise<string> {
  const real = await existingDirectory(requestedPath);
  if (!real) {
    throw Object.assign(new Error(`Directory does not exist: ${requestedPath}`), { status: 404 });
  }

  const rootPaths = roots.map((root) => root.path);
  if (!rootPaths.some((root) => isWithin(root, real))) {
    throw Object.assign(
      new Error('Choose a folder under Home, the current workspace, or an available mounted drive.'),
      { status: 403, code: 'browse_root_not_allowed' },
    );
  }
  return real;
}

export async function browseServerDirectory(inputPath?: string): Promise<BrowseDirectoryResult> {
  const roots = await buildBrowseRoots();
  const requested = normalizeUserSuppliedPath(inputPath?.trim() || os.homedir());
  const currentPath = await assertBrowseAllowed(requested, roots);
  const rootForCurrent = roots.find((root) => isWithin(root.path, currentPath)) ?? null;

  const parent = path.dirname(currentPath);
  const parentPath = rootForCurrent && isWithin(rootForCurrent.path, parent) && parent !== currentPath
    ? parent
    : null;

  const dirents = await fsp.readdir(currentPath, { withFileTypes: true });
  const entries = dirents
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_BROWSE_ENTRIES)
    .map((entry) => ({
      name: entry.name,
      path: path.join(currentPath, entry.name),
    }));

  return {
    path: currentPath,
    parentPath,
    roots,
    entries,
    environment: getPathEnvironment(),
  };
}
