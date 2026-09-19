import { describe, test, expect } from "bun:test";
import { resolveLinearRepoId } from "./repo-routing";
import type { Repo } from "../../server/config";

function repo(id: string, extra: Partial<Repo> = {}): Repo {
  return {
    id,
    label: id,
    repo: `/repos/${id}`,
    wtPrefix: id,
    defaultBranch: "main",
    ghRepo: "",
    ...extra,
  };
}

// Registry insertion order: `web` first, `foreman` second (the default).
const repos: Record<string, Repo> = {
  web: repo("web", {
    linearLabels: ["web", "frontend"],
    linearTeams: ["TEAM_WEB"],
  }),
  foreman: repo("foreman", {
    linearLabels: ["foreman", "backend"],
    linearTeams: ["TEAM_FM"],
    default: true,
  }),
};

describe("resolveLinearRepoId", () => {
  test("routes by a matching issue label", () => {
    expect(resolveLinearRepoId(["backend"], undefined, repos)).toBe("foreman");
  });

  test("routes by team when no label matches", () => {
    expect(resolveLinearRepoId(["chore"], "TEAM_WEB", repos)).toBe("web");
  });

  test("a label match wins over a team match", () => {
    // label -> web, team -> foreman; label precedence means web.
    expect(resolveLinearRepoId(["frontend"], "TEAM_FM", repos)).toBe("web");
  });

  test("falls back to the default repo when nothing matches", () => {
    expect(resolveLinearRepoId(["unrelated"], "TEAM_NONE", repos)).toBe(
      "foreman",
    );
  });

  test("is deterministic on multiple label matches (registry order)", () => {
    const both: Record<string, Repo> = {
      web: repo("web", { linearLabels: ["shared"] }),
      foreman: repo("foreman", { linearLabels: ["shared"], default: true }),
    };
    expect(resolveLinearRepoId(["shared"], undefined, both)).toBe("web");
  });

  test("matches labels case-insensitively", () => {
    expect(resolveLinearRepoId(["Backend"], undefined, repos)).toBe("foreman");
  });
});
