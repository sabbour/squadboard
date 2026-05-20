export interface SkillProvenanceMeta {
  label: string
  title: string
}

export function getSkillProvenanceMeta(
  source?: string | null,
  curatedKey?: string | null,
  sourceUri?: string | null,
): SkillProvenanceMeta {
  switch (source) {
    case 'curated':
      return {
        label: 'Curated clone',
        title: curatedKey
          ? `Cloned from Squadboard's curated skill catalog (${curatedKey}).`
          : "Cloned from Squadboard's curated skill catalog.",
      }
    case 'imported':
      return {
        label: 'Imported file',
        title: sourceUri ? `Imported from ${sourceUri}.` : 'Imported from a SKILL.md or markdown file.',
      }
    case 'project':
      return {
        label: 'Project bundle',
        title: sourceUri ? `Provided by project bundle ${sourceUri}.` : 'Provided by a project or app bundle.',
      }
    case 'custom':
    default:
      return {
        label: 'Custom',
        title: 'Created directly in this project.',
      }
  }
}

export function formatCuratedSkillLabel(curatedKey: string): string {
  return `curated: ${curatedKey}`
}
