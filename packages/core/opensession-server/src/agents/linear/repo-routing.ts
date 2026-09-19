/**
 * Repo selection for Linear-triggered agent sessions.
 *
 * OpenSession's Linear integration otherwise runs every session in the single
 * instance `defaultRepo()`. This resolves a repo per issue from the issue's
 * labels and team, so different Linear work can land in different repos.
 *
 * Precedence: a repo whose `linearLabels` matches any of the issue's labels
 * (case-insensitive), else a repo whose `linearTeams` contains the issue's
 * team id, else `defaultRepo()`. On multiple matches the registry (config)
 * order wins, so the choice is deterministic.
 */
import { configuredRepos, defaultRepo } from "../../server/config";
import type { Repo } from "../../server/config";

export function resolveLinearRepoId(
  labels: string[],
  teamId: string | undefined,
  repos: Record<string, Repo> = configuredRepos(),
): string {
  const entries = Object.values(repos);
  const wanted = new Set(labels.map((l) => l.toLowerCase()));

  for (const repo of entries) {
    if (repo.linearLabels?.some((l) => wanted.has(l.toLowerCase()))) {
      return repo.id;
    }
  }

  if (teamId) {
    for (const repo of entries) {
      if (repo.linearTeams?.includes(teamId)) return repo.id;
    }
  }

  return defaultRepo(repos).id;
}
