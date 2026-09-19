/**
 * Repo-routing through the real config seam — proves `linearLabels`/`linearTeams`
 * survive `configuredRepos()` resolution and drive the actual worktree path.
 * (The unit test injects a repo map directly and so never exercises config
 * parsing.) Same no-side-effect config seam as session-repo-id.test.ts.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getConfigAsync } from "../../server/config";
import { worktreePathFor } from "../../server/worktree";
import { resolveLinearRepoId } from "./repo-routing";

const ENV_KEYS = ["OPENSESSION_CONFIG", "OPENSESSION_WORKTREES_DIR"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
const dirs: string[] = [];
const WT_DIR = "/linear-route-test/worktrees";

async function withConfig(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "os-linear-route-"));
  dirs.push(dir);
  const path = join(dir, "config.json");
  writeFileSync(
    path,
    JSON.stringify({
      paths: { worktreesDir: WT_DIR },
      repos: {
        scratch: {
          repo: "/linear-route-test/scratch",
          wtPrefix: "scratch",
          default: true,
        },
        foreman: {
          repo: "/linear-route-test/foreman",
          wtPrefix: "foreman",
          linearLabels: ["backend"],
          linearTeams: ["TEAM_FM"],
        },
        web: {
          repo: "/linear-route-test/web",
          wtPrefix: "web",
          linearLabels: ["frontend"],
        },
      },
    }),
  );
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.OPENSESSION_CONFIG = path;
  process.env.OPENSESSION_WORKTREES_DIR = WT_DIR;
  await getConfigAsync();
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("Linear repo-routing through real config", () => {
  test("linearLabels survives config resolution and routes the worktree path", async () => {
    await withConfig();
    const repoId = resolveLinearRepoId(["backend"], undefined);
    expect(repoId).toBe("foreman");
    expect(worktreePathFor("feat-x", repoId)).toBe(`${WT_DIR}/foreman-feat-x`);
  });

  test("routes by team when only a team matches", async () => {
    await withConfig();
    expect(resolveLinearRepoId([], "TEAM_FM")).toBe("foreman");
  });

  test("falls back to the default repo when nothing matches", async () => {
    await withConfig();
    const repoId = resolveLinearRepoId(["nope"], "TEAM_NONE");
    expect(repoId).toBe("scratch");
    expect(worktreePathFor("feat-x", repoId)).toBe(`${WT_DIR}/scratch-feat-x`);
  });
});
