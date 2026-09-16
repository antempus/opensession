/**
 * One pull request by number, for the transcript chip's hover card.
 *
 * The PR caches (pr-cache.ts) know a repo's open PRs and a recent window of
 * merged ones, and neither keeps the body: it is read once for its
 * attribution footer and dropped. A chip can name any PR at all, though,
 * including one merged months ago, and the card behind it wants the title
 * and a line of the description. This is the one read that answers both:
 * `gh pr view <number>`, one GraphQL point, with only the fields the card
 * shows. The full detail read (pr-info.ts) pulls checks, files, comments and
 * the stack, which is far more than a hover should cost.
 *
 * Cached in memory per PR. A title and body change rarely, a merged PR never,
 * and a pointer crossing a paragraph of chips must not become a burst of
 * GitHub calls. A miss (no such PR) is cached too, so a chip pointing at a
 * number that was never a PR does not retry on every hover.
 */
import type { Repo } from "./config";
import {
  resolveGithubCredential,
  serviceGithubCredential,
} from "./github-auth";
import { noteGithubGraphqlCall } from "./github-budget";
import { ghRateLimited } from "./github-limit";
import { getPrsByRepo } from "./pr-cache";
import type { PrDetails } from "./pr-contract";
import {
  GH_RATE_LIMIT_MESSAGE,
  cachedPrDetails,
  isNoPrError,
  prApiErrorMessage,
} from "./pr-info";

export interface PrSummary {
  /** The instance-local repo id the chip was written against. */
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  branch: string;
  author: string;
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewDecision: string;
  createdAt: string;
  updatedAt: string;
}

/** What `gh pr view --json` answers with for the fields below. */
export interface PrViewPayload {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
  headRefName: string;
  author?: { login?: string; name?: string };
  body?: string | null;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  reviewDecision?: string | null;
  createdAt: string;
  updatedAt: string;
}

const VIEW_FIELDS =
  "number,title,url,state,isDraft,headRefName,author,body,additions,deletions,changedFiles,reviewDecision,createdAt,updatedAt";

const TTL_MS = 5 * 60_000;
/** Enough for every chip a day of transcripts mentions; oldest entries go
 *  first once it fills, so a long-lived server does not keep every PR it was
 *  ever asked about. */
const MAX_ENTRIES = 1000;

const cache = new Map<string, { pr: PrSummary | null; at: number }>();
const inflight = new Map<string, Promise<PrSummary | null>>();

function key(repo: Repo, number: number): string {
  return `${repo.id}#${number}`;
}

/** The card's shape from gh's, with the repo id the chip used put back on. */
export function prSummaryFromView(
  repoId: string,
  pr: PrViewPayload,
): PrSummary {
  return {
    repo: repoId,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    branch: pr.headRefName,
    author: pr.author?.login || pr.author?.name || "",
    body: pr.body || "",
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    changedFiles: pr.changedFiles ?? 0,
    reviewDecision: pr.reviewDecision || "",
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
  };
}

/** The same shape off a full detail row (pr-info.ts), for a PR whose review
 *  someone already has open: nothing to ask GitHub for. */
export function prSummaryFromDetails(
  repoId: string,
  pr: PrDetails,
  timestamps: { createdAt?: string; updatedAt?: string } = {},
): PrSummary {
  return {
    repo: repoId,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    branch: pr.headRefName,
    author: pr.author,
    body: pr.body || "",
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    reviewDecision: pr.reviewDecision || "",
    // The detail row carries no dates of its own; the bulk list does.
    createdAt: timestamps.createdAt || "",
    updatedAt: timestamps.updatedAt || "",
  };
}

/** A PR whose details this server already holds. The bulk cache is keyed by
 *  branch, so its row for this number is what names the branch the detail
 *  cache is keyed by; a PR in the bulk cache whose review nobody has opened
 *  has no detail row yet and falls through to the fetch. */
function summaryFromLoadedDetails(
  repo: Repo,
  number: number,
): PrSummary | null {
  for (const [branch, row] of getPrsByRepo().get(repo.id) ?? []) {
    if (row.number !== number) continue;
    const details = cachedPrDetails(repo.ghRepo, branch);
    if (!details || details.number !== number) return null;
    return prSummaryFromDetails(repo.id, details, {
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
  return null;
}

async function fetchPrSummary(
  repo: Repo,
  number: number,
): Promise<PrSummary | null> {
  const credential = await resolveGithubCredential(serviceGithubCredential, {
    repo: repo.ghRepo,
  });
  const started = Date.now();
  const proc = Bun.spawn(
    [
      "gh",
      "pr",
      "view",
      String(number),
      "--repo",
      repo.ghRepo,
      "--json",
      VIEW_FIELDS,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...credential.env },
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  noteGithubGraphqlCall("pr-summary", Date.now() - started, code === 0);
  if (code !== 0) {
    if (isNoPrError(err)) return null;
    throw new Error(prApiErrorMessage(err));
  }
  return prSummaryFromView(repo.id, JSON.parse(out) as PrViewPayload);
}

/**
 * The PR a chip names, or null when the repo has no PR by that number. Only
 * GitHub-hosted repos answer: a code.storage repo has no `gh pr view`, and
 * the chip there keeps its own tooltip.
 */
export async function getPrSummary(
  repo: Repo,
  number: number,
): Promise<PrSummary | null> {
  if (repo.host && repo.host !== "github") return null;
  const loaded = summaryFromLoadedDetails(repo, number);
  if (loaded) return loaded;
  const k = key(repo, number);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.pr;
  // In a backoff window a stale answer is still the right one to show, and
  // with nothing cached the friendly message beats a doomed gh call.
  if (ghRateLimited()) {
    if (hit) return hit.pr;
    throw new Error(GH_RATE_LIMIT_MESSAGE);
  }
  const pending = inflight.get(k);
  if (pending) return pending;
  const request = fetchPrSummary(repo, number)
    .then((pr) => {
      if (cache.size >= MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.delete(k);
      cache.set(k, { pr, at: Date.now() });
      return pr;
    })
    .catch((e) => {
      if (hit) return hit.pr;
      throw e;
    })
    .finally(() => inflight.delete(k));
  inflight.set(k, request);
  return request;
}
