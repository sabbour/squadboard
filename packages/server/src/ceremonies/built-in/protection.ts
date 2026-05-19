export const PROTECTED_BUILT_IN_CEREMONY_SLUGS = ['scribe-close-out', 'work-pickup'] as const;

const protectedSlugs = new Set<string>(PROTECTED_BUILT_IN_CEREMONY_SLUGS);

export function builtInSourceMarker(slug: string): string {
  return `import:built-in/${slug}`;
}

export function isProtectedBuiltInCeremony(row: { slug: string; triggerConfig: unknown }): boolean {
  if (!protectedSlugs.has(row.slug)) return false;
  if (!row.triggerConfig || typeof row.triggerConfig !== 'object') return false;
  const sourceYamlPath = (row.triggerConfig as { sourceYamlPath?: unknown }).sourceYamlPath;
  return sourceYamlPath === builtInSourceMarker(row.slug);
}

