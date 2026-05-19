import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const builtInSourceDir = join('src', 'ceremonies', 'built-in');
const builtInDistDir = join('dist', 'ceremonies', 'built-in');

mkdirSync(builtInDistDir, { recursive: true });

for (const fileName of readdirSync(builtInSourceDir)) {
  if (!fileName.endsWith('.workflow.yaml')) {
    continue;
  }

  copyFileSync(join(builtInSourceDir, fileName), join(builtInDistDir, fileName));
}
