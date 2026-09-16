import { describe, expect, test } from "bun:test";
import { prDescriptionExcerpt } from "./pr-description";

describe("prDescriptionExcerpt", () => {
  test("keeps the prose and drops the section headings around it", () => {
    expect(
      prDescriptionExcerpt(
        "## Summary\n\nAdds a hover card to PR chips.\n\n## Testing\n\n- `bun test`\n- Captured both widths",
      ),
    ).toBe("Adds a hover card to PR chips. bun test Captured both widths");
  });

  test("strips markup down to its text", () => {
    expect(
      prDescriptionExcerpt(
        "> **Note:** see [the design](https://example.com/design) and _this_ *that* `code`.\n\n- [x] done\n1. first",
      ),
    ).toBe("Note: see the design and this that code. done first");
  });

  test("drops what only reads on GitHub's page", () => {
    expect(
      prDescriptionExcerpt(
        [
          "Fixes the flicker.",
          "",
          "![before](https://example.com/a.png)",
          '<img src="https://example.com/b.png" width="400">',
          "",
          "<details><summary>Test output</summary>",
          "",
          "```\n42 pass\n```",
          "",
          "</details>",
          "",
          "<!-- opensession:walkthrough -->",
          "## Walkthrough",
          "A mirrored section.",
          "<!-- /opensession:walkthrough -->",
          "",
          "| a | b |",
          "|---|---|",
          "",
          "---",
          "",
          "Started by Kent in [this OS session](https://os.example.dev/session/os-1)",
        ].join("\n"),
      ),
    ).toBe("Fixes the flicker.");
  });

  test("leaves identifiers with underscores alone", () => {
    expect(prDescriptionExcerpt("Renames snake_case_name to other_name.")).toBe(
      "Renames snake_case_name to other_name.",
    );
  });

  test("caps a long description at a word", () => {
    const excerpt = prDescriptionExcerpt("word ".repeat(120));
    expect(excerpt.length).toBeLessThanOrEqual(301);
    expect(excerpt.endsWith("word…")).toBe(true);
  });

  test("is empty for an empty or missing body", () => {
    expect(prDescriptionExcerpt("")).toBe("");
    expect(prDescriptionExcerpt(undefined)).toBe("");
    expect(prDescriptionExcerpt("## Summary\n\n<!-- nothing -->")).toBe("");
  });
});
