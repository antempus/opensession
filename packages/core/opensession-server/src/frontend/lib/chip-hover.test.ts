import { describe, expect, test } from "bun:test";
import {
  chipPr,
  chipPrIsWorthShowing,
  chipSelector,
  chipTarget,
  createChipAnchor,
} from "./chip-hover";
import type { OpenPr, PrSummary, RecentPr } from "./api";
import type { UnifiedSession } from "./types";

// The chips are HTML the markdown renderer wrote, so the only handle the card
// has on them is their data attributes. A fake element is enough to pin that.
let matchingChips: HTMLElement[] = [];
Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    createElement: () => ({ dataset: {} }),
    querySelectorAll: () => matchingChips,
  },
});

const chip = (dataset: Record<string, string>) => {
  const element = document.createElement("span");
  Object.assign(element.dataset, dataset);
  return element;
};

const session = (over: Partial<UnifiedSession>): UnifiedSession => ({
  id: "os-1",
  title: "Give the PR chips a hover card",
  source: "opensession",
  branch: "chip-hover-cards",
  worktreeDir: null,
  startedBy: "kent",
  createdAt: "2026-08-14T09:00:00.000Z",
  lastActivity: "2026-08-14T10:00:00.000Z",
  isRunning: false,
  ...over,
});

const openPr = (over: Partial<OpenPr>): OpenPr => ({
  repo: "opensession",
  branch: "chip-hover-cards",
  url: "https://github.com/tellahq/opensession/pull/128",
  number: 128,
  title: "Hover cards for transcript chips",
  isDraft: false,
  reviewDecision: "",
  author: "kentdebruin",
  person: "kent",
  createdAt: "2026-08-14T08:00:00.000Z",
  updatedAt: "2026-08-14T09:30:00.000Z",
  checks: { total: 4, passed: 4, failed: 0, pending: 0 },
  ...over,
});

const recentPr = (over: Partial<RecentPr>): RecentPr => ({
  ...openPr({}),
  state: "MERGED",
  additions: 120,
  deletions: 24,
  ...over,
});

const summary = (over: Partial<PrSummary>): PrSummary => ({
  repo: "opensession",
  number: 128,
  title: "Hover cards for transcript chips",
  url: "https://github.com/tellahq/opensession/pull/128",
  state: "MERGED",
  isDraft: false,
  branch: "chip-hover-cards",
  author: "kentdebruin",
  body: "## Summary\n\nOne card off the hovered chip.",
  additions: 130,
  deletions: 30,
  changedFiles: 5,
  reviewDecision: "APPROVED",
  createdAt: "2026-08-14T08:00:00.000Z",
  updatedAt: "2026-08-14T11:00:00.000Z",
  ...over,
});

describe("chipTarget", () => {
  test("reads a session chip", () => {
    expect(chipTarget(chip({ sessionId: "os-019f" }))).toEqual({
      kind: "session",
      key: "session:os-019f",
      id: "os-019f",
    });
  });

  test("reads a PR chip", () => {
    expect(
      chipTarget(chip({ prRepo: "opensession", prNumber: "128" })),
    ).toEqual({
      kind: "pr",
      key: "pr:opensession#128",
      repo: "opensession",
      number: 128,
    });
  });

  test("ignores an anchor that names neither", () => {
    expect(chipTarget(chip({ assetPath: "shot.png" }))).toBeNull();
  });
});

describe("createChipAnchor", () => {
  const target = {
    kind: "pr" as const,
    key: "pr:opensession#128",
    repo: "opensession",
    number: 128,
  };
  function element(left: number, top: number) {
    const rect = {
      x: left,
      y: top,
      left,
      top,
      width: 60,
      height: 20,
      right: left + 60,
      bottom: top + 20,
      toJSON: () => ({}),
    };
    const el = {
      isConnected: true,
      getBoundingClientRect: () => {
        if (!el.isConnected) throw new Error("Measured a detached chip");
        return rect;
      },
    };
    // SAFETY: the anchor only reads these two HTMLElement members; this test
    // supplies both and deliberately rejects measurements after detachment.
    return {
      el: el as HTMLElement,
      rect,
      disconnect: () => {
        el.isConnected = false;
      },
    };
  }

  test("keeps the hovered occurrence while it is connected", () => {
    const first = element(100, 100);
    const hovered = element(100, 700);
    matchingChips = [first.el, hovered.el];
    const anchor = createChipAnchor(hovered.el, target);
    expect(anchor.contextElement).toBe(hovered.el);
    expect(anchor.getBoundingClientRect()).toBe(hovered.rect);
  });

  test("re-anchors to the nearest duplicate after replacement during dwell", () => {
    const hovered = element(100, 700);
    const anchor = createChipAnchor(hovered.el, target);
    hovered.disconnect();
    const earlier = element(100, 100);
    const replacement = element(102, 704);
    const later = element(100, 1200);
    matchingChips = [earlier.el, replacement.el, later.el];
    expect(anchor.getBoundingClientRect()).toBe(replacement.rect);
    expect(anchor.contextElement).toBe(replacement.el);

    // Keep following that occurrence on subsequent transcript ticks.
    replacement.rect.top = 900;
    anchor.getBoundingClientRect();
    replacement.disconnect();
    const next = element(100, 905);
    matchingChips = [earlier.el, next.el, later.el];
    expect(anchor.getBoundingClientRect()).toBe(next.rect);
  });

  test("distinguishes repeated mentions on the same line", () => {
    const hovered = element(500, 700);
    const anchor = createChipAnchor(hovered.el, target);
    hovered.disconnect();
    const first = element(100, 700);
    const second = element(502, 700);
    matchingChips = [first.el, second.el];
    expect(anchor.contextElement).toBe(second.el);
  });

  test("retains the last rectangle when no visible replacement exists", () => {
    const hovered = element(100, 700);
    const anchor = createChipAnchor(hovered.el, target);
    hovered.disconnect();
    const hidden = element(0, 0);
    hidden.rect.width = 0;
    matchingChips = [hidden.el];
    expect(anchor.getBoundingClientRect()).toBe(hovered.rect);
    matchingChips = [];
    expect(anchor.getBoundingClientRect()).toBe(hovered.rect);
  });
});

describe("chipSelector", () => {
  test("finds the same chip again after the transcript is rewritten", () => {
    expect(
      chipSelector({ kind: "pr", key: "", repo: "opensession", number: 128 }),
    ).toBe('a.pr-ref[data-pr-repo="opensession"][data-pr-number="128"]');
    expect(chipSelector({ kind: "session", key: "", id: "os-019f" })).toBe(
      'a.session-link[data-session-id="os-019f"]',
    );
    expect(chipSelector({ kind: "commit", key: "", sha: "4ed1ef09" })).toBe(
      '.commit-ref[data-commit-sha="4ed1ef09"]:not([data-commit-repo])',
    );
    expect(
      chipSelector({
        kind: "commit",
        key: "",
        sha: "4ed1ef09",
        repo: "webapp",
      }),
    ).toBe(
      '.commit-ref[data-commit-sha="4ed1ef09"][data-commit-repo="webapp"]',
    );
  });
});

describe("chipPr", () => {
  test("is null when nothing loaded knows the PR", () => {
    expect(chipPr("opensession", 128, [], [])).toBeNull();
    expect(chipPrIsWorthShowing(null)).toBe(false);
  });

  test("takes the rich half from the open list and the session that owns it", () => {
    const owner = session({
      repo: "opensession",
      prNumber: 128,
      branch: "chip-hover-cards",
    });
    const pr = chipPr("opensession", 128, [owner], [openPr({})]);
    expect(pr?.title).toBe("Hover cards for transcript chips");
    expect(pr?.author).toBe("kentdebruin");
    expect(pr?.session?.id).toBe("os-1");
    expect(chipPrIsWorthShowing(pr)).toBe(true);
  });

  test("a PR no session owns still resolves from the open list", () => {
    const pr = chipPr("opensession", 128, [], [openPr({})]);
    expect(pr?.title).toBe("Hover cards for transcript chips");
    expect(pr?.session).toBeUndefined();
  });

  // The open-PR list is cached for a minute and holds only open PRs, so a PR
  // the session list already saw merge must not read as open.
  test("lifecycle comes from the fresher session list", () => {
    const owner = session({
      repo: "opensession",
      prNumber: 128,
      prState: "MERGED",
    });
    expect(chipPr("opensession", 128, [owner], [openPr({})])?.state).toBe(
      "MERGED",
    );
  });

  test("an archived PR resolves from recent history without a live session", () => {
    const pr = chipPr("opensession", 128, [], [], [recentPr({})]);
    expect(pr).toMatchObject({
      title: "Hover cards for transcript chips",
      state: "MERGED",
      additions: 120,
      deletions: 24,
    });
    expect(chipPrIsWorthShowing(pr)).toBe(true);
  });

  test("terminal history beats stale open session and open-list state", () => {
    const owner = session({
      repo: "opensession",
      prNumber: 128,
      prState: "OPEN",
    });
    const pr = chipPr(
      "opensession",
      128,
      [owner],
      [openPr({})],
      [recentPr({ state: "CLOSED" })],
    );
    expect(pr?.state).toBe("CLOSED");
  });

  test("keeps richer live conflict status while a PR remains open", () => {
    const owner = session({
      repo: "opensession",
      prNumber: 128,
      prState: "OPEN",
      prMergeable: "CONFLICTING",
    });
    const pr = chipPr(
      "opensession",
      128,
      [owner],
      [openPr({ mergeable: "UNKNOWN" })],
      [recentPr({ state: "OPEN", mergeable: "UNKNOWN" })],
    );
    expect(pr?.mergeable).toBe("CONFLICTING");
  });

  // A PR merged before the recent window opened is in no list the app holds;
  // the summary read is what lets its chip have a card at all.
  test("a PR no list knows resolves from the summary alone", () => {
    const pr = chipPr("opensession", 128, [], [], [], summary({}));
    expect(pr).toMatchObject({
      title: "Hover cards for transcript chips",
      state: "MERGED",
      author: "kentdebruin",
      branch: "chip-hover-cards",
      body: "## Summary\n\nOne card off the hovered chip.",
      changedFiles: 5,
    });
    expect(chipPrIsWorthShowing(pr)).toBe(true);
  });

  // The summary is GitHub's current answer, so it wins on lifecycle and
  // identity, but it knows nothing of what only this instance tracks.
  test("the summary leads on identity and keeps the instance's own facts", () => {
    const owner = session({
      repo: "opensession",
      prNumber: 128,
      prState: "OPEN",
      prChecks: { total: 4, passed: 3, failed: 0, pending: 1 },
    });
    const pr = chipPr(
      "opensession",
      128,
      [owner],
      [openPr({ title: "Old title", reviewRequested: ["kent"] })],
      [],
      summary({ title: "New title", state: "MERGED" }),
    );
    expect(pr?.title).toBe("New title");
    expect(pr?.state).toBe("MERGED");
    expect(pr?.additions).toBe(130);
    expect(pr?.checks).toEqual({ total: 4, passed: 3, failed: 0, pending: 1 });
    expect(pr?.reviewRequested).toEqual(["kent"]);
    expect(pr?.session?.id).toBe("os-1");
  });

  test("a summary miss leaves the list sources in charge", () => {
    const pr = chipPr("opensession", 128, [], [openPr({})], [], null);
    expect(pr?.title).toBe("Hover cards for transcript chips");
    expect(pr?.body).toBeUndefined();
  });

  test("falls back to the PRs a session merely spans", () => {
    const spanning = session({
      repo: "tella-fusion",
      prs: [
        {
          repo: "opensession",
          branch: "chip-hover-cards",
          source: "attached",
          number: 128,
          title: "Hover cards for transcript chips",
          state: "OPEN",
        },
      ],
    });
    const pr = chipPr("opensession", 128, [spanning], []);
    expect(pr?.title).toBe("Hover cards for transcript chips");
    expect(pr?.branch).toBe("chip-hover-cards");
  });
});
