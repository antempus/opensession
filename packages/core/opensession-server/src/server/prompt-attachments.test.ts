import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripContext } from "./prompt-context";
import {
  MAX_SHIPPED_ATTACHMENT_BYTES,
  stagePromptFiles,
  stagePromptImages,
  withFilesNote,
  withImagesNote,
} from "./prompt-attachments";

// A pasted image reaches the model through the vision channel, so it can see
// the picture but was never told where the bytes live; a file attachment's
// note named a server path a Runner or Sandbox cannot read. Both are staged
// in the engine's process against the session scratch dir, so the path is
// real wherever the run's file tools execute.
const SCRATCH = mkdtempSync(join(tmpdir(), "prompt-attachments-"));

// A 1x1 PNG, small enough to keep the fixtures readable.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const png = { mediaType: "image/png", data: PNG.toString("base64") };
const brief = {
  name: "brief.pdf",
  data: Buffer.from("%PDF-1.4").toString("base64"),
};

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

describe("stagePromptFiles", () => {
  test("keeps the person's name, fenced by a content digest", () => {
    const [staged] = stagePromptFiles(SCRATCH, [brief]);
    expect(staged.name).toBe("brief.pdf");
    expect(staged.path).toMatch(
      new RegExp(`^${SCRATCH}/attachments/[0-9a-f]{16}-brief\\.pdf$`),
    );
    expect(readFileSync(staged.path, "utf8")).toBe("%PDF-1.4");
    // Same bytes, same file: a redelivery lands where the first one did.
    expect(stagePromptFiles(SCRATCH, [brief])[0].path).toBe(staged.path);
    // Different bytes under the same name stay apart.
    const other = stagePromptFiles(SCRATCH, [
      { name: "brief.pdf", data: Buffer.from("%PDF-1.7").toString("base64") },
    ]);
    expect(other[0].path).not.toBe(staged.path);
  });

  test("sanitizes the on-disk name and drops what it cannot store", () => {
    const [staged] = stagePromptFiles(SCRATCH, [
      {
        name: "../../etc/pass wd?.txt",
        data: Buffer.from("x").toString("base64"),
      },
    ]);
    expect(staged.name).toBe("../../etc/pass wd?.txt");
    expect(staged.path).toMatch(/\/attachments\/[0-9a-f]{16}-pass wd_\.txt$/);
    expect(stagePromptFiles(undefined, [brief])).toEqual([]);
    expect(stagePromptFiles(SCRATCH, [{ name: "empty", data: "" }])).toEqual(
      [],
    );
    expect(
      stagePromptFiles(SCRATCH, [
        {
          name: "huge.bin",
          data: Buffer.alloc(MAX_SHIPPED_ATTACHMENT_BYTES + 1).toString(
            "base64",
          ),
        },
      ]),
    ).toEqual([]);
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

describe("withFilesNote", () => {
  test("points the model at the scratch copies and past the host paths", () => {
    const staged = stagePromptFiles(SCRATCH, [brief]);
    const hostNote =
      "[The user attached 1 file(s), saved to disk — read them with your file tools if relevant:\n- brief.pdf: /srv/uploads/os-1/brief.pdf\n]";
    const prompt = withFilesNote(`Summarize this\n\n${hostNote}`, staged);
    expect(prompt).toContain("not reachable from here");
    expect(prompt).toContain(`- brief.pdf: ${staged[0].path}`);
    expect(prompt).toContain("cannot upload there");
    // The host note stays as the person's message: the transcript UI reads
    // it for the attachment chips.
    expect(stripContext(prompt).trim()).toBe(`Summarize this\n\n${hostNote}`);
    expect(withFilesNote("plain", [])).toBe("plain");
    expect(withFilesNote(prompt, staged)).toBe(prompt);
  });
});
