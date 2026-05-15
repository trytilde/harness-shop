import { describe, expect, it } from 'vitest'

import {
  DEFAULT_HARNESS_ID,
  HARNESS_DEFINITIONS,
  getHarnessDefinition,
} from '#/lib/harness-definitions'

describe('harness definitions', () => {
  it('exposes the expected harness cards', () => {
    expect(HARNESS_DEFINITIONS.map((h) => h.id)).toEqual([
      'experiment',
      'factory-cli-provider',
    ])
  })

  it('falls back to the default harness', () => {
    expect(getHarnessDefinition('missing').id).toBe(DEFAULT_HARNESS_ID)
  })
})
