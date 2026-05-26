/**
 * Pure-logic helper for the governance-status pill in TableNode.
 *
 * Pair an icon with text so the status is conveyed without relying on
 * color alone. RLS-on doesn't carry a glyph — the word "rls" is the
 * affirmative signal. Kept as a pure function (returns plain strings,
 * not JSX) so it's exercisable from Vitest without rendering React.
 */
export interface PillContent {
  glyph: string | null
  text: string
}

export interface PillInput {
  hasRls: boolean
  rlsForced: boolean
  governanceStatus: 'red' | 'yellow' | 'green' | 'gray'
}

export function pillContent(d: PillInput): PillContent {
  if (!d.hasRls) {
    return { glyph: '⚠', text: 'no rls' }
  }
  if (d.governanceStatus === 'green') {
    return { glyph: '✓', text: 'proven' }
  }
  return { glyph: null, text: d.rlsForced ? 'rls forced' : 'rls' }
}
