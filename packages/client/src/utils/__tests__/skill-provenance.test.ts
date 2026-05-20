import { describe, expect, it } from 'vitest'
import { formatCuratedSkillLabel, getSkillProvenanceMeta } from '../skill-provenance.ts'

describe('skill provenance labels', () => {
  it('distinguishes cloned curated skills from immutable catalog entries', () => {
    expect(getSkillProvenanceMeta('curated', 'review-checklist')).toEqual({
      label: 'Curated clone',
      title: "Cloned from Squadboard's curated skill catalog (review-checklist).",
    })
  })

  it('labels imported skills with their source URI when present', () => {
    expect(getSkillProvenanceMeta('imported', null, 'bundle:starter')).toEqual({
      label: 'Imported file',
      title: 'Imported from bundle:starter.',
    })
  })

  it('formats curated key chips explicitly', () => {
    expect(formatCuratedSkillLabel('release-notes')).toBe('curated: release-notes')
  })
})
