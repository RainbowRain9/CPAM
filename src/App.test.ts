import { describe, expect, it } from 'vitest'

import { formatLocalDateKey } from './App'

describe('App date helpers', () => {
  it('formats daily summary keys from local date parts instead of UTC ISO strings', () => {
    const fakeLocalMidnight = {
      getFullYear: () => 2026,
      getMonth: () => 2,
      getDate: () => 13,
      toISOString: () => '2026-03-12T16:00:00.000Z',
    } as Date

    expect(formatLocalDateKey(fakeLocalMidnight)).toBe('2026-03-13')
  })
})
