import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { getIssueDetails } from "./api";

// Spy on global fetch (what fetchWithTimeout calls) rather than mock.module —
// a spy restores cleanly per test and never leaks into other suites.
let fetchSpy: ReturnType<typeof spyOn> | undefined;

function stubIssue(issue: Record<string, unknown>): void {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue({
    json: async () => ({ data: { issue } }),
  } as unknown as Response);
}

afterEach(() => {
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

const baseIssue = {
  identifier: "ENG-1",
  title: "Title",
  description: "Body",
  url: "https://linear.app/x/issue/ENG-1",
  state: { name: "In Progress" },
  team: { id: "TEAM_1" },
  creator: { id: "c1", name: "Cee", email: "cee@example.com" },
};

describe("getIssueDetails", () => {
  test("returns the issue's label names", async () => {
    stubIssue({
      ...baseIssue,
      labels: { nodes: [{ name: "backend" }, { name: "urgent" }] },
    });
    const details = await getIssueDetails("token", "ISSUE_1");
    expect(details.labels).toEqual(["backend", "urgent"]);
  });

  test("returns an empty label list when the issue has none", async () => {
    stubIssue({ ...baseIssue, labels: { nodes: [] } });
    const details = await getIssueDetails("token", "ISSUE_1");
    expect(details.labels).toEqual([]);
  });
});
