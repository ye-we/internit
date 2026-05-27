import * as cheerio from "cheerio";

export function collapse(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function cleanDescriptionHtml(
  html: string,
  opts: { resolveUrl?: (href: string) => string } = {},
): string {
  const $ = cheerio.load(`<main>${html}</main>`, null, false);
  const allowedTags = new Set([
    "a",
    "b",
    "blockquote",
    "br",
    "em",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "li",
    "ol",
    "p",
    "strong",
    "ul",
  ]);

  $("script, style, iframe, form, input, button, noscript, svg").remove();

  $("main *").each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    const $el = $(el);
    if (!tag) return;

    if (tag === "div" || tag === "span" || tag === "section" || tag === "article") {
      $el.replaceWith($el.contents());
      return;
    }

    if (tag === "h1") {
      el.tagName = "h2";
    } else if (!allowedTags.has(tag)) {
      $el.replaceWith($el.contents());
      return;
    }

    for (const attr of Object.keys(el.attribs ?? {})) {
      if (tag === "a" && attr === "href") continue;
      $el.removeAttr(attr);
    }

    if (tag === "a") {
      const href = $el.attr("href")?.trim();
      if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) {
        $el.replaceWith($el.text());
      } else {
        $el.attr("href", opts.resolveUrl ? opts.resolveUrl(href) : href);
        $el.attr("target", "_blank");
        $el.attr("rel", "noopener noreferrer");
      }
    }
  });

  $("p, li, h2, h3, h4, h5, h6").each((_, el) => {
    const $el = $(el);
    if (!collapse($el.text()) && $el.find("br").length === 0) {
      $el.remove();
    }
  });

  return ($("main").html() ?? "").trim();
}
