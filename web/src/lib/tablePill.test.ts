import { describe, expect, it } from 'vitest'
import { pillContent } from './tablePill'

describe('pillContent', () => {
  it('shows a warning glyph and "no rls" when has_rls is false', () => {
    const r = pillContent({
      hasRls: false,
      rlsForced: false,
      governanceStatus: 'red',
    })
    expect(r).toEqual({ glyph: '⚠', text: 'no rls' })
  })

  it('ignores governanceStatus when has_rls is false (red wins)', () => {
    // Defensive: a green status with hasRls=false shouldn't happen,
    // but if it did we'd surface the more urgent signal.
    const r = pillContent({
      hasRls: false,
      rlsForced: true,
      governanceStatus: 'green',
    })
    expect(r.text).toBe('no rls')
    expect(r.glyph).toBe('⚠')
  })

  it('shows "rls" with no glyph for has_rls + yellow (no proofs yet)', () => {
    expect(
      pillContent({
        hasRls: true,
        rlsForced: false,
        governanceStatus: 'yellow',
      }),
    ).toEqual({ glyph: null, text: 'rls' })
  })

  it('shows "rls forced" when rls_forced is true and not proven', () => {
    expect(
      pillContent({
        hasRls: true,
        rlsForced: true,
        governanceStatus: 'yellow',
      }),
    ).toEqual({ glyph: null, text: 'rls forced' })
  })

  it('shows "proven" with check glyph for green (Phase 4)', () => {
    expect(
      pillContent({
        hasRls: true,
        rlsForced: false,
        governanceStatus: 'green',
      }),
    ).toEqual({ glyph: '✓', text: 'proven' })
  })

  it('prefers "proven" over "rls forced" when both apply', () => {
    // green + rlsForced: the proof is what matters; enforcement is
    // already covered by the proof.
    expect(
      pillContent({
        hasRls: true,
        rlsForced: true,
        governanceStatus: 'green',
      }),
    ).toEqual({ glyph: '✓', text: 'proven' })
  })
})
