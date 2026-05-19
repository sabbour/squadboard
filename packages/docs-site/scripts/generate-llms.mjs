import {readdir, readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const siteDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const docsDir = path.join(siteDir, 'docs');
const staticDir = path.join(siteDir, 'static');

function parseFrontMatter(markdown) {
  if (!markdown.startsWith('---\n')) {
    return {attributes: {}, body: markdown};
  }

  const end = markdown.indexOf('\n---\n', 4);
  if (end === -1) {
    return {attributes: {}, body: markdown};
  }

  const block = markdown.slice(4, end);
  const attributes = {};
  for (const line of block.split('\n')) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    attributes[key] = rawValue.replace(/^["']|["']$/g, '');
  }

  return {
    attributes,
    body: markdown.slice(end + '\n---\n'.length),
  };
}

async function listMarkdownFiles(dir, base = dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMarkdownFiles(fullPath, base));
    } else if (entry.isFile() && /\.(md|mdx)$/.test(entry.name)) {
      files.push(path.relative(base, fullPath));
    }
  }

  return files.sort();
}

function routeFor(relativePath, attributes) {
  if (attributes.slug === '/') {
    return '/squadboard/docs/';
  }

  const withoutExt = relativePath.replace(/\.(md|mdx)$/, '');
  return `/squadboard/docs/${withoutExt}`;
}

function normalizeForLlms(markdown) {
  return markdown
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('import '))
    .join('\n')
    .trim();
}

const files = await listMarkdownFiles(docsDir);
const pages = [];

for (const relativePath of files) {
  const fullPath = path.join(docsDir, relativePath);
  const markdown = await readFile(fullPath, 'utf8');
  const {attributes, body} = parseFrontMatter(markdown);
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  const title = attributes.title || heading || relativePath;
  const description = attributes.description || body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || '';

  pages.push({
    relativePath,
    title,
    description,
    route: routeFor(relativePath, attributes),
    markdown: normalizeForLlms(body),
  });
}

const index = [
  '# Squadboard documentation index',
  '',
  'Machine-readable entry point for the Squadboard documentation site.',
  '',
  ...pages.map((page) => `- [${page.title}](${page.route}) - ${page.description}`),
  '',
].join('\n');

const full = [
  '# Squadboard full documentation',
  '',
  'All docs pages concatenated for LLM ingestion.',
  '',
  ...pages.map((page) => [
    `## ${page.title}`,
    '',
    `Source: ${page.route}`,
    '',
    page.markdown,
    '',
  ].join('\n')),
].join('\n');

await mkdir(staticDir, {recursive: true});
await writeFile(path.join(staticDir, 'llms.txt'), index, 'utf8');
await writeFile(path.join(staticDir, 'llms-full.txt'), full, 'utf8');

console.log(`[docs] generated llms.txt and llms-full.txt for ${pages.length} pages`);
