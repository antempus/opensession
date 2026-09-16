import { describe, expect, test } from "bun:test";
import { prSummaryFromDetails, prSummaryFromView } from "./pr-summary";
import type { PrDetails } from "./pr-contract";

describe("prSummaryFromView", () => {
  test("flattens gh's payload into the card's shape", () => {
    expect(
      prSummaryFromView("webapp", {
        number: 6775,
        title: "Give PR chips a hover card",
        url: "https://github.com/tellahq/webapp/pull/6775",
        state: "MERGED",
        isDraft: false,
        headRefName: "pr-link-popover",
        author: { login: "happylinks" },
        body: "## Summary\n\nA card.",
        additions: 120,
        deletions: 24,
        changedFiles: 6,
        reviewDecision: "APPROVED",
        createdAt: "2026-09-15T09:00:00Z",
        updatedAt: "2026-09-16T09:00:00Z",
      }),
    ).toEqual({
      repo: "webapp",
      number: 6775,
      title: "Give PR chips a hover card",
      url: "https://github.com/tellahq/webapp/pull/6775",
      state: "MERGED",
      isDraft: false,
      branch: "pr-link-popover",
      author: "happylinks",
      body: "## Summary\n\nA card.",
      additions: 120,
      deletions: 24,
      changedFiles: 6,
      reviewDecision: "APPROVED",
      createdAt: "2026-09-15T09:00:00Z",
      updatedAt: "2026-09-16T09:00:00Z",
    });
  });

  test("reads the same shape off a loaded detail row", () => {
    const details: PrDetails = {
      number: 128,
      title: "Fix flaky upload retry test",
      url: "https://github.com/acme/acme-todo/pull/128",
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: "demo/fix-flaky-upload",
      additions: 12,
      deletions: 3,
      changedFiles: 2,
      reviewDecision: "APPROVED",
      author: "acme-demo-bot",
      body: "The retry loop skipped the final attempt.",
      checks: [],
      comments: [],
      commits: [],
      files: [],
      reviewers: [],
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      staging: null,
    };
    expect(
      prSummaryFromDetails("acme-todo", details, {
        createdAt: "2026-09-15T09:00:00Z",
      }),
    ).toEqual({
      repo: "acme-todo",
      number: 128,
      title: "Fix flaky upload retry test",
      url: "https://github.com/acme/acme-todo/pull/128",
      state: "OPEN",
      isDraft: false,
      branch: "demo/fix-flaky-upload",
      author: "acme-demo-bot",
      body: "The retry loop skipped the final attempt.",
      additions: 12,
      deletions: 3,
      changedFiles: 2,
      reviewDecision: "APPROVED",
      createdAt: "2026-09-15T09:00:00Z",
      updatedAt: "",
    });
  });

  test("fills what gh leaves null", () => {
    const pr = prSummaryFromView("webapp", {
      number: 1,
      title: "t",
      url: "u",
      state: "OPEN",
      isDraft: true,
      headRefName: "b",
      author: { name: "Someone" },
      body: null,
      reviewDecision: null,
      createdAt: "2026-09-15T09:00:00Z",
      updatedAt: "2026-09-15T09:00:00Z",
    });
    expect(pr).toMatchObject({
      author: "Someone",
      body: "",
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      reviewDecision: "",
    });
  });
});
