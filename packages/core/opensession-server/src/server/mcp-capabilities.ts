/**
 * Lightweight metadata for Open Session's in-process MCP servers.
 *
 * This module must stay dependency-free: mcp-catalog.ts imports every real
 * server factory for docs and wiring checks, and the names and summaries here
 * describe the capability set without pulling in that factory graph.
 *
 * Nothing here reaches the run prompt. Every MCP tool sits behind mcp_search,
 * so a tool a run must know about unprompted needs a line in
 * run-instructions.ts.
 */

export interface InternalMcpCapability {
  /** One-line catalog description used in generated docs. */
  summary: string;
}

export const INTERNAL_MCP_CAPABILITIES = {
  "opensession-sessions": {
    summary: "See and steer other sessions, and spawn worker sessions.",
  },
  "opensession-admin": {
    summary: "Manage automations, MCP connections and channel memory.",
  },
  "opensession-runners": {
    summary: "Run bounded commands on trusted persistent machines (Runners).",
  },
  "opensession-goals": {
    summary: "Create and steer long-running, self-pacing goals.",
  },
  "opensession-search": {
    summary: "Search and read the distilled record of past sessions.",
  },
  "opensession-self-deploy": {
    summary:
      "Promote frontend-only releases without restart, or standard-deploy other source changes.",
  },
  "opensession-humans": {
    summary: "Ask a teammate and fold their answer back into this session.",
  },
  "opensession-keychain": {
    summary:
      "Borrow a teammate's credential for a stated purpose, with their approval.",
  },
  "opensession-publish": {
    summary: "Publish a directory as a durable internal web app.",
  },
  "opensession-repos": {
    summary:
      "Attach or switch repos, link a PR to this session, label PRs, and check whether a PR is ready to merge.",
  },
  "opensession-memory": {
    summary:
      "Durable repo / user / team memory, shared with Slack channel memory.",
  },
  "opensession-web": {
    summary:
      "Read a URL as text, search what was fetched, clone a GitHub repo. No web search.",
  },
  "opensession-portals": {
    summary: "Supervised HTTP/WebSocket services for this session's workspace.",
  },
  "opensession-desktop": {
    summary:
      "See and drive the Sandbox desktop: screenshot, click, type, keys, windows.",
  },
  "opensession-walkthrough": {
    summary:
      "Publish a walkthrough (video, before/after, writeup) onto the Review tab and the PR.",
  },
  "opensession-slack": {
    summary: "Open an editable Slack composer. The human still presses Send.",
  },
  "opensession-plain-discussion": {
    summary:
      "Reply to the customer or run a Stripe action from a Plain Ask Sidekick discussion, behind the teammate's Approve/Deny card.",
  },
  "opensession-ask": {
    summary: "Ask the human a blocking question.",
  },
  "opensession-workflows": {
    summary: "Deterministic agent fan-out from a model-authored script.",
  },
  "opensession-assets": {
    summary: "Per-session scratch assets, previewed in the Assets tab.",
  },
  "opensession-charts": {
    summary:
      "Validate a Vega-Lite spec and get the ```vega-lite fence that renders as an interactive chart.",
  },
  "opensession-todos": {
    summary: "The user's Desk todo list.",
  },
  "opensession-schedule": {
    summary: "Schedule a prompt for this session at a future time.",
  },
  "opensession-papercuts": {
    summary: "Append-only friction log.",
  },
  "opensession-report": {
    summary: "Publish this run's durable HTML report into the Reports view.",
  },
  "opensession-databases": {
    summary:
      "Create, fill and query named SQLite databases kept by Open Session, browsed in the Databases view.",
  },
  "opensession-turn": {
    summary: 'Say "looked, nothing to report" instead of ending on silence.',
  },
  "opensession-health": {
    summary:
      "Read this instance's own disk, memory, load, process fleets and agent status.",
  },
  "opensession-audit": {
    summary: "Read one day's rolled-up audit digest.",
  },
  "opensession-self": {
    summary:
      "A self-improving automation reading and rewriting its OWN prompt.",
  },
  "opensession-github": {
    summary:
      "Trigger the PR behaviours (review / auto-fix / simplify / adversarial).",
  },
  "opensession-goal-self": {
    summary: "A running goal's own cadence controls and fact ledger.",
  },
} as const satisfies Record<string, InternalMcpCapability>;
