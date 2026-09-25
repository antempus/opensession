/**
 * Deterministic pre-push safety gate.
 *
 * Refuses to push a diff (measured as the added lines vs the branch's base) that
 * contains a high-confidence secret, adds a symlink or submodule, touches an
 * off-limits path, or blows past size caps. It runs BEFORE a secret can reach
 * the remote — the post-push trufflehog scan and LLM review (agents/github/
 * secret-scan.ts, review.ts) only flag a leak after it is already exposed, and a
 * pushed secret is compromised even if a later commit removes it.
 *
 * This is a fast, certain tripwire, not a complete scanner: a pre-push blocker
 * must be deterministic, so the secret layer here is high-confidence regex only.
 * The deeper, fuzzier net (entropy, verified detectors, semantic leaks) stays in
 * the post-push review, which is where "regex is not enough" is answered.
 *
 * Ported from foreman's src/publish.ts validateWork. Adapted to Open Session's
 * in-place worktree model: the base is the merge-base with origin/<defaultBranch>
 * rather than a handed-out base commit.
 */
import type { WorkspaceExec } from "./sandbox/workspace-exec";

export interface PushGatePolicy {
  maxChangedFiles: number;
  maxDiffBytes: number;
}

export const DEFAULT_PUSH_GATE_POLICY: PushGatePolicy = {
  maxChangedFiles: 200,
  maxDiffBytes: 2 * 1024 * 1024,
};

/** Paths the agent must never publish: CI it could rewrite to run on the
 *  runner, and the git-internal files that turn a checkout into a code-exec
 *  vector (see git-dir hardening). */
export const PUSH_GATE_FORBIDDEN_PATHS: RegExp[] = [
  /^\.github\/workflows\//,
  /(^|\/)\.git(attributes|modules)$/,
  /^\.git\//,
];

/** High-confidence secret shapes only. A blocker for accidents, not a guarantee. */
export const PUSH_GATE_SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{22,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
];

export type PushGateResult = { ok: true } | { blocked: string };

async function gitOut(
  dir: string,
  args: string[],
  exec?: WorkspaceExec,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const argv = ["git", "-C", dir, ...args];
  if (exec) {
    const r = await exec(argv);
    return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  }
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** Parse `git diff --raw` output into checked paths, flagging modes/paths that
 *  must not be pushed. Exported for testing without a real repo. */
export function evaluateRawDiff(
  rawDiff: string,
  policy: PushGatePolicy = DEFAULT_PUSH_GATE_POLICY,
): PushGateResult {
  const changed: string[] = [];
  for (const line of rawDiff.split("\n").filter(Boolean)) {
    const m = /^:(\d{6}) (\d{6}) \S+ \S+ (\S+)\t(.+)$/.exec(line);
    if (!m) continue;
    const [, , dstMode, status, pathPart] = m;
    const path =
      (status.startsWith("R") || status.startsWith("C")
        ? pathPart.split("\t").pop()
        : pathPart) ?? pathPart;
    changed.push(path);
    if (dstMode === "120000")
      return { blocked: `refusing to push a symlink (${path})` };
    if (dstMode === "160000")
      return { blocked: `refusing to push a submodule reference (${path})` };
    if (PUSH_GATE_FORBIDDEN_PATHS.some((re) => re.test(path)))
      return {
        blocked: `refusing to push a change to ${path}, which is off limits to the agent`,
      };
  }
  if (changed.length > policy.maxChangedFiles)
    return {
      blocked: `refusing to push ${changed.length} changed files, over the ${policy.maxChangedFiles} limit`,
    };
  return { ok: true };
}

/** Scan a unified-diff patch for size and secrets on ADDED lines only.
 *  Exported for testing. */
export function evaluatePatch(
  patch: string,
  policy: PushGatePolicy = DEFAULT_PUSH_GATE_POLICY,
): PushGateResult {
  if (Buffer.byteLength(patch, "utf8") > policy.maxDiffBytes)
    return {
      blocked: `refusing to push a diff larger than ${policy.maxDiffBytes} bytes`,
    };
  // Pre-existing content is not the agent's doing; scan only added lines so the
  // gate does not cry wolf on secrets that were already in the repo.
  const added = patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
  for (const [label, pattern] of PUSH_GATE_SECRET_PATTERNS) {
    if (pattern.test(added))
      return {
        blocked: `the diff looks like it contains a ${label}; refusing to push`,
      };
  }
  return { ok: true };
}

/**
 * Run the deterministic gate against the working tree in `dir`, diffed from its
 * merge-base with `origin/<baseBranch>`. Returns `{ ok: true }` to allow the
 * push, or `{ blocked }` with a human-readable reason to refuse it.
 *
 * Fails OPEN: if the base cannot be resolved or a git command fails, the gate
 * allows the push rather than bricking a legitimate one over an infra hiccup.
 * A real violation always fails closed.
 */
export async function preflightPushGate(opts: {
  dir: string;
  baseBranch: string;
  exec?: WorkspaceExec;
  policy?: PushGatePolicy;
}): Promise<PushGateResult> {
  const { dir, baseBranch, exec } = opts;
  const policy = opts.policy ?? DEFAULT_PUSH_GATE_POLICY;

  const mb = await gitOut(
    dir,
    ["merge-base", "HEAD", `origin/${baseBranch}`],
    exec,
  );
  const base = mb.stdout.trim();
  if (mb.code !== 0 || !base) return { ok: true };

  const raw = await gitOut(dir, ["diff", "--raw", "-M", `${base}..HEAD`], exec);
  if (raw.code !== 0) return { ok: true };
  const rawResult = evaluateRawDiff(raw.stdout, policy);
  if ("blocked" in rawResult) return rawResult;

  const patch = await gitOut(dir, ["diff", `${base}..HEAD`], exec);
  if (patch.code !== 0) return { ok: true };
  return evaluatePatch(patch.stdout, policy);
}
