// On-demand editorial card for a listing, rendered to PNG for the Telegram
// channel post (and reusable as a web OG image). Templated, not AI-generated:
// deterministic, on-brand, free, and it renders the org/title text exactly.
//
// Minimal layout: org label + dated deadline stamp, big title, one meta line,
// hairline, tags + wordmark. Skinned to match the site (apps/web
// listing-board.svelte): parchment ground and a serif title (the site's
// font-serif) over Geist labels. satori lays it out (HTML/flexbox subset → SVG,
// incl. title wrapping); @resvg/resvg-js rasterizes to PNG. Fonts are vendored
// under fonts/ because satori needs ttf/otf and the web app ships only variable
// woff2; the site's serif falls back to the system serif (Georgia), for which
// Source Serif 4 is an embeddable stand-in.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori, { type Font } from "satori";

export type CardInput = {
  orgName: string;
  title: string;
  location: string | null;
  isRemote: boolean;
  isPaid: boolean | null;
  fitScore: number;
  deadline: Date | null;
  fieldTags: string[];
};

const WIDTH = 1200;
const HEIGHT = 630;

// From the site's real theme (listing-board.svelte): parchment ground, near-black
// ink, mid-gray muted text, tan hairline — plus the site's brown accent for warmth.
const PAPER = "#f0e6d2";
const INK = "#171717";
const EM = "#6f6f6f";
const LINE = "rgba(184,149,106,0.5)";
const BROWN = "#5a4226"; // site accent — masthead label, deadline stamp, wordmark
const CREAM = "#f6ecd7"; // text on the brown stamp
const FRAME = "rgba(90,66,38,0.28)"; // inset printed-frame hairline

const SANS = "Geist";
const SERIF = "Source Serif 4"; // stands in for the site's system serif titles

const fontFile = (name: string): string =>
  fileURLToPath(new URL(`../fonts/${name}.ttf`, import.meta.url));

const SANS_WEIGHTS: Font["weight"][] = [400, 500, 700, 800];
const FONT_FILES = [...SANS_WEIGHTS.map((w) => `geist-${w}`), "source-serif-600-normal"];

const FONTS: Font[] = [
  ...SANS_WEIGHTS.map((weight) => ({
    name: SANS,
    weight,
    style: "normal" as const,
    data: readFileSync(fontFile(`geist-${weight}`)),
  })),
  { name: SERIF, weight: 600, style: "normal", data: readFileSync(fontFile("source-serif-600-normal")) },
];

// Brand mark (assets/internit.svg), recoloured per background and pre-rasterised
// to PNG so resvg embeds it reliably (nested SVG data URIs are flaky). The source
// stroke is the brown accent, swapped out for other grounds.
const LOGO_SRC = readFileSync(
  fileURLToPath(new URL("../assets/internit.svg", import.meta.url)),
  "utf8",
);
function logoPng(color: string, width: number): string {
  const svg = LOGO_SRC.replace(/#5A4226/gi, color);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return `data:image/png;base64,${png.toString("base64")}`;
}
const LOGO_BROWN = logoPng(BROWN, 160); // 2× the display width, for crispness

// Minimal hyperscript for satori's element tree — avoids a JSX build here.
type Node = { type: string; props: Record<string, unknown> };
const h = (
  type: string,
  style: Record<string, unknown>,
  children?: Node | Node[] | string,
): Node => ({ type, props: { style, ...(children !== undefined ? { children } : {}) } });
const img = (src: string, w: number, ht: number): Node => ({
  type: "img",
  props: { src, width: w, height: ht, style: { display: "flex", width: w, height: ht } },
});

function clamp(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Deadline stamp — the date itself, labelled, so it reads as a real deadline.
// Shown whenever a deadline exists and hasn't passed (past ones aren't posted).
function deadlineStamp(deadline: Date | null): string | null {
  if (!deadline) return null;
  if (Math.ceil((deadline.getTime() - Date.now()) / 86_400_000) < 0) return null;
  const date = deadline.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `DEADLINE ${date.toUpperCase()}`;
}

function metaLine(input: CardInput): string {
  const parts: string[] = [];
  const loc = input.isRemote ? "Remote" : (input.location ?? "").trim();
  if (loc) parts.push(loc);
  if (input.isPaid === true) parts.push("Paid");
  else if (input.isPaid === false) parts.push("Unpaid");
  parts.push(`Fit ${input.fitScore}`);
  return parts.join("  ·  ");
}

function buildTree(input: CardInput): Node {
  const org = clamp(input.orgName, 46).toUpperCase();
  const title = clamp(input.title, 92);
  const stamp = deadlineStamp(input.deadline);
  const tags = input.fieldTags.slice(0, 3).join("  ·  ");
  // Fill-to-fit: short titles scale up to carry the card (a one-liner otherwise
  // leaves a dead zone), longer ones step down so 2 lines still fit.
  const titleSize = title.length > 58 ? 54 : title.length > 40 ? 66 : title.length > 24 ? 78 : 90;

  const topRow: Node[] = [
    h("div", { display: "flex", fontSize: 26, fontWeight: 700, letterSpacing: 3, color: BROWN }, org),
  ];
  if (stamp) {
    topRow.push(
      h(
        "div",
        {
          display: "flex",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: 2,
          color: CREAM,
          backgroundColor: BROWN,
          padding: "10px 18px",
          borderRadius: 2,
        },
        stamp,
      ),
    );
  }

  // Content lives inside an inset hairline frame — gives the card a printed,
  // editorial-keepsake feel rather than a flat template.
  const content: Node[] = [
    h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, topRow),
    // Title vertically centered in the open space, so a one-line title sits with
    // balanced whitespace instead of stranding a gap above the meta row.
    h("div", { display: "flex", flexGrow: 1, alignItems: "center", paddingTop: 12, paddingBottom: 12 }, [
      h(
        "div",
        {
          display: "flex",
          fontFamily: SERIF,
          fontWeight: 600,
          fontSize: titleSize,
          letterSpacing: -0.5,
          lineHeight: 1.06,
          color: INK,
        },
        title,
      ),
    ]),
    h("div", { display: "flex", flexDirection: "column" }, [
      h(
        "div",
        { display: "flex", fontSize: 30, fontWeight: 500, color: EM, marginBottom: 22 },
        metaLine(input),
      ),
      h("div", { display: "flex", height: 1, backgroundColor: LINE, marginBottom: 22 }, ""),
      h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, [
        h("div", { display: "flex", fontSize: 26, fontWeight: 400, color: EM }, tags),
        // Brand mark (no wordmark).
        img(LOGO_BROWN, 80, 58),
      ]),
    ]),
  ];

  return h(
    "div",
    { display: "flex", width: WIDTH, height: HEIGHT, padding: 24, backgroundColor: PAPER, fontFamily: SANS },
    [
      h(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          border: `1.5px solid ${FRAME}`,
          borderRadius: 4,
          padding: "40px 46px",
        },
        content,
      ),
    ],
  );
}

export async function renderListingCard(input: CardInput): Promise<Buffer> {
  const svg = await satori(buildTree(input) as never, { width: WIDTH, height: HEIGHT, fonts: FONTS });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    background: PAPER,
    font: { fontFiles: FONT_FILES.map(fontFile), loadSystemFonts: false, defaultFontFamily: SANS },
  });
  return resvg.render().asPng();
}

// ---------------------------------------------------------------------------
// Brand card — the inverted counterpart of the listing card, matching the bot's
// profile picture: brown ground, cream mark and type. Used for non-listing
// moments (the bot's welcome message; reusable as a generic OG image).
// ---------------------------------------------------------------------------

export type BrandCardInput = { title: string; subtitle?: string; tagline?: string };

const CREAM_MUTED = "rgba(246,236,215,0.68)";
const CREAM_FRAME = "rgba(246,236,215,0.26)";
const CREAM_LINE = "rgba(246,236,215,0.4)";
const LOGO_CREAM = logoPng(CREAM, 340); // 2× the display width, for crispness

function buildBrandTree(input: BrandCardInput): Node {
  const inner: Node[] = [
    img(LOGO_CREAM, 170, 123),
    h(
      "div",
      {
        display: "flex",
        fontFamily: SERIF,
        fontWeight: 600,
        fontSize: 84,
        letterSpacing: -1,
        color: CREAM,
        marginTop: 30,
      },
      input.title,
    ),
  ];
  if (input.subtitle) {
    inner.push(
      h(
        "div",
        { display: "flex", fontSize: 32, fontWeight: 500, color: CREAM_MUTED, marginTop: 12 },
        input.subtitle,
      ),
    );
  }
  if (input.tagline) {
    inner.push(
      h("div", { display: "flex", height: 1, width: 220, backgroundColor: CREAM_LINE, marginTop: 34 }, ""),
      h(
        "div",
        {
          display: "flex",
          fontSize: 23,
          fontWeight: 500,
          letterSpacing: 2,
          color: CREAM_MUTED,
          marginTop: 34,
        },
        input.tagline.toUpperCase(),
      ),
    );
  }
  return h(
    "div",
    { display: "flex", width: WIDTH, height: HEIGHT, padding: 24, backgroundColor: BROWN, fontFamily: SANS },
    [
      h(
        "div",
        {
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
          border: `1.5px solid ${CREAM_FRAME}`,
          borderRadius: 4,
        },
        inner,
      ),
    ],
  );
}

export async function renderBrandCard(input: BrandCardInput): Promise<Buffer> {
  const svg = await satori(buildBrandTree(input) as never, { width: WIDTH, height: HEIGHT, fonts: FONTS });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    background: BROWN,
    font: { fontFiles: FONT_FILES.map(fontFile), loadSystemFonts: false, defaultFontFamily: SANS },
  });
  return resvg.render().asPng();
}
