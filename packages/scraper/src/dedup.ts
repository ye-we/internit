// Cross-source duplicate detection. The same posting (e.g. an ECA internship)
// shows up via ethiongojobs, un-careers, undp, reliefweb… with different
// source_urls AND different org-name strings ("Economic Commission for Africa"
// vs "United Nations Careers"), so org can't be the match key. What stays
// stable across sources is the normalized title + location; description
// similarity then confirms it's the same job and guards against merging two
// distinct "Communications Intern, Addis Ababa" postings from different orgs.
//
// Calibrated on real data: true repost pair scores Jaccard 0.93, distinct jobs
// ~0.17 — a 0.5 threshold sits in the wide gap between them.

export const DUP_SIMILARITY_THRESHOLD = 0.5;

export type DedupItem = {
  id: string;
  title: string;
  location: string | null;
  descriptionText: string;
  sourceUrl: string;
};

// "Internship: Human Resources Intern" → "human resources"
// "(MEL and Communication Intern)"     → "mel and communication"
// "IT Support Internship (5 Required)" → "it support"
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(\s*\d+\s*(required|positions?|posts?|vacancies|needed)\s*\)/gi, " ")
    .replace(/^\s*(internship|intern)\s*[:\-–]\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(internships?|interns?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// First place token, lowercased: "Addis Ababa, Ethiopia" → "addis ababa".
export function normalizeLocation(location: string | null): string {
  return (location ?? "")
    .toLowerCase()
    .split(",")[0]!
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Significant words (len ≥ 4 drops most stop-words) — the shape that gave the
// cleanest dup/non-dup separation during calibration.
export function descriptionTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function locationCompatible(a: string, b: string): boolean {
  return a === b || a === "" || b === "";
}

// Canonical = richest reader payload (longest description), stable tiebreak on
// sourceUrl so re-runs are deterministic.
function rankCanonical(items: DedupItem[]): DedupItem[] {
  return [...items].sort(
    (a, b) =>
      b.descriptionText.length - a.descriptionText.length ||
      a.sourceUrl.localeCompare(b.sourceUrl),
  );
}

// Returns one cluster per set of duplicates (size ≥ 2), canonical element first.
export function clusterDuplicates(
  items: DedupItem[],
  threshold = DUP_SIMILARITY_THRESHOLD,
): DedupItem[][] {
  const byTitle = new Map<string, DedupItem[]>();
  for (const item of items) {
    const key = normalizeTitle(item.title);
    if (!key) continue; // a title that normalizes to nothing can't be matched safely
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(item);
    else byTitle.set(key, [item]);
  }

  const clusters: DedupItem[][] = [];
  for (const group of byTitle.values()) {
    if (group.length < 2) continue;

    const tokens = group.map((g) => descriptionTokens(g.descriptionText));
    const locs = group.map((g) => normalizeLocation(g.location));

    // Union-find over pairs that share a location and a similar body.
    const parent = group.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) x = parent[x] = parent[parent[x]!]!;
      return x;
    };
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (locationCompatible(locs[i]!, locs[j]!) && jaccard(tokens[i]!, tokens[j]!) >= threshold) {
          parent[find(i)] = find(j);
        }
      }
    }

    const byRoot = new Map<number, DedupItem[]>();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      const bucket = byRoot.get(root);
      if (bucket) bucket.push(group[i]!);
      else byRoot.set(root, [group[i]!]);
    }
    for (const cluster of byRoot.values()) {
      if (cluster.length > 1) clusters.push(rankCanonical(cluster));
    }
  }
  return clusters;
}
