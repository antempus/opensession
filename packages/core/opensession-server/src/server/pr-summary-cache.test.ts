import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo } from "./config";
import type { PrDetails } from "./pr-contract";
import type { PrInfo } from "./pr-cache";

test("summary reuse expires with the detail row, even during restart grace", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pr-summary-cache-"));
  const priorStateDir = process.env.OPENSESSION_STATE_DIR;
  process.env.OPENSESSION_STATE_DIR = stateDir;
  const now = spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const repo: Repo = {
    id: "summary-test",
    repo: process.cwd(),
    ghRepo: "tellahq/summary-test",
    label: "Summary test",
    wtPrefix: "wt-",
    defaultBranch: "main",
  };
  const details: PrDetails = {
    number: 407,
    title: "A PR that will merge",
    url: "https://github.com/tellahq/summary-test/pull/407",
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    reviewDecision: "",
    author: "someone",
    body: "Description from the review pane.",
    checks: [],
    comments: [],
    commits: [],
    files: [],
    reviewers: [],
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    staging: null,
  };
  await writeFile(
    join(stateDir, ".opensession-pr-details-cache.json"),
    JSON.stringify({
      [`${repo.ghRepo}\u0000feature`]: { data: details, ts: Date.now() },
    }),
  );
  const info = await import("./pr-info");
  const bulk = await import("./pr-cache");
  const limit = await import("./github-limit");
  const { getPrSummary } = await import("./pr-summary");
  const row: PrInfo = {
    ...details,
    createdAt: "2026-09-16T09:00:00Z",
    updatedAt: "2026-09-16T09:00:00Z",
    checks: { total: 0, passed: 0, failed: 0, pending: 0 },
    reviewRequested: [],
    reviewedBy: [],
    assignees: [],
  };
  const bulkRead = spyOn(bulk, "getPrsByRepo").mockReturnValue(
    new Map([[repo.id, new Map([["feature", row]])]]),
  );
  // Any attempt to fetch fails closed instead of reaching GitHub in this test.
  const priorBackoff = limit.__setGhBackoffForTest(Date.now() + 3_600_000);
  try {
    info.loadPrDetailsSnapshot();
    expect(info.cachedPrDetails(repo.ghRepo, "missing")).toBeNull();
    expect(await getPrSummary(repo, 407)).toMatchObject({
      state: "OPEN",
      body: details.body,
    });
    now.mockReturnValue(1_800_000_000_000 + 5 * 60_000 - 1);
    expect(info.cachedPrDetails(repo.ghRepo, "feature")?.number).toBe(407);

    // The bulk poll has learned of the merge, but nobody reopened the review.
    row.state = "MERGED";
    now.mockReturnValue(1_800_000_000_000 + 5 * 60_000);
    expect(info.cachedPrDetails(repo.ghRepo, "feature")).toBeNull();
    // No summary cache exists yet: the expired details must fall through to
    // the fetch path (rate-limited here), not keep answering OPEN forever.
    await expect(getPrSummary(repo, 407)).rejects.toThrow(
      info.GH_RATE_LIMIT_MESSAGE,
    );
  } finally {
    limit.__setGhBackoffForTest(priorBackoff);
    bulkRead.mockRestore();
    now.mockRestore();
    if (priorStateDir === undefined) delete process.env.OPENSESSION_STATE_DIR;
    else process.env.OPENSESSION_STATE_DIR = priorStateDir;
    await rm(stateDir, { recursive: true, force: true });
  }
});
