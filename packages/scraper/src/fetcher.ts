// Polite HTTP fetcher: identifies UA, enforces minimum delay between
// requests, applies a timeout, and can enforce robots.txt per host.
// See CLAUDE.md "Scraping politeness".

import { SCRAPER_USER_AGENT } from "./index.js";
import { setDefaultResultOrder } from "node:dns";

const DEFAULT_DELAY_MS = 4_000; // mid-point of the 3–5s window
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRIES = 2;
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

setDefaultResultOrder("ipv4first");

type RobotsEntry = { fetchedAt: number; allows: (path: string) => boolean };

export class PoliteFetcher {
  private lastRequestAt = 0;
  private robotsCache = new Map<string, RobotsEntry>();

  constructor(
    private readonly opts: {
      userAgent?: string;
      delayMs?: number;
      timeoutMs?: number;
      retries?: number;
      respectRobots?: boolean;
    } = {},
  ) {}

  async get(url: string, accept = "text/html,application/xhtml+xml"): Promise<string> {
    const u = new URL(url);
    if (this.opts.respectRobots !== false) {
      await this.assertAllowed(u);
    }
    await this.throttle();
    return this.rawGet(url, accept);
  }

  private async rawGet(
    url: string,
    accept = "text/html,application/xhtml+xml",
  ): Promise<string> {
    const maxAttempts = (this.opts.retries ?? DEFAULT_RETRIES) + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(
        () => ctrl.abort(),
        this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": this.opts.userAgent ?? SCRAPER_USER_AGENT,
            Accept: accept,
          },
          redirect: "follow",
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw new Error(`GET ${url} → HTTP ${res.status}`);
        }
        return await res.text();
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await sleep(1_500 * attempt);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`GET ${url} failed`);
  }

  private async throttle() {
    const delay = this.opts.delayMs ?? DEFAULT_DELAY_MS;
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < delay) {
      await sleep(delay - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  private async assertAllowed(u: URL) {
    const key = u.origin;
    let entry = this.robotsCache.get(key);
    if (!entry || Date.now() - entry.fetchedAt > ROBOTS_TTL_MS) {
      entry = await this.loadRobots(key);
      this.robotsCache.set(key, entry);
    }
    if (!entry.allows(u.pathname + u.search)) {
      throw new Error(`robots.txt disallows ${u.href}`);
    }
  }

  private async loadRobots(origin: string): Promise<RobotsEntry> {
    await this.throttle();
    let body = "";
    try {
      body = await this.rawGet(`${origin}/robots.txt`);
    } catch {
      // No robots.txt or unreachable → assume allowed.
      return { fetchedAt: Date.now(), allows: () => true };
    }
    const rules = parseRobotsForUserAgent(
      body,
      this.opts.userAgent ?? SCRAPER_USER_AGENT,
    );
    return {
      fetchedAt: Date.now(),
      allows: (path) => isAllowed(rules, path),
    };
  }
}

type Rules = { allow: string[]; disallow: string[] };

function parseRobotsForUserAgent(body: string, ua: string): Rules {
  // Tiny parser: match the most specific UA group whose token is a
  // case-insensitive substring of our UA; fall back to *. Per RFC 9309
  // we'd merge groups by UA but a single host like ethiongojobs only
  // exposes `User-agent: *`, so this is enough.
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);

  const groups: Array<{ uas: string[]; allow: string[]; disallow: string[] }> = [];
  let current: (typeof groups)[number] | null = null;

  for (const line of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || current.allow.length || current.disallow.length) {
        current = { uas: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.uas.push(val.toLowerCase());
    } else if (current && key === "allow") {
      current.allow.push(val);
    } else if (current && key === "disallow") {
      current.disallow.push(val);
    }
  }

  const uaLower = ua.toLowerCase();
  const specific = groups.find((g) =>
    g.uas.some((u) => u !== "*" && uaLower.includes(u)),
  );
  const wildcard = groups.find((g) => g.uas.includes("*"));
  const chosen = specific ?? wildcard;
  return { allow: chosen?.allow ?? [], disallow: chosen?.disallow ?? [] };
}

function isAllowed(rules: Rules, path: string): boolean {
  const longest = (patterns: string[]) =>
    patterns
      .filter((p) => p && pathMatches(p, path))
      .reduce((best, p) => (p.length > best.length ? p : best), "");
  const a = longest(rules.allow);
  const d = longest(rules.disallow);
  if (!d) return true;
  // Allow wins ties and longer-or-equal matches per the spec's intent.
  if (a && a.length >= d.length) return true;
  return d === "";
}

function pathMatches(pattern: string, path: string): boolean {
  // Supports `*` wildcard and `$` end-anchor. No `?` literal escaping.
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$"),
  );
  return re.test(path);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
