import { describe, test, expect } from "bun:test";
import { resolveLinearModel } from "./model-routing";

const cfg = {
  modelLabels: [
    { label: "opus", model: "pi/anthropic/claude-opus-5" },
    { label: "fast", model: "pi/anthropic/claude-haiku-4-5" },
  ],
  fallbackModel: "pi/anthropic/claude-sonnet-5",
};
const DEFAULT = () => "GLOBAL_DEFAULT";

describe("resolveLinearModel", () => {
  test("routes by a matching label", () => {
    expect(resolveLinearModel(["opus"], cfg, DEFAULT)).toBe(
      "pi/anthropic/claude-opus-5",
    );
  });

  test("first matching rule wins (registry order)", () => {
    expect(resolveLinearModel(["fast", "opus"], cfg, DEFAULT)).toBe(
      "pi/anthropic/claude-opus-5",
    );
  });

  test("matches labels case-insensitively", () => {
    expect(resolveLinearModel(["OPUS"], cfg, DEFAULT)).toBe(
      "pi/anthropic/claude-opus-5",
    );
  });

  test("falls back to the configured fallback model when no label matches", () => {
    expect(resolveLinearModel(["unrelated"], cfg, DEFAULT)).toBe(
      "pi/anthropic/claude-sonnet-5",
    );
  });

  test("falls back to the global default when there is no fallback model", () => {
    expect(
      resolveLinearModel(
        ["unrelated"],
        { modelLabels: cfg.modelLabels },
        DEFAULT,
      ),
    ).toBe("GLOBAL_DEFAULT");
  });

  test("no config → global default", () => {
    expect(resolveLinearModel(["opus"], {}, DEFAULT)).toBe("GLOBAL_DEFAULT");
  });
});
