// Two-tier social-studies field classifier.
// Tier 1: keyword check (sync, free). Tier 2: Claude Haiku fallback for
// ambiguous listings. See CLAUDE.md "Field classification".

import Anthropic from "@anthropic-ai/sdk";
import {
  EXCLUDE_KEYWORDS,
  FIELD_TAGS,
  INCLUDE_KEYWORDS,
  type Classification,
  type FieldTag,
} from "@rue/shared";

export type Tier1Result =
  | { decision: "include"; fitScore: number; matched: string[] }
  | { decision: "exclude"; matched: string[] }
  | { decision: "ambiguous"; includeMatches: string[]; excludeMatches: string[] };

export async function classify(input: {
  title: string;
  description: string;
}): Promise<Classification> {
  const tier1 = classifyTier1(input);
  const fields = inferFields(`${input.title}\n${input.description}`);

  if (tier1.decision === "include") {
    return {
      fits: true,
      fields,
      fit_score: tier1.fitScore,
      reason: `Matched social-studies terms: ${tier1.matched.join(", ")}`,
    };
  }

  if (tier1.decision === "exclude") {
    return {
      fits: false,
      fields: [],
      fit_score: 0,
      reason: `Matched excluded role terms: ${tier1.matched.join(", ")}`,
    };
  }

  const llm = await classifyWithLlm(input).catch(() => null);
  if (llm) return llm;

  return {
    fits: tier1.includeMatches.length > 0,
    fields,
    fit_score: tier1.includeMatches.length > 0 ? 60 : 0,
    reason:
      tier1.includeMatches.length > 0
        ? `Ambiguous keyword match without LLM fallback: ${tier1.includeMatches.join(", ")}`
        : "No clear social-studies match and LLM fallback unavailable",
  };
}

export function classifyTier1(input: {
  title: string;
  description: string;
}): Tier1Result {
  const title = input.title.toLowerCase();
  const text = `${input.title}\n${input.description}`.toLowerCase();

  const includeMatches = INCLUDE_KEYWORDS.filter((kw) =>
    keywordMatches(text, kw),
  );
  const excludeTitleMatches = EXCLUDE_KEYWORDS.filter((kw) =>
    keywordMatches(title, kw),
  );
  const excludeTextMatches = EXCLUDE_KEYWORDS.filter((kw) =>
    keywordMatches(text, kw),
  );

  if (includeMatches.length > 0 && excludeTextMatches.length === 0) {
    return {
      decision: "include",
      fitScore: scoreInclude(includeMatches),
      matched: includeMatches,
    };
  }

  if (includeMatches.length === 0 && excludeTitleMatches.length > 0) {
    return { decision: "exclude", matched: excludeTitleMatches };
  }

  if (includeMatches.length === 0 && excludeTextMatches.length === 0) {
    return { decision: "ambiguous", includeMatches: [], excludeMatches: [] };
  }

  return {
    decision: "ambiguous",
    includeMatches,
    excludeMatches: excludeTextMatches,
  };
}

function scoreInclude(matches: readonly string[]): number {
  const highSignal = [
    "governance",
    "human rights",
    "election",
    "democracy",
    "peacebuilding",
    "international relations",
    "public policy",
    "policy",
  ];
  const hasHighSignal = matches.some((m) => highSignal.includes(m));
  return Math.min(95, hasHighSignal ? 85 + matches.length * 3 : 70 + matches.length * 4);
}

function inferFields(text: string): FieldTag[] {
  const t = text.toLowerCase();
  const out = new Set<FieldTag>();
  const add = (tag: FieldTag, terms: string[]) => {
    if (terms.some((term) => keywordMatches(t, term))) out.add(tag);
  };

  add("governance", ["governance", "public administration"]);
  add("human-rights", ["human rights", "rights"]);
  add("peace-conflict", ["peace", "conflict", "peacebuilding"]);
  add("elections-democracy", ["election", "democracy", "civic"]);
  add("policy", ["policy", "public policy"]);
  add("international-relations", ["international relations", "diplomacy", "IR"]);
  add("gender", ["gender", "women's rights", "women rights"]);
  add("migration-refugees", ["migration", "refugees", "refugee"]);
  add("civil-society", ["civil society", "cso"]);
  add("development-studies", ["development studies", "development"]);
  add("sociology", ["sociology", "social science", "anthropology"]);
  add("advocacy-comms", ["advocacy", "communications", "campaign"]);
  add("digital-rights", ["digital rights", "internet freedom", "online safety"]);

  return Array.from(out).filter((tag) => FIELD_TAGS.includes(tag));
}

function keywordMatches(text: string, keyword: string): boolean {
  const escaped = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

async function classifyWithLlm(input: {
  title: string;
  description: string;
}): Promise<Classification | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: process.env.CLASSIFIER_MODEL ?? "claude-3-5-haiku-latest",
    max_tokens: 300,
    temperature: 0,
    system:
      "Classify Ethiopian internship listings for senior-year social-studies undergrads. Return only JSON: {\"fits\":boolean,\"fields\":string[],\"fit_score\":number,\"reason\":\"short\"}. Use only these fields: " +
      FIELD_TAGS.join(", ") +
      ". Do not include health, logistics, finance, engineering, sales, driver, or IT support roles unless the listing is clearly policy/governance/human-rights focused.",
    messages: [
      {
        role: "user",
        content: `Title: ${input.title}\n\nDescription:\n${input.description.slice(0, 6000)}`,
      },
    ],
  });

  const text = msg.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) return null;

  const parsed = JSON.parse(text) as Classification;
  return {
    fits: Boolean(parsed.fits),
    fields: parsed.fields.filter((f): f is FieldTag =>
      FIELD_TAGS.includes(f as FieldTag),
    ),
    fit_score: Math.max(0, Math.min(100, Math.round(parsed.fit_score))),
    reason: String(parsed.reason ?? "LLM fallback classification"),
  };
}
