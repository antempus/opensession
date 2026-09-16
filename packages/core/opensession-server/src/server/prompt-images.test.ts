import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripContext } from "./prompt-context";
import { stagePromptImages, withImagesNote } from "./prompt-images";

// A pasted image reaches the model through the vision channel, so it can see
// the picture but was never told where the bytes live. Asked to commit or
// convert one, runs went looking for a file and invented a person-side
// "upload it in the Assets tab" step that does not exist. The staging runs in
// the engine's process against the session scratch dir, so the path is real
// on a Runner or inside a Sandbox too, not only on the server.
const SCRATCH = mkdtempSync(join(tmpdir(), "prompt-images-"));

// A 1x1 PNG, small enough to keep the fixtures readable.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const png = { mediaType: "image/png", data: PNG.toString("base64") };

describe("stagePromptImages", () => {
  test("stages each image once, by content, under the scratch dir", () => {
    const first = stagePromptImages(SCRATCH, [png, png]);
    expect(first.map((s) => s.name)).toEqual(["image-1.png", "image-2.png"]);
    // The same bytes share one file, so a retried or steered delivery of the
    // same screenshot never piles up copies.
    expect(first[0].path).toBe(first[1].path);
    expect(first[0].path).toStartWith(`${SCRATCH}/attachments/image-`);
    expect(readFileSync(first[0].path)).toEqual(PNG);

    const again = stagePromptImages(SCRATCH, [png]);
    expect(again[0].path).toBe(first[0].path);
    expect(readFileSync(again[0].path)).toEqual(PNG);
  });

  test("skips what it cannot name or store, and everything without a scratch dir", () => {
    expect(stagePromptImages(SCRATCH, undefined)).toEqual([]);
    expect(stagePromptImages(SCRATCH, [])).toEqual([]);
    // No scratch dir (an unusable session id or an fs failure upstream): the
    // vision channel still carries the picture, there is just no path to name.
    expect(stagePromptImages(undefined, [png])).toEqual([]);
    const staged = stagePromptImages(SCRATCH, [
      { mediaType: "image/heic", data: PNG.toString("base64") },
      { mediaType: "image/png", data: "" },
      png,
    ]);
    // Names count the message's images, so the note still says which one it is.
    expect(staged.map((s) => s.name)).toEqual(["image-3.png"]);
  });
});

describe("withImagesNote", () => {
  test("fences the note so the transcript shows only the message", () => {
    const staged = stagePromptImages(SCRATCH, [png]);
    const prompt = withImagesNote("Use this icon", staged);
    expect(prompt).toStartWith(
      'Use this icon\n\n<opensession:context source="uploads-note">',
    );
    expect(prompt).toContain(`- image-1.png: ${staged[0].path}`);
    expect(prompt).toContain("cannot upload there");
    expect(prompt).toEndWith("</opensession:context>");
    expect(stripContext(prompt).trim()).toBe("Use this icon");
    expect(withImagesNote("plain", [])).toBe("plain");
  });

  test("does not stack a second note on a prompt that already carries it", () => {
    const staged = stagePromptImages(SCRATCH, [png]);
    const once = withImagesNote("Use this icon", staged);
    expect(withImagesNote(once, staged)).toBe(once);
  });
});
