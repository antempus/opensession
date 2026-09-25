import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PUSH_GATE_POLICY,
  evaluatePatch,
  evaluateRawDiff,
  preflightPushGate,
} from "./pre-push-gate";

const raw = (mode: string, status: string, path: string) =>
  `:100644 ${mode} 0000000 0000000 ${status}\t${path}`;

describe("evaluateRawDiff", () => {
  test("allows an ordinary changed file", () => {
    expect(evaluateRawDiff(raw("100644", "M", "src/app.ts"))).toEqual({
      ok: true,
    });
  });

  test("blocks a symlink and a submodule", () => {
    expect(evaluateRawDiff(raw("120000", "A", "link"))).toEqual({
      blocked: "refusing to push a symlink (link)",
    });
    expect(evaluateRawDiff(raw("160000", "A", "vendor/lib"))).toEqual({
      blocked: "refusing to push a submodule reference (vendor/lib)",
    });
  });

  test("blocks off-limits paths", () => {
    for (const p of [
      ".github/workflows/ci.yml",
      ".gitattributes",
      ".gitmodules",
      ".git/config",
    ]) {
      const r = evaluateRawDiff(raw("100644", "A", p));
      expect("blocked" in r && r.blocked).toContain(p);
    }
  });

  test("enforces the changed-file cap", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      raw("100644", "M", `f${i}.ts`),
    ).join("\n");
    const r = evaluateRawDiff(many, { maxChangedFiles: 3, maxDiffBytes: 1e9 });
    expect("blocked" in r && r.blocked).toContain("over the 3 limit");
  });
});

describe("evaluatePatch", () => {
  test("blocks a high-confidence secret on an added line", () => {
    const patch = [
      "diff --git a/x b/x",
      "+++ b/x",
      "+const t = 'ghp_" + "a".repeat(36) + "';",
    ].join("\n");
    const r = evaluatePatch(patch);
    expect("blocked" in r && r.blocked).toContain("GitHub token");
  });

  test("ignores a secret that is only on a context or removed line", () => {
    const secret = "AKIA" + "ABCDEFGHIJKLMNOP";
    const patch = [
      "diff --git a/x b/x",
      ` const existing = '${secret}';`, // context (leading space)
      `-const removed = '${secret}';`, // removal
    ].join("\n");
    expect(evaluatePatch(patch)).toEqual({ ok: true });
  });

  test("does not flag +++ header lines as additions", () => {
    const patch = ["+++ b/AKIA" + "ABCDEFGHIJKLMNOP.txt", "+ordinary"].join(
      "\n",
    );
    expect(evaluatePatch(patch)).toEqual({ ok: true });
  });

  test("enforces the byte cap", () => {
    const patch = "+" + "x".repeat(100);
    const r = evaluatePatch(patch, { maxChangedFiles: 1e9, maxDiffBytes: 10 });
    expect("blocked" in r && r.blocked).toContain("larger than 10 bytes");
  });
});

describe("preflightPushGate", () => {
  function fakeExec(map: Record<string, { code: number; stdout: string }>) {
    const exec = async (argv: string[]) => {
      const key = argv.slice(3).join(" "); // drop "git -C <dir>"
      const hit =
        map[key] ??
        Object.entries(map).find(([k]) => key.startsWith(k))?.[1] ??
        null;
      if (!hit) return { exitCode: 0, stdout: "", stderr: "" };
      return { exitCode: hit.code, stdout: hit.stdout, stderr: "" };
    };
    return Object.assign(exec, { sandboxed: false, remote: false } as const);
  }

  test("fails open when the base cannot be resolved", async () => {
    const exec = fakeExec({
      "merge-base HEAD origin/main": { code: 1, stdout: "" },
    });
    expect(
      await preflightPushGate({ dir: "/w", baseBranch: "main", exec }),
    ).toEqual({ ok: true });
  });

  test("blocks a forbidden path found in the raw diff", async () => {
    const exec = fakeExec({
      "merge-base HEAD origin/main": { code: 0, stdout: "abc123\n" },
      "diff --raw -M abc123..HEAD": {
        code: 0,
        stdout: raw("100644", "A", ".github/workflows/x.yml"),
      },
    });
    const r = await preflightPushGate({ dir: "/w", baseBranch: "main", exec });
    expect("blocked" in r && r.blocked).toContain(".github/workflows/x.yml");
  });

  test("allows a clean diff", async () => {
    const exec = fakeExec({
      "merge-base HEAD origin/main": { code: 0, stdout: "abc123\n" },
      "diff --raw -M abc123..HEAD": {
        code: 0,
        stdout: raw("100644", "M", "src/app.ts"),
      },
      "diff abc123..HEAD": { code: 0, stdout: "+const ok = 1;" },
    });
    expect(
      await preflightPushGate({ dir: "/w", baseBranch: "main", exec }),
    ).toEqual({ ok: true });
  });

  test("default policy caps are sane", () => {
    expect(DEFAULT_PUSH_GATE_POLICY.maxChangedFiles).toBeGreaterThan(0);
    expect(DEFAULT_PUSH_GATE_POLICY.maxDiffBytes).toBeGreaterThan(0);
  });
});
