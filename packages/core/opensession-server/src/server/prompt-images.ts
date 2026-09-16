/**
 * Pasted images, put on disk where the ENGINE runs.
 *
 * A pasted image reaches the model through the vision channel, so it can see
 * a screenshot but, unlike a non-image attachment (uploads.ts stageUploads),
 * it was never told where the bytes live. Asked to commit or convert one,
 * runs went looking for a file, found nothing, and invented a step the person
 * cannot take ("upload it in the Assets tab").
 *
 * The staging is deliberately NOT done on the server ahead of dispatch. A
 * Runner-backed session executes its tools on the Runner and a Sandbox run
 * inside the Sandbox, where a server path is a lie the model cannot check.
 * The session scratch dir is the one location every topology shares:
 * agent-runner stamps it on the run and pi exports it as $OPENSESSION_SCRATCH,
 * so a path under it is real wherever the agent's file tools execute. Staging
 * by content digest is idempotent: a retried, requeued or steered delivery of
 * the same image lands on the same file instead of a second copy.
 *
 * Synchronous on purpose: pi's steer accepts a message synchronously (its
 * boolean means the engine queue holds the message and a retraction rebuilds
 * that queue in the same tick), the bytes are bounded by MAX_UPLOAD_BYTES,
 * and the caller is the engine's own process, not the gateway.
 */
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { wrapContext } from "./prompt-context";
import type { ImageInput } from "./run-events";

// Owned here rather than in uploads.ts so the engine-side importer
// (agent-runner, and through it every detached host) stays a leaf: uploads.ts
// reaches the session catalog, whose import graph loops back into the runners.
/** Cap so a single upload can't OOM the process. The HTTP path streams, but
 *  the inline base64/WS path buffers, so keep it modest. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const INLINE_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export type StagedImage = { name: string; path: string };

/** Stage a prompt's images under the session scratch dir. Types without a
 *  known extension are skipped: a run needs a path it can name a format for,
 *  and the vision channel still carries them. */
export function stagePromptImages(
  scratchDir: string | undefined,
  images?: ImageInput[],
): StagedImage[] {
  if (!scratchDir || !images?.length) return [];
  const dir = `${scratchDir}/attachments`;
  const staged: StagedImage[] = [];
  let created = false;
  for (const [index, image] of images.entries()) {
    const extension = INLINE_IMAGE_EXTENSIONS[image.mediaType];
    if (!extension) continue;
    const bytes = Buffer.from(image.data, "base64");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) continue;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const path = `${dir}/image-${digest.slice(0, 16)}${extension}`;
    try {
      if (!created) {
        mkdirSync(dir, { recursive: true });
        created = true;
      }
      // "wx" writes the file exactly once: an identical image already on disk
      // keeps its bytes, and two deliveries cannot half-overwrite each other.
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
        console.warn("[prompt-images] Could not stage a pasted image:", error);
        continue;
      }
    }
    staged.push({ name: `image-${index + 1}${extension}`, path });
  }
  return staged;
}

/**
 * Tell the agent where the prompt's images live and that a chat attachment is
 * never something the person can move into Assets. Fenced: the transcript
 * already shows the pictures, so the note is model-only plumbing. Appending
 * the same note twice is a no-op, so a recovered run that re-enters with its
 * journaled (already noted) prompt does not stack a second copy.
 */
export function withImagesNote(prompt: string, staged: StagedImage[]): string {
  if (!staged.length) return prompt;
  const lines = staged.map((s) => `- ${s.name}: ${s.path}`).join("\n");
  const note = wrapContext(
    `The user attached ${staged.length} image(s) to this message. You can see them inline; ` +
      `the same files are saved on disk, so read or copy them from these paths when you ` +
      `need the file itself (to convert, commit, or publish it):\n${lines}\n` +
      `Chat attachments never appear in the session's Assets tab and the person cannot ` +
      `upload there. If an attachment is missing, ask them to send it again in chat.`,
    "uploads-note",
  );
  return prompt.includes(note) ? prompt : `${prompt}\n\n${note}`;
}
