export interface StartOptions {
  help: boolean;
  squadStorageProvider?: string;
}

export interface StartOptionsLogger {
  log(message: string): void;
  warn(message: string): void;
}

export function parseStartArgs(startArgs: string[]): StartOptions {
  const options: StartOptions = { help: false };

  for (let i = 0; i < startArgs.length; i++) {
    const arg = startArgs[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--postgresql-storage') {
      options.squadStorageProvider = 'postgresql';
      continue;
    }

    if (arg.startsWith('--squad-storage=')) {
      options.squadStorageProvider = arg.slice('--squad-storage='.length);
      continue;
    }

    if (arg === '--squad-storage') {
      const value = startArgs[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --squad-storage. Use "postgresql" or "fs".');
      }
      options.squadStorageProvider = value;
      i++;
      continue;
    }

    throw new Error(`Unknown start option: ${arg}`);
  }

  return options;
}

export function applyStartOptions(
  options: StartOptions,
  env: NodeJS.ProcessEnv = process.env,
  logger: StartOptionsLogger = console,
): void {
  const rawProvider = options.squadStorageProvider?.trim().toLowerCase();
  if (!rawProvider) return;

  env['SQUADBOARD_SQUAD_STORAGE_PROVIDER'] = rawProvider;

  if (rawProvider === 'postgresql') {
    logger.log('[squadboard] Squad storage provider: postgresql');
  } else if (rawProvider === 'fs') {
    logger.log('[squadboard] Squad storage provider: filesystem');
  } else {
    logger.warn(
      `[squadboard] Unrecognized Squad storage provider "${rawProvider}" — using filesystem fallback. Use "postgresql" for the default database provider.`,
    );
  }
}
