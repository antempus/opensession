/**
 * Deterministic secret scan on the PR's added content (openclaw autoreview
 * style): TruffleHog with the low-false-positive `verified,unknown` results
 * policy — a credential that TruffleHog actively verified against its provider,
 * or couldn't definitively verify, blocks; a definitively-invalid match is
 * dropped. Unlike model judgment this has a real oracle, so it runs as a
 * sidecar next to the model review (like test-on-base) rather than as a prompt
 * instruction.
 *
 * TruffleHog's git source uses go-git, which chokes on linked worktrees (our
 * review checkouts), so instead of scanning the repo we snapshot the post-image
 * of every file the PR adds/modifies into a temp dir, scan that with the
 * filesystem source, and keep only findings that land on a line the PR ADDED
 * (per `git diff -U0`). That makes the claim precise — "this PR introduces this
 * credential" — and never blames a pre-existing secret in a touched file.
 *
 * Fails soft everywhere: no trufflehog binary, git errors, or a scan timeout
 * all return a skipped result and the review proceeds without the section.
 */
import { audit } from "../../server/audit";
import { runCommand } from "../../server/run-command";
import {
  parseAddedLines,
  scanAddedContentWithTrufflehog,
  trufflehogBin,
  type SecretFinding,
  type SecretScanResult,
} from "../../server/trufflehog-scan";

export {
  parseAddedLines,
  type SecretFinding,
  type SecretScanResult,
} from "../../server/trufflehog-scan";

const GIT_TIMEOUT_MS = 30_000;

export async function runSecretScanCheck(opts: {
  /** Review worktree pinned to the PR head. */
  cwd: string;
  baseRefName: string;
  prNumber: number;
  ghRepo?: string;
  /** Test seam: scanner binary override. */
  bin?: string;
}): Promise<SecretScanResult> {
  const done = (result: SecretScanResult): SecretScanResult => {
    audit({
      msg: "review_secret_scan",
      pr_number: opts.prNumber,
      repo: opts.ghRepo,
      checked_files: result.checkedFiles,
      findings: result.findings.length,
      ...(result.skipped ? { skipped: result.skipped } : {}),
    });
    return result;
  };
  const skip = (reason: string) =>
    done({ findings: [], checkedFiles: 0, skipped: reason });

  const bin = opts.bin || trufflehogBin();
  if (!bin) return skip("trufflehog not installed");

  const mb = await runCommand(
    ["git", "merge-base", "HEAD", `origin/${opts.baseRefName}`],
    {
      cwd: opts.cwd,
      timeoutMs: GIT_TIMEOUT_MS,
    },
  );
  const mergeBase = mb.stdout.trim();
  if (mb.status !== 0 || !mergeBase)
    return skip(`merge-base failed: ${mb.stderr.trim().slice(0, 200)}`);

  const diff = await runCommand(
    [
      "git",
      "diff",
      "-U0",
      "--no-color",
      "--find-renames",
      "--diff-filter=AM",
      mergeBase,
      "HEAD",
    ],
    { cwd: opts.cwd, timeoutMs: GIT_TIMEOUT_MS },
  );
  if (diff.status !== 0)
    return skip(`diff failed: ${diff.stderr.trim().slice(0, 200)}`);
  const addedLines = parseAddedLines(diff.stdout);
  if (!addedLines.size) return skip("no added lines");

  return done(
    await scanAddedContentWithTrufflehog(opts.cwd, addedLines, { bin }),
  );
}

/** Summary-comment section for a scan that found secrets ("" when clean/skipped). */
export function secretScanSection(result: SecretScanResult | null): string {
  if (!result || result.skipped || !result.findings.length) return "";
  const rows = result.findings
    .map(
      (f) =>
        `- \`${f.file}:${f.line}\` — ${f.detector}${f.redacted ? ` (\`${f.redacted}\`)` : ""}${f.verified ? " — **verified live**" : ""}`,
    )
    .join("\n");
  return [
    `\n\n🚨 **Secret scan** — TruffleHog flagged ${result.findings.length} credential${result.findings.length === 1 ? "" : "s"} introduced on lines this PR adds:`,
    rows,
    "_Treat these as leaked: rotate the credential now, then remove it from the branch (a follow-up commit that deletes the line does NOT un-leak it from git history). (Deterministic check: TruffleHog `verified,unknown` policy over the PR's added lines.)_",
  ].join("\n");
}
