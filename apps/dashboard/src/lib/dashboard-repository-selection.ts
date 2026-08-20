export function parseRepositorySelection(
  repositories: string | undefined,
  availableRepositoryIds: string[],
) {
  if (!repositories) return []
  const selected = new Set(
    repositories
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )
  const ordered = availableRepositoryIds.filter((repositoryId) =>
    selected.has(repositoryId),
  )
  return ordered.length === 0 ||
    ordered.length === availableRepositoryIds.length
    ? []
    : ordered
}

export function resolveRepositorySelection(
  repositories: string | undefined,
  availableRepositoryIds: string[],
) {
  const selectedRepositoryIds = parseRepositorySelection(
    repositories,
    availableRepositoryIds,
  )
  const requestedIds = repositories
    ? repositories
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : []
  const availableSet = new Set(availableRepositoryIds)
  return {
    shouldClear:
      requestedIds.length > 0 &&
      requestedIds.some((repositoryId) => !availableSet.has(repositoryId)),
    selectedRepositoryIds,
  }
}

export function serializeRepositorySelection(
  selectedRepositoryIds: string[],
  availableRepositoryIds: string[],
) {
  if (
    selectedRepositoryIds.length === 0 ||
    selectedRepositoryIds.length === availableRepositoryIds.length
  ) {
    return undefined
  }
  const selected = new Set(selectedRepositoryIds)
  return (
    availableRepositoryIds
      .filter((repositoryId) => selected.has(repositoryId))
      .join(',') || undefined
  )
}
