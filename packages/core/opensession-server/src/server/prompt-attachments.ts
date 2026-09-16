/**
 * Chat attachments, put on disk where the ENGINE runs.
 *
 * A pasted image reaches the model through the vision channel, so it can see
 * a screenshot but, unlike a non-image attachment (uploads.ts stageUploads),
 * it was never told where the bytes live. Asked to commit or convert one,
 * runs went looking for a file, found nothing, and invented a step the person
 * cannot take ("upload it in the Assets tab"). A non-image attachment had the
 * opposite problem: its note named a path on the Open Session host, which a
 * Runner-backed or Sandbox run cannot read.
 *
 * Both are fixed by staging in the process that hosts the engine, never on
 * the server ahead of dispatch. The session scratch dir is the one location
 * every topology shares: agent-runner stamps it on the run and pi exports it
 * as $OPENSESSION_SCRATCH, so a path under it is real wherever the agent's
 * file tools execute. Images arrive with every run (RunAgentOpts.images);
 * file bytes ride the spec only for a host on another machine
 * (RunHostSpec.files), because in-process the host path already works.
 * Staging by content digest is idempotent: a retried, requeued or steered
 * delivery of the same bytes lands on the same file instead of a second copy.
 *
 * Synchronous on purpose: pi's steer accepts a message synchronously (its
 * boolean means the engine queue holds the message and a retraction rebuilds
 * that queue in the same tick), the bytes are bounded, and the caller is the
 * engine's own process, not the gateway.
 */
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { wrapContext } from "./prompt-context";
import type { ImageInput, PromptFile } from "./run-events";

// Owned here rather than in uploads.ts so the engine-side importer
// (agent-runner, and through it every detached host) stays a leaf: uploads.ts
// reaches the session catalog, whose import graph loops back into the runners.
/** Cap so a single upload can't OOM the process. The HTTP path streams, but
 *  the inline base64/WS path buffers, so keep it modest. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/**
 * How much attachment payload one turn ships inline to a remote host. The
 * spec travels as one JSON document through the Runner's WebSocket frame or
 * the sandbox driver's file write, so it is capped well under the upload
 * cap; images already ride the same way. Attachments past the cap keep their
 * host-only path and the note says so.
 */
export const MAX_SHIPPED_ATTACHMENT_BYTES = 16 * 1024 * 1024;
export const INLINE_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

export type StagedAttachment = { name: string; path: string };

/** Keep a user-supplied filename to a safe basename (no traversal, no exotic chars). */
export function sanitizeAttachmentName(name: string): string {
  const base = (name.split(/[\\/]/).pop() || "file").replace(/^\.+/, "");
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .trim()
    .slice(0, 120);
  return cleaned || "file";
}

/** Write one attachment exactly once under `<scratch>/attachments`. "wx"
 *  keeps an identical file's bytes and stops two deliveries half-overwriting
 *  each other. Undefined when the bytes could not be written. */
function stageBytes(
  scratchDir: string,
  fileName: string,
  bytes: Buffer,
): string | undefined {
  const dir = `${scratchDir}/attachments`;
  const path = `${dir}/${fileName}`;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") {
      console.warn(
        "[prompt-attachments] Could not stage an attachment:",
        error,
      );
      return undefined;
    }
  }
  return path;
}

function digestOf(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** Stage a prompt's images under the session scratch dir. Types without a
 *  known extension are skipped: a run needs a path it can name a format for,
 *  and the vision channel still carries them. */
export function stagePromptImages(
  scratchDir: string | undefined,
  images?: ImageInput[],
): StagedAttachment[] {
  if (!scratchDir || !images?.length) return [];
  const staged: StagedAttachment[] = [];
  for (const [index, image] of images.entries()) {
    const extension = INLINE_IMAGE_EXTENSIONS[image.mediaType];
    if (!extension) continue;
    const bytes = Buffer.from(image.data, "base64");
    if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) continue;
    const path = stageBytes(
      scratchDir,
      `image-${digestOf(bytes)}${extension}`,
      bytes,
    );
    if (path) staged.push({ name: `image-${index + 1}${extension}`, path });
  }
  return staged;
}

/** Stage the non-image attachments a remote host received inline. The
 *  digest prefix keeps two different files with the same name apart and
 *  makes a redelivery land on the file already there. */
export function stagePromptFiles(
  scratchDir: string | undefined,
  files?: PromptFile[],
): StagedAttachment[] {
  if (!scratchDir || !files?.length) return [];
  const staged: StagedAttachment[] = [];
  for (const file of files) {
    const bytes = Buffer.from(file.data, "base64");
    if (!bytes.length || bytes.length > MAX_SHIPPED_ATTACHMENT_BYTES) continue;
    const name = sanitizeAttachmentName(file.name);
    const path = stageBytes(scratchDir, `${digestOf(bytes)}-${name}`, bytes);
    if (path) staged.push({ name: file.name || name, path });
  }
  return staged;
}

/** Fenced, so the transcript keeps only the person's message; appending the
 *  same note twice is a no-op, so a recovered run that re-enters with its
 *  journaled (already noted) prompt does not stack a second copy. */
function withNote(prompt: string, body: string): string {
  const note = wrapContext(body, "uploads-note");
  return prompt.includes(note) ? prompt : `${prompt}\n\n${note}`;
}

function pathLines(staged: StagedAttachment[]): string {
  return staged.map((s) => `- ${s.name}: ${s.path}`).join("\n");
}

/**
 * Tell the agent where the prompt's images live and that a chat attachment is
 * never something the person can move into Assets. The transcript already
 * shows the pictures, so the note is model-only plumbing.
 */
export function withImagesNote(
  prompt: string,
  staged: StagedAttachment[],
): string {
  if (!staged.length) return prompt;
  return withNote(
    prompt,
    `The user attached ${staged.length} image(s) to this message. You can see them inline; ` +
      `the same files are saved on disk, so read or copy them from these paths when you ` +
      `need the file itself (to convert, commit, or publish it):\n${pathLines(staged)}\n` +
      `Chat attachments never appear in the session's Assets tab and the person cannot ` +
      `upload there. If an attachment is missing, ask them to send it again in chat.`,
  );
}

/**
 * A remote host's copy of the turn's file attachments. The plain uploads
 * note above it still names the Open Session host paths, because the
 * transcript UI reads that note to draw the attachment chips; this one tells
 * the model which paths are real from where it runs.
 */
export function withFilesNote(
  prompt: string,
  staged: StagedAttachment[],
): string {
  if (!staged.length) return prompt;
  return withNote(
    prompt,
    `This run does not execute on the Open Session host, so the attachment paths ` +
      `listed above are not reachable from here. Copies of the same files are in your ` +
      `scratch dir; read them from these paths instead:\n${pathLines(staged)}\n` +
      `An attachment missing from this list was too large to ship. Chat attachments ` +
      `never appear in the session's Assets tab and the person cannot upload there; ` +
      `if you need one you cannot read, ask them to send it again in chat.`,
  );
}
