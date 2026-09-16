/**
 * The line or three of a PR description worth putting on a hover card.
 *
 * A PR body is markdown written for GitHub's page: section headings, a
 * bulleted summary, screenshots, `<details>` blocks of test output, the
 * mirrored walkthrough section and the attribution footer every PR here ends
 * on. A card has room for a clamped paragraph, so this keeps the prose and
 * drops everything that only makes sense on the page. What comes out is plain
 * text; the card clamps it.
 */

const WALKTHROUGH_MIRROR =
  /<!-- opensession:walkthrough -->[\s\S]*?<!-- \/opensession:walkthrough -->/g;
/** The footer's link text, the same anchor pr-cache.ts trusts to attribute a
 *  PR to a session. Anything on that line is boilerplate. */
const ATTRIBUTION_LINE = /^.*\[this [^\]]*session\]\(.*$/gim;
const MAX_CHARS = 300;

export function prDescriptionExcerpt(body: string | undefined | null): string {
  if (!body) return "";
  const text = body
    .replace(/\r\n?/g, "\n")
    .replace(WALKTHROUGH_MIRROR, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<details[\s\S]*?<\/details>/gi, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(ATTRIBUTION_LINE, "")
    .replace(/<[^>]+>/g, "");

  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    // Headings name the section the card is skipping past, table rows and
    // rules are layout, and an image has nothing to say as text.
    if (
      !line ||
      /^#{1,6}\s/.test(line) ||
      /^\|/.test(line) ||
      /^(?:[-*_]\s*){3,}$/.test(line) ||
      /^!\[/.test(line)
    )
      continue;
    line = line
      .replace(/^(?:>\s?)+/, "")
      .replace(/^(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/^\[[ xX]\]\s*/, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__|~~|`)(.+?)\1/g, "$2")
      .replace(/(^|[\s(])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[\s.,;:!?)])/g, "$1$2")
      .trim();
    if (line) lines.push(line);
  }

  const joined = lines.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length <= MAX_CHARS) return joined;
  const cut = joined.slice(0, MAX_CHARS);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > MAX_CHARS / 2 ? cut.slice(0, atWord) : cut).replace(/[\s.,;:]+$/, "")}…`;
}
