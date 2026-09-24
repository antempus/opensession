import { describe, expect, test } from "bun:test";
import {
  classifyTopology,
  isUpstreamReleaseBase,
  parseRemotes,
  parseSha256Checksum,
  resolveReleaseBase,
} from "./update";

const UPSTREAM_HTTPS = "https://github.com/tellahq/opensession.git";
const UPSTREAM_SSH = "git@github.com:tellahq/opensession.git";
const FORK = "git@github.com:acme/opensession.git";

describe("parseSha256Checksum", () => {
  const digest = "a".repeat(64);

  test("accepts sha256sum sidecars and bare digests", () => {
    expect(
      parseSha256Checksum(`${digest}  opensession-linux-x64.tar.gz\n`),
    ).toBe(digest);
    expect(parseSha256Checksum(digest.toUpperCase())).toBe(digest);
  });

  test("rejects malformed or non-SHA-256 values", () => {
    expect(parseSha256Checksum("not-a-checksum file.tar.gz")).toBeUndefined();
    expect(parseSha256Checksum("a".repeat(63))).toBeUndefined();
    expect(parseSha256Checksum("")).toBeUndefined();
  });
});

describe("parseRemotes", () => {
  test("parses fetch remotes and ignores push duplicates", () => {
    const out = [
      `origin\t${FORK} (fetch)`,
      `origin\t${FORK} (push)`,
      `upstream\t${UPSTREAM_HTTPS} (fetch)`,
      `upstream\t${UPSTREAM_HTTPS} (push)`,
    ].join("\n");
    expect(parseRemotes(out)).toEqual([
      { name: "origin", url: FORK },
      { name: "upstream", url: UPSTREAM_HTTPS },
    ]);
  });

  test("empty input parses to no remotes", () => {
    expect(parseRemotes("")).toEqual([]);
  });
});

describe("classifyTopology", () => {
  test("origin = fork + upstream remote → fork topology from that remote", () => {
    for (const url of [UPSTREAM_HTTPS, UPSTREAM_SSH]) {
      expect(
        classifyTopology([
          { name: "origin", url: FORK },
          { name: "upstream", url },
        ]),
      ).toEqual({ source: "upstream", kind: "fork" });
    }
  });

  test("the upstream remote may have any name", () => {
    expect(
      classifyTopology([
        { name: "origin", url: FORK },
        { name: "tella", url: UPSTREAM_SSH },
      ]),
    ).toEqual({ source: "tella", kind: "fork" });
  });

  test("origin-only clone of the upstream project stays ff-only", () => {
    expect(classifyTopology([{ name: "origin", url: UPSTREAM_HTTPS }])).toEqual(
      {
        source: "origin",
        kind: "origin",
      },
    );
  });

  test("origin IS the upstream project even with extra remotes → ff-only origin", () => {
    // Both remotes point at the project (e.g. our own instance): fork-merge
    // semantics would be wrong; plain ff from origin is.
    expect(
      classifyTopology([
        { name: "origin", url: UPSTREAM_SSH },
        { name: "mirror", url: UPSTREAM_HTTPS },
      ]),
    ).toEqual({ source: "origin", kind: "origin" });
  });

  test("fork origin without an upstream remote stays ff-only against origin", () => {
    expect(classifyTopology([{ name: "origin", url: FORK }])).toEqual({
      source: "origin",
      kind: "origin",
    });
  });

  test("no remotes at all → conservative default", () => {
    expect(classifyTopology([])).toEqual({ source: "origin", kind: "origin" });
  });
});

describe("isUpstreamReleaseBase", () => {
  test("true only for the upstream project releases", () => {
    expect(
      isUpstreamReleaseBase(
        "https://github.com/tellahq/opensession/releases/latest/download",
      ),
    ).toBe(true);
    expect(
      isUpstreamReleaseBase(
        "  https://github.com/tellahq/opensession/releases/latest/download  ",
      ),
    ).toBe(true);
  });

  test("false for a fork or an unrelated host", () => {
    expect(
      isUpstreamReleaseBase(
        "https://github.com/acme/opensession/releases/latest/download",
      ),
    ).toBe(false);
    expect(isUpstreamReleaseBase("https://example.test/releases")).toBe(false);
    expect(
      isUpstreamReleaseBase(
        "http://github.com/tellahq/opensession/releases/latest/download",
      ),
    ).toBe(false);
  });
});

describe("resolveReleaseBase", () => {
  test("the env override wins and is reported as the source", async () => {
    const prev = process.env.OPENSESSION_RELEASE_BASE;
    process.env.OPENSESSION_RELEASE_BASE =
      "https://example.test/releases/latest/download";
    try {
      expect(await resolveReleaseBase()).toEqual({
        base: "https://example.test/releases/latest/download",
        source: "env",
      });
    } finally {
      if (prev === undefined) delete process.env.OPENSESSION_RELEASE_BASE;
      else process.env.OPENSESSION_RELEASE_BASE = prev;
    }
  });

  test("without env, resolves to config or the compiled default", async () => {
    const prev = process.env.OPENSESSION_RELEASE_BASE;
    delete process.env.OPENSESSION_RELEASE_BASE;
    try {
      const { base, source } = await resolveReleaseBase();
      expect(source === "config" || source === "default").toBe(true);
      expect(base).toMatch(/^https:\/\/github\.com\/[^/]+\/opensession\//);
    } finally {
      if (prev !== undefined) process.env.OPENSESSION_RELEASE_BASE = prev;
    }
  });
});
