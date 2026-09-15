import { describe, expect, it } from "bun:test";
import {
  awaitApproval,
  cancelApprovalsFor,
  discussionOpeningPrompt,
  resolveApproval,
  shouldAnswer,
  type DiscussionMessageCreatedPayload,
} from "./discussions";
import {
  describeToolCall,
  looksLikeToolError,
  toolCallIdFor,
  turnReplyMarkdown,
} from "./discussion-mirror";

const ME = "mu_open_session";

function messageCreated(
  over: {
    discussion?: Partial<DiscussionMessageCreatedPayload["discussion"]>;
    message?: Partial<DiscussionMessageCreatedPayload["message"]>;
  } = {},
): DiscussionMessageCreatedPayload {
  return {
    discussion: {
      id: "disc_1",
      type: "AGENT_SESSION",
      agent: { id: ME },
      status: "OPEN",
      threadId: "th_1",
      ...over.discussion,
    },
    message: {
      id: "msg_1",
      type: "OUTBOUND",
      markdown: "summarize this ticket",
      ...over.message,
    },
  };
}

describe("shouldAnswer", () => {
  it("answers a person's turn in an open discussion addressed to this agent", () => {
    expect(shouldAnswer(messageCreated(), ME)).toBe(true);
  });

  it("ignores the agent's own replies, which come back as INBOUND", () => {
    expect(
      shouldAnswer(messageCreated({ message: { type: "INBOUND" } }), ME),
    ).toBe(false);
  });

  it("ignores discussions owned by Sidekick or another agent", () => {
    expect(
      shouldAnswer(
        messageCreated({ discussion: { agent: { id: "mu_sidekick" } } }),
        ME,
      ),
    ).toBe(false);
    expect(
      shouldAnswer(messageCreated({ discussion: { agent: null } }), ME),
    ).toBe(false);
  });

  it("ignores Slack/email discussions and resolved ones", () => {
    expect(
      shouldAnswer(messageCreated({ discussion: { type: "SLACK" } }), ME),
    ).toBe(false);
    expect(
      shouldAnswer(messageCreated({ discussion: { status: "RESOLVED" } }), ME),
    ).toBe(false);
  });
});

describe("approval registry", () => {
  it("resolves a waiting tool call with the teammate's decision", async () => {
    const waiting = awaitApproval("disc_1", "reply-1", 10_000);
    expect(
      resolveApproval("reply-1", {
        status: "DENIED",
        reviewerNote: "too long",
      }),
    ).toBe(true);
    expect(await waiting).toEqual({
      status: "DENIED",
      reviewerNote: "too long",
    });
    expect(
      resolveApproval("reply-1", { status: "APPROVED", reviewerNote: null }),
    ).toBe(false);
  });

  it("times out when nobody decides", async () => {
    expect(await awaitApproval("disc_1", "reply-2", 1)).toEqual({
      status: "TIMEOUT",
    });
  });

  it("cancels every open approval of a stopped discussion, and only those", async () => {
    const mine = awaitApproval("disc_stop", "a", 10_000);
    const other = awaitApproval("disc_other", "b", 10_000);
    expect(cancelApprovalsFor("disc_stop")).toBe(1);
    expect(await mine).toEqual({ status: "CANCELLED" });
    expect(
      resolveApproval("b", { status: "APPROVED", reviewerNote: null }),
    ).toBe(true);
    expect((await other).status).toBe("APPROVED");
  });
});

describe("discussionOpeningPrompt", () => {
  it("names the thread when the discussion was opened on one", () => {
    const prompt = discussionOpeningPrompt(
      { id: "disc_1", threadId: "th_1" },
      "why is this export failing?",
    );
    expect(prompt).toContain("support thread th_1");
    expect(prompt).toEndWith("why is this export failing?");
  });

  it("says so when it was opened from Home", () => {
    expect(
      discussionOpeningPrompt({ id: "disc_1", threadId: null }, "hi"),
    ).toContain("not on a thread");
  });
});

describe("tool call mirroring", () => {
  it("keeps Plain's id alphabet and length", () => {
    expect(toolCallIdFor("toolu_01AB")).toBe("toolu_01AB");
    expect(toolCallIdFor("call:with/odd chars")).toBe("call_with_odd_chars");
    expect(toolCallIdFor("x".repeat(300))).toHaveLength(256);
    expect(toolCallIdFor(undefined)).toMatch(/^call-[0-9a-f-]{36}$/);
  });

  it("summarizes a tool call on one bounded line", () => {
    expect(
      describeToolCall("mcp__plain__get_thread", { threadId: "th_1", n: 3 }),
    ).toBe("plain › get_thread — threadId: th_1, n: 3");
    const long = describeToolCall("Bash", { command: "x".repeat(500) });
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long).toEndWith("…");
    expect(describeToolCall("Read", { nested: { a: 1 } })).toBe("Read");
  });

  it("reads an error result from its body", () => {
    expect(looksLikeToolError("Error: not found")).toBe(true);
    expect(looksLikeToolError("  failed to connect")).toBe(true);
    expect(looksLikeToolError("3 threads found")).toBe(false);
  });
});

describe("turnReplyMarkdown", () => {
  it("posts the reply text as-is", () => {
    expect(
      turnReplyMarkdown({
        assistantText: " done ",
        endedWithError: false,
        runFailure: null,
      }),
    ).toBe("done");
  });

  it("posts nothing for a silent turn", () => {
    expect(
      turnReplyMarkdown({
        assistantText: "",
        endedWithError: false,
        runFailure: null,
      }),
    ).toBeNull();
  });

  it("explains a failed turn, keeping any partial reply", () => {
    expect(
      turnReplyMarkdown({
        assistantText: "partial",
        endedWithError: true,
        runFailure: "usage limit",
      }),
    ).toBe("partial\n\nThe turn ended with an error: usage limit");
    expect(
      turnReplyMarkdown({
        assistantText: "",
        endedWithError: true,
        runFailure: null,
      }),
    ).toBe("The turn ended with an error before a reply was ready.");
  });
});
