import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WorkflowTemplate {
  slug: string;
  name: string;
  description: string;
  yamlContent: string;
}

export function getBuiltinTemplates(): WorkflowTemplate[] {
  return [
    {
      slug: 'simple',
      name: 'Simple Review',
      description: 'Route → Agent Run → Approve. Best for most issues.',
      yamlContent: readFileSync(join(__dirname, 'simple.yaml'), 'utf-8'),
    },
  ];
}
