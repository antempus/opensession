/**
 * Shared TruffleHog secret-scan core, used by both the post-push PR review
 * sidecar (agents/github/secret-scan.ts) and the deterministic pre-push gate
 * (pre-push-gate.ts). Lives under server/ so the gate does not have to import
 * from agents/.
 *
 * The scan snapshots the post-image of every added/modified file into a temp dir
 * and runs TruffleHog's filesystem source over it (its git source chokes on
 * linked worktrees), keeping only findings on lines the diff ADDED so a
 * pre-existing secret in a touched file is never blamed. Fails soft everywhere:
 * no binary, git errors, or a scan timeout return a skipped result.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCommand } from "./run-command";

export interface SecretFinding {
  /** Repo-relative path. */
  file: string;
  /** 1-based line in the new version of the file. */
  line: number;
  detector: string;
  /** TruffleHog's redacted form (safe to post; never the raw value). */
  redacted: string;
  verified: boolean;
}

export interface SecretScanResult {
  findings: SecretFinding[];
  /** Changed files snapshotted and scanned. */
  checkedFiles: number;
  /** Non-empty when the scan didn't run, with the reason. */
  skipped: string;
}

const SCAN_TIMEOUT_MS = 180_000;
const MAX_FILES = 400;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FINDINGS = 20;

/**
 * Added-line numbers per new-file path from a `git diff -U0` patch.
 */
export function parseAddedLines(diff: string): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  let current: Set<number> | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path === "/dev/null") {
        current = null;
      } else {
        const rel = path.startsWith("b/") ? path.slice(2) : path;
        current = byFile.get(rel) || new Set();
        byFile.set(rel, current);
      }
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk && current) {
      const start = parseInt(hunk[1], 10);
      const count = hunk[2] === undefined ? 1 : parseInt(hunk[2], 10);
      for (let i = 0; i < count; i++) current.add(start + i);
    }
  }
  for (const [file, lines] of byFile) if (!lines.size) byFile.delete(file);
  return byFile;
}

export function trufflehogBin(): string | null {
  const onPath = Bun.which("trufflehog");
  if (onPath) return onPath;
  const home = join(homedir(), "bin", "trufflehog");
  return existsSync(home) ? home : null;
}

/**
 * Snapshot the post-image of each added/modified file and run TruffleHog over
 * it, keeping only findings on lines the diff ADDED. Pure scan — the caller
 * audits and decides what to do with the findings.
 */
export async function scanAddedContentWithTrufflehog(
  cwd: string,
  addedLines: Map<string, Set<number>>,
  opts: { bin?: string } = {},
): Promise<SecretScanResult> {
  const bin = opts.bin || trufflehogBin();
  if (!bin)
    return {
      findings: [],
      checkedFiles: 0,
      skipped: "trufflehog not installed",
    };
  if (!addedLines.size)
    return { findings: [], checkedFiles: 0, skipped: "no added lines" };

  const snapDir = mkdtempSync(join(tmpdir(), "os-secrets-"));
  try {
    let copied = 0;
    for (const file of [...addedLines.keys()].slice(0, MAX_FILES)) {
      const src = join(cwd, file);
      try {
        if (!existsSync(src) || statSync(src).size > MAX_FILE_BYTES) continue;
        mkdirSync(dirname(join(snapDir, file)), { recursive: true });
        copyFileSync(src, join(snapDir, file));
        copied++;
      } catch {}
    }
    if (!copied)
      return {
        findings: [],
        checkedFiles: 0,
        skipped: "no scannable changed files",
      };

    const scan = await runCommand(
      [
        bin,
        "filesystem",
        snapDir,
        "--results=verified,unknown",
        "--json",
        "--no-update",
      ],
      { timeoutMs: SCAN_TIMEOUT_MS },
    );
    // TruffleHog exits non-zero with --fail on hits; without it, non-zero means
    // the scan itself broke.
    if (scan.status !== 0)
      return {
        findings: [],
        checkedFiles: copied,
        skipped: `trufflehog exited ${scan.status}: ${scan.stderr.trim().slice(0, 200)}`,
      };

    const findings: SecretFinding[] = [];
    const seen = new Set<string>();
    for (const line of scan.stdout.split("\n")) {
      if (!line.trim()) continue;
      let f: any;
      try {
        f = JSON.parse(line);
      } catch {
        continue;
      }
      const meta = f?.SourceMetadata?.Data?.Filesystem;
      if (!meta?.file) continue;
      const rel = String(meta.file).startsWith(snapDir + "/")
        ? String(meta.file).slice(snapDir.length + 1)
        : String(meta.file);
      const lineNo = typeof meta.line === "number" ? meta.line : 0;
      // Only lines this diff added — a hit elsewhere in a touched file is a
      // pre-existing secret, not this diff's introduction.
      if (!lineNo || !addedLines.get(rel)?.has(lineNo)) continue;
      const key = `${rel}:${lineNo}:${f.DetectorName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        file: rel,
        line: lineNo,
        detector: String(f.DetectorName || "unknown"),
        redacted: String(f.Redacted || "").slice(0, 80),
        verified: !!f.Verified,
      });
      if (findings.length >= MAX_FINDINGS) break;
    }
    return { findings, checkedFiles: copied, skipped: "" };
  } finally {
    rmSync(snapDir, { recursive: true, force: true });
  }
}
