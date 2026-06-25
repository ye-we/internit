import * as cheerio from "cheerio";

export function collapse(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

// Block-level tags whose boundaries must survive text extraction. `.text()`
// alone concatenates across these, fusing adjacent fields
// ("Addis Ababa" + "Deadline:" → "Addis AbabaDeadline:") and mangling dates,
// which breaks the labelled-field heuristics in text-extract.ts.
const BLOCK_TAGS =
  "p, div, section, article, aside, header, footer, main, " +
  "h1, h2, h3, h4, h5, h6, ul, ol, li, dl, dt, dd, " +
  "table, caption, tr, blockquote, figure, figcaption, pre, address, fieldset, hr";

// Plain-text rendering of a posting body for search, classification, and the
// labelled-field parsers. MUST run on the pre-sanitize container HTML: once
// cleanDescriptionHtml() unwraps <div>/<span>, the block boundaries are gone
// and adjacent fields fuse irreversibly. Inserts newlines at block edges and a
// tab between table cells so labelled lines stay separable.
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<root>${html}</root>`, null, false);
  $("script, style, noscript").remove();
  $("br").replaceWith("\n");
  $("td, th").each((_, el) => {
    $(el).append("\t");
  });
  $(BLOCK_TAGS).each((_, el) => {
    $(el).append("\n");
  });
  return $("root")
    .text()
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

export class BrowserChallengeError extends Error {
  constructor(public readonly url: string) {
    super(`browser challenge interstitial at ${url}`);
    this.name = "BrowserChallengeError";
  }
}

export function isBrowserInterstitial(html: string): boolean {
  return (
    /<title>\s*(One moment, please\.\.\.|Just a moment\.\.\.|Attention Required!|Access denied)\s*[^<]*<\/title>/i.test(
      html,
    ) ||
    /cf-browser-verification|cf_chl_|challenge-platform|_Incapsula_Resource|sucuri_cloudproxy/i.test(
      html,
    )
  );
}

// Semantic tags we keep so reader-mode renders the posting beautifully with no
// LLM reformatting: headings, prose, lists, definition lists, tables, inline
// emphasis, links, and images. Everything kept here is safe once attributes
// are stripped to the per-tag allowlist below.
const ALLOWED = new Set([
  "p", "br", "hr", "blockquote", "pre",
  "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
  "a", "strong", "b", "em", "i", "u", "s", "mark", "small",
  "sub", "sup", "abbr", "cite", "code", "kbd", "q",
  "img", "figure", "figcaption",
]);

// Dropped entirely — tag and all descendants. Scripts/forms/embeds for safety;
// `ins` because ad networks (AdSense) inject ad slots as <ins>.
const STRIP = [
  "script", "style", "iframe", "form", "input", "textarea", "select", "option",
  "button", "noscript", "svg", "math", "object", "embed", "link", "meta",
  "template", "canvas", "audio", "video", "map", "area", "ins", "fieldset",
  "legend", "dialog", "menu",
];

// Any tag not in ALLOWED and not in STRIP (div, span, section, nav, font…) is
// unwrapped: the tag goes, its children stay.

export function cleanDescriptionHtml(
  html: string,
  opts: { resolveUrl?: (href: string) => string } = {},
): string {
  const $ = cheerio.load(`<main>${html}</main>`, null, false);
  const $main = $("main");

  $main.find(STRIP.join(",")).remove();

  // Drop HTML comments anywhere in the subtree.
  $main
    .find("*")
    .addBack()
    .contents()
    .each((_, node) => {
      if (node.type === "comment") $(node).remove();
    });

  $("main *").each((_, el) => {
    if (el.tagName?.toLowerCase() === "h1") el.tagName = "h2";
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    if (!tag) return;

    if (!ALLOWED.has(tag)) {
      $el.replaceWith($el.contents());
      return;
    }

    // Capture sizing before attributes are stripped, to spot tracking pixels.
    const origWidth = el.attribs?.width;
    const origHeight = el.attribs?.height;

    for (const name of Object.keys(el.attribs ?? {})) {
      const keep =
        (tag === "a" && (name === "href" || name === "title")) ||
        (tag === "img" && (name === "src" || name === "alt")) ||
        ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan")) ||
        (tag === "abbr" && name === "title");
      if (!keep) $el.removeAttr(name);
    }

    if (tag === "a") {
      const href = $el.attr("href")?.trim();
      if (!href || href.startsWith("#") || /^javascript:/i.test(href)) {
        $el.replaceWith($el.contents());
      } else if (/^(mailto:|tel:)/i.test(href)) {
        // usable apply links — leave as-is, no target/rel
      } else {
        const resolved =
          opts.resolveUrl && !/^https?:\/\//i.test(href) ? opts.resolveUrl(href) : href;
        if (!/^https?:\/\//i.test(resolved)) {
          $el.replaceWith($el.contents());
        } else {
          $el.attr("href", resolved).attr("target", "_blank").attr("rel", "noopener noreferrer");
        }
      }
    } else if (tag === "img") {
      const src = $el.attr("src")?.trim();
      const alt = collapse($el.attr("alt") ?? "");
      const trackingPixel =
        origWidth === "1" ||
        origHeight === "1" ||
        origWidth === "0" ||
        origHeight === "0" ||
        (!alt && !!src && /\.gif(\?|$)/i.test(src));
      if (!src || /^(data:|javascript:)/i.test(src) || trackingPixel) {
        $el.remove();
      } else {
        const resolved =
          opts.resolveUrl && !/^https?:\/\//i.test(src) ? opts.resolveUrl(src) : src;
        if (!/^https?:\/\//i.test(resolved)) $el.remove();
        else $el.attr("src", resolved);
      }
    }
  });

  // Remove blocks left empty after sanitizing, but keep anything still carrying
  // media or list/table structure.
  $(
    "main p, main li, main h2, main h3, main h4, main h5, main h6, main blockquote, main dt, main dd, main figcaption",
  ).each((_, el) => {
    const $el = $(el);
    if (collapse($el.text())) return;
    if ($el.find("img, br, ul, ol, table").length > 0) return;
    $el.remove();
  });

  return ($("main").html() ?? "").trim();
}
