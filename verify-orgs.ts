// scripts/verify-orgs.ts
// Run with: bun run scripts/verify-orgs.ts
//
// Reads orgs-seed.csv, fetches each website/careers_url, and writes
// orgs-verified.csv with a `status` column indicating which URLs are live.
// Be polite: 1s delay between requests, 10s timeout per fetch.

import { readFileSync, writeFileSync } from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

const INPUT = "./orgs-seed.csv";
const OUTPUT = "./orgs-verified.csv";
const DELAY_MS = 1000;
const TIMEOUT_MS = 10_000;
const USER_AGENT = "TilqBot/0.1 (+https://yoursite.example/about)";

type Row = Record<string, string>;

async function checkUrl(url: string): Promise<string> {
  if (!url) return "empty";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) return `ok-${res.status}`;
    // some servers reject HEAD; retry with GET
    if (res.status === 405 || res.status === 403) {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), TIMEOUT_MS);
      const res2 = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: controller2.signal,
      });
      clearTimeout(timer2);
      return res2.ok ? `ok-${res2.status}-get` : `fail-${res2.status}`;
    }
    return `fail-${res.status}`;
  } catch (err: any) {
    return `error-${err?.name ?? "unknown"}`;
  }
}

async function main() {
  const raw = readFileSync(INPUT, "utf-8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true }) as Row[];

  console.log(`Verifying ${rows.length} orgs…`);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const websiteStatus = await checkUrl(r.website);
    await new Promise((res) => setTimeout(res, DELAY_MS));
    const careersStatus = await checkUrl(r.careers_url);
    await new Promise((res) => setTimeout(res, DELAY_MS));
    const internshipStatus = await checkUrl(r.internship_url);
    await new Promise((res) => setTimeout(res, DELAY_MS));

    r.website_status = websiteStatus;
    r.careers_status = careersStatus;
    r.internship_status = internshipStatus;
    console.log(
      `[${i + 1}/${rows.length}] ${r.slug.padEnd(28)} web:${websiteStatus.padEnd(12)} careers:${careersStatus.padEnd(12)} internship:${internshipStatus}`
    );
  }

  const out = stringify(rows, { header: true });
  writeFileSync(OUTPUT, out);
  console.log(`\nDone. Wrote ${OUTPUT}`);

  const ok = rows.filter((r) => r.website_status?.startsWith("ok")).length;
  console.log(`Websites live: ${ok}/${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
