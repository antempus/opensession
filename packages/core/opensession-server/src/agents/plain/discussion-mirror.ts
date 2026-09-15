/**
 * Mirrors a session's turn into its Plain discussion (Ask Sidekick).
 *
 * A session with `plainDiscussionId` posts every finished turn back to that
 * discussion and reports each tool call on its timeline, whoever started the
 * turn (the teammate in Plain, or someone steering the same session in the
 * Open Session UI). The run loops call these hooks; every one is a no-op for
 * a session that has no discussion.
 */
import type { StreamEvent } from "../../server/run-events";
import { splitNoteText } from "./notes";
import {
  sendDiscussionMessage,
  updateDiscussionAgentStatus,
  upsertDiscussionToolCall,
  withDiscussionOrder,
} from "./discussion-api";

/** The approval tools report themselves under their own ids. */
const SELF_REPORTING_TOOL = "opensession-plain-discussion";
const TOOL_SUMMARY_MAX_CHARS = 200;

/** Plain accepts `[A-Za-z0-9_-]{1,256}` as a tool call id. */
export function toolCallIdFor(toolUseId: string | undefined): string {
  const cleaned = (toolUseId || "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 256);
  return cleaned || `call-${crypto.randomUUID()}`;
}

function shortToolName(toolName: string): string {
  return toolName.replace(/^mcp__/, "").replace(/__/g, " › ");
}

/** One line for the discussion timeline: the tool and its scalar arguments. */
export function describeToolCall(toolName: string, toolInput: unknown): string {
  const head = shortToolName(toolName);
  const args: string[] = [];
  if (toolInput && typeof toolInput === "object") {
    for (const [key, value] of Object.entries(
      toolInput as Record<string, unknown>,
    )) {
      if (typeof value === "string" && value.trim())
        args.push(`${key}: ${value.replace(/\s+/g, " ").trim()}`);
      else if (typeof value === "number" || typeof value === "boolean")
        args.push(`${key}: ${String(value)}`);
    }
  }
  const line = args.length ? `${head} — ${args.join(", ")}` : head;
  return line.length > TOOL_SUMMARY_MAX_CHARS
    ? `${line.slice(0, TOOL_SUMMARY_MAX_CHARS - 1)}…`
    : line;
}

const pendingToolText = new Map<string, string>();

function report(discussionId: string, label: string, fn: () => Promise<void>) {
  void withDiscussionOrder(discussionId, fn).catch((e) =>
    console.warn(`[plain] discussion ${discussionId} ${label} failed:`, e),
  );
}

export function plainDiscussionToolUse(
  discussionId: string | undefined,
  event: Pick<StreamEvent, "toolName" | "toolInput" | "toolUseId">,
): void {
  if (!discussionId || !event.toolName) return;
  if (event.toolName.includes(SELF_REPORTING_TOOL)) return;
  const toolCallId = toolCallIdFor(event.toolUseId);
  const text = describeToolCall(event.toolName, event.toolInput);
  pendingToolText.set(toolCallId, text);
  report(discussionId, `tool call ${toolCallId}`, () =>
    upsertDiscussionToolCall({
      discussionId,
      toolCallId,
      status: "PENDING",
      text,
    }),
  );
}

/** The stream carries no error flag on results; an "Error…" body is the tell. */
export function looksLikeToolError(content: string): boolean {
  return /^\s*(error|✗|failed)\b/i.test(content);
}

export function plainDiscussionToolResult(
  discussionId: string | undefined,
  event: Pick<StreamEvent, "toolUseId" | "content">,
): void {
  if (!discussionId) return;
  const toolCallId = toolCallIdFor(event.toolUseId);
  const text = pendingToolText.get(toolCallId);
  if (text === undefined) return;
  pendingToolText.delete(toolCallId);
  const content = event.content || "";
  const failed = looksLikeToolError(content);
  report(discussionId, `tool result ${toolCallId}`, () =>
    upsertDiscussionToolCall({
      discussionId,
      toolCallId,
      status: failed ? "ERROR" : "SUCCESS",
      text,
      ...(failed ? { error: content } : {}),
    }),
  );
}

/** What the discussion shows for a turn; null when there is nothing to say. */
export function turnReplyMarkdown(input: {
  assistantText: string;
  endedWithError: boolean;
  runFailure: string | null;
}): string | null {
  const text = input.assistantText.trim();
  if (input.endedWithError) {
    const reason = input.runFailure?.trim();
    return [
      text,
      reason
        ? `The turn ended with an error: ${reason}`
        : "The turn ended with an error before a reply was ready.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return text || null;
}

/**
 * Post the turn's reply (or its failure) and report the agent idle. A long
 * reply is split into ordered parts. Runs after the turn is over, so it never
 * delays the session; failures are logged and the status update still runs.
 */
export function mirrorTurnToPlainDiscussion(
  discussionId: string | undefined,
  input: {
    assistantText: string;
    endedWithError: boolean;
    runFailure: string | null;
  },
): void {
  if (!discussionId) return;
  const markdown = turnReplyMarkdown(input);
  report(discussionId, "turn mirror", async () => {
    try {
      if (markdown) {
        for (const part of splitNoteText(markdown))
          await sendDiscussionMessage(discussionId, part);
      }
    } finally {
      // Refused while an approval card is open: Plain owns the status then.
      await updateDiscussionAgentStatus(discussionId, "IDLE").catch((e) =>
        console.warn(`[plain] discussion ${discussionId} IDLE failed:`, e),
      );
    }
  });
}
