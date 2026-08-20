import { expect, it } from 'vitest'

import {
  parseRepositorySelection,
  resolveRepositorySelection,
  serializeRepositorySelection,
} from '#/lib/dashboard-repository-selection'

const available = ['repo:atlas', 'unattributed', 'repo:web']

it('round trips URL-backed repository selections in stable option order', () => {
  expect(
    parseRepositorySelection('repo:web,unknown,repo:atlas', available),
  ).toEqual(['repo:atlas', 'repo:web'])
  expect(
    serializeRepositorySelection(['repo:web', 'repo:atlas'], available),
  ).toBe('repo:atlas,repo:web')
})

it('uses a missing selection for All and preserves Unattributed as an explicit state', () => {
  expect(parseRepositorySelection(undefined, available)).toEqual([])
  expect(serializeRepositorySelection([], available)).toBeUndefined()
  expect(serializeRepositorySelection(available, available)).toBeUndefined()
  expect(parseRepositorySelection('unattributed', available)).toEqual([
    'unattributed',
  ])
  expect(serializeRepositorySelection(['unattributed'], available)).toBe(
    'unattributed',
  )
})

it('marks selections unavailable after other filters for URL clearing', () => {
  expect(resolveRepositorySelection('repo:atlas', ['repo:web'])).toEqual({
    shouldClear: true,
    selectedRepositoryIds: [],
  })
  expect(resolveRepositorySelection(undefined, ['repo:web'])).toEqual({
    shouldClear: false,
    selectedRepositoryIds: [],
  })
  expect(resolveRepositorySelection('repo:web', ['repo:web'])).toEqual({
    shouldClear: false,
    selectedRepositoryIds: [],
  })
})
