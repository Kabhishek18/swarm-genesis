export const MIN_SITE_HTML_BYTES = 500;

export function isWebsiteAdapter(adapterId: string): boolean {
  return /html|website|frontend|page|studio|site-design|site-copy|^site-/i.test(adapterId);
}

export function isWebsiteTask(role: string, task: string, originalGoal: string): boolean {
  return /html|css|website|frontend|page|studio|invitation|landing/i.test(
    `${role}\n${task}\n${originalGoal}`,
  );
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

export function isCompleteSiteHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  const trimmed = html.trim();
  if (Buffer.byteLength(trimmed, "utf8") < MIN_SITE_HTML_BYTES) return false;
  if (!/<h1[\s>]/i.test(trimmed)) return false;
  const body = trimmed.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  const visible = body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return visible.length >= 40;
}

export function isThinSiteDesign(md: string | null | undefined): boolean {
  if (!md) return true;
  const trimmed = md.trim();
  if (!trimmed || /^null$|^undefined$|^none$/i.test(trimmed)) return true;
  return Buffer.byteLength(trimmed, "utf8") < 80 || !/^#/m.test(trimmed);
}

export function buildSiteDesignMarkdown(goal: string): string {
  const brief = goal.trim() || "Celebrate with us";
  const kind = eventKind(brief);
  const headline =
    kind === "birthday"
      ? "Birthday invitation"
      : kind === "wedding"
        ? "Wedding invitation"
        : kind === "invitation"
          ? "Invitation page"
          : "Website";
  return `# ${headline} — site design

## Brief
${brief}

## Layout
1. Hero — headline, kicker, and the original brief on the page
2. Details — date and venue taken from the brief when present
3. Event — what guests should expect, without invented claims
4. RSVP — name, attendance, optional note
5. Footer — host sign-off

## Voice
Faithful to the original brief. Do not invent products, prices, or dates that are not in the brief.
`;
}

export function siteHtml(goal: string): string {
  return buildInvitationHtml(goal);
}

export function buildInvitationHtml(goal: string): string {
  const brief = goal.trim() || "Celebrate with us";
  const kind = eventKind(brief);
  return kind === "landing" ? landingDocument(brief) : invitationDocument(brief, kind);
}

type EventKind = "birthday" | "wedding" | "invitation" | "landing";

function eventKind(goal: string): EventKind {
  if (/birthday|b-?day/i.test(goal)) return "birthday";
  if (/wedding|nuptial/i.test(goal)) return "wedding";
  if (/invitation|rsvp|ceremony|reception|party/i.test(goal)) return "invitation";
  return "landing";
}

function coupleFromGoal(goal: string): { left: string; right: string } {
  const match = goal.match(/\b([A-Z][a-z]+)\s+(?:and|&)\s+([A-Z][a-z]+)\b/);
  if (match) return { left: match[1], right: match[2] };
  return { left: "Alex", right: "Jordan" };
}

function honoreeFromGoal(goal: string): string {
  const named = goal.match(
    /\b(?:for|honou?ring|celebrate)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  );
  if (named) return named[1];
  return "the guest of honor";
}

function dateFromGoal(goal: string): string {
  const match = goal.match(
    /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/i,
  );
  return match?.[0] ?? "Date to be announced";
}

function venueFromGoal(goal: string): string {
  const match = goal.match(/\b(?:at|venue[:\s]+)\s+([^.,\n]+)/i);
  const venue = match?.[1]?.trim();
  return venue || "Venue to be announced";
}

function invitationCopy(brief: string, kind: Exclude<EventKind, "landing">) {
  const { left, right } = coupleFromGoal(brief);
  const honoree = honoreeFromGoal(brief);
  if (kind === "birthday") {
    const title = honoree === "the guest of honor" ? "Birthday Invitation" : `${honoree} — Birthday Invitation`;
    return {
      title,
      kicker: "You're invited",
      heading: honoree === "the guest of honor" ? "Birthday Celebration" : honoree,
      sub: "Join us for a birthday celebration",
      peopleTitle: "Guest of honor",
      peopleBody: `Celebrate ${honoree}. Details stay faithful to the invitation brief.`,
      eventTitle: "Party",
      eventBody:
        "Come for cake, toasts, and time together. Dress festive. Further notes stay faithful to the original goal above.",
      rsvpNote: "Note to the host",
      footer: "With joy, the hosts",
      theme: "birthday" as const,
    };
  }
  if (kind === "wedding") {
    return {
      title: `${left} & ${right} — Wedding Invitation`,
      kicker: "Together with their families",
      heading: `${left} <span class="amp">&amp;</span> ${right}`,
      sub: "request the pleasure of your company",
      peopleTitle: "The couple",
      peopleBody: `${left} and ${right} invite you to celebrate their wedding. Names are taken from the brief when present; otherwise these placeholders stand in until the couple is named.`,
      eventTitle: "Celebration",
      eventBody:
        "Join us for vows, dinner, and dancing. Dress festive. Further event notes stay faithful to the original goal above.",
      rsvpNote: "Note to the couple",
      footer: `With love, ${left} & ${right}`,
      theme: "wedding" as const,
    };
  }
  return {
    title: "You're invited",
    kicker: "An invitation",
    heading: "Please join us",
    sub: "We would love to celebrate with you",
    peopleTitle: "Hosts",
    peopleBody: "This invitation follows the original brief. Names and details appear when the brief includes them.",
    eventTitle: "Event",
    eventBody: "Join us for the gathering described in the brief. Further notes stay faithful to the original goal above.",
    rsvpNote: "Note to the hosts",
    footer: "With thanks, the hosts",
    theme: "invitation" as const,
  };
}

function invitationDocument(brief: string, kind: Exclude<EventKind, "landing">): string {
  const copy = invitationCopy(brief, kind);
  const date = dateFromGoal(brief);
  const venue = venueFromGoal(brief);
  const safeBrief = escapeHtml(brief);
  const safeDate = escapeHtml(date);
  const safeVenue = escapeHtml(venue);
  const safeTitle = escapeHtml(copy.title);
  const heading = copy.theme === "wedding" ? copy.heading : escapeHtml(copy.heading);
  const peopleBody = escapeHtml(copy.peopleBody);
  const eventBody = escapeHtml(copy.eventBody);
  const footer = escapeHtml(copy.footer);
  const kicker = escapeHtml(copy.kicker);
  const sub = escapeHtml(copy.sub);
  const peopleTitle = escapeHtml(copy.peopleTitle);
  const eventTitle = escapeHtml(copy.eventTitle);
  const rsvpNote = escapeHtml(copy.rsvpNote);
  const palette =
    copy.theme === "birthday"
      ? `
      --ink: #2a1f4a;
      --blush: #fff4e5;
      --rose: #d97706;
      --gold: #f59e0b;
      --paper: #fffdf8;
      --hero: linear-gradient(160deg, #7c3aed 0%, #db2777 48%, #f59e0b 100%);`
      : `
      --ink: #3b2a32;
      --blush: #f7e9ee;
      --rose: #b76e79;
      --gold: #c4a574;
      --paper: #fffdf8;
      --hero: radial-gradient(circle at top, #fff 0, var(--blush) 42%, #e8d5c4 100%);`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    :root {${palette}
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background: var(--hero);
      min-height: 100vh;
    }
    header {
      text-align: center;
      padding: 4rem 1.5rem 2rem;
    }
    .kicker {
      letter-spacing: 0.35em;
      text-transform: uppercase;
      font-size: 0.75rem;
      color: var(--rose);
    }
    h1 {
      font-weight: 400;
      font-size: clamp(2.4rem, 6vw, 4.2rem);
      margin: 0.6rem 0 0.2rem;
    }
    .amp { color: var(--gold); font-style: italic; }
    .brief {
      max-width: 42rem;
      margin: 1rem auto 0;
      font-size: 1rem;
      line-height: 1.5;
    }
    main {
      max-width: 52rem;
      margin: 0 auto;
      padding: 0 1.25rem 4rem;
      display: grid;
      gap: 1.25rem;
    }
    section {
      background: var(--paper);
      border: 1px solid rgba(183, 110, 121, 0.25);
      border-radius: 18px;
      padding: 1.75rem 1.5rem;
      box-shadow: 0 12px 40px rgba(59, 42, 50, 0.08);
    }
    h2 {
      margin: 0 0 0.75rem;
      font-size: 1.15rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--rose);
    }
    .meta {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
    }
    @media (max-width: 640px) {
      .meta { grid-template-columns: 1fr; }
    }
    label { display: block; font-size: 0.85rem; margin: 0.7rem 0 0.25rem; }
    input, select, textarea {
      width: 100%;
      padding: 0.6rem 0.7rem;
      border: 1px solid #e2cfd4;
      border-radius: 8px;
      font: inherit;
      background: #fff;
    }
    button {
      margin-top: 1rem;
      background: var(--rose);
      color: #fff;
      border: 0;
      border-radius: 999px;
      padding: 0.7rem 1.4rem;
      font: inherit;
      cursor: pointer;
    }
    footer {
      text-align: center;
      padding: 0 1rem 3rem;
      font-size: 0.9rem;
      color: #6b5560;
    }
  </style>
</head>
<body>
  <header>
    <p class="kicker">${kicker}</p>
    <h1>${heading}</h1>
    <p>${sub}</p>
    <p class="brief">${safeBrief}</p>
  </header>
  <main>
    <section class="couple" id="couple">
      <h2>${peopleTitle}</h2>
      <p>${peopleBody}</p>
    </section>
    <div class="meta">
      <section id="date">
        <h2>Date</h2>
        <p>${safeDate}</p>
        <p>Timing follows the invitation brief when a date is given.</p>
      </section>
      <section id="venue">
        <h2>Venue</h2>
        <p>${safeVenue}</p>
        <p>The gathering continues at the same location unless the brief says otherwise.</p>
      </section>
    </div>
    <section id="event">
      <h2>${eventTitle}</h2>
      <p>${eventBody}</p>
    </section>
    <section id="rsvp">
      <h2>RSVP</h2>
      <form action="#" method="get">
        <label for="guest-name">Your name</label>
        <input id="guest-name" name="name" type="text" placeholder="Full name" autocomplete="name">
        <label for="guests">Number of guests</label>
        <input id="guests" name="guests" type="number" min="1" max="10" value="1">
        <label for="attending">Will you attend?</label>
        <select id="attending" name="attending">
          <option value="yes">Joyfully accepts</option>
          <option value="no">Regretfully declines</option>
        </select>
        <label for="note">${rsvpNote}</label>
        <textarea id="note" name="note" rows="3" placeholder="Optional message"></textarea>
        <button type="button">Send RSVP</button>
      </form>
    </section>
  </main>
  <footer>
    <p>${footer}</p>
  </footer>
</body>
</html>
`;
}

function landingDocument(brief: string): string {
  const safeBrief = escapeHtml(brief);
  const title = escapeHtml(brief.slice(0, 80) || "Welcome");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { --ink: #102a43; --accent: #0e7c7b; --paper: #f8fafc; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, sans-serif;
      color: var(--ink);
      background: var(--paper);
    }
    header {
      padding: 4.5rem 1.5rem 3rem;
      background: linear-gradient(135deg, #102a43, #0e7c7b);
      color: #fff;
      text-align: center;
    }
    h1 { font-size: clamp(2rem, 5vw, 3.2rem); margin: 0 0 0.8rem; font-weight: 650; }
    .brief { max-width: 40rem; margin: 0 auto; line-height: 1.5; opacity: 0.95; }
    main { max-width: 52rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; display: grid; gap: 1.25rem; }
    section {
      background: #fff;
      border-radius: 16px;
      padding: 1.5rem;
      box-shadow: 0 10px 30px rgba(16, 42, 67, 0.08);
    }
    h2 { margin: 0 0 0.6rem; color: var(--accent); }
    footer { text-align: center; padding: 0 1rem 2.5rem; color: #627d98; }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <p class="brief">${safeBrief}</p>
  </header>
  <main>
    <section id="about">
      <h2>About</h2>
      <p>This page was generated from the run brief so opening the file shows a real site, not an empty stub.</p>
    </section>
    <section id="details">
      <h2>Details</h2>
      <p>${safeBrief}</p>
    </section>
    <section id="contact">
      <h2>Get in touch</h2>
      <p>Reply with questions or next steps. Copy stays within the original goal.</p>
    </section>
  </main>
  <footer>
    <p>Built from the swarm website playbook</p>
  </footer>
</body>
</html>
`;
}
