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

const LLM_SYSTEM =
  "Classify Ethiopian internship listings for senior-year social-studies undergrads. " +
  'Return only JSON: {"fits":boolean,"fields":string[],"fit_score":number,"reason":"short"}. ' +
  "Use only these fields: " +
  FIELD_TAGS.join(", ") +
  ". Do not include health, logistics, finance, engineering, sales, driver, or IT support roles unless the listing is clearly policy/governance/human-rights focused.";

const LLM_USER = (input: { title: string; description: string }) =>
  `Title: ${input.title}\n\nDescription:\n${input.description.slice(0, 6000)}`;

// Tier-2 LLM fallback for ambiguous listings. Defaults to Gemini (free tier;
// the only key this project has) and falls back to Anthropic when configured.
// The caller (classify) already wraps this in .catch(() => null), so a missing
// key, rate limit, or bad response degrades to the keyword heuristic — it never
// breaks the pipeline.
async function classifyWithLlm(input: {
  title: string;
  description: string;
}): Promise<Classification | null> {
  const provider = (
    process.env.CLASSIFIER_PROVIDER ?? (process.env.GEMINI_API_KEY ? "gemini" : "anthropic")
  ).toLowerCase();

  if (provider === "gemini" && process.env.GEMINI_API_KEY) return classifyWithGemini(input);
  if (process.env.ANTHROPIC_API_KEY) return classifyWithAnthropic(input);
  return null;
}

async function classifyWithGemini(input: {
  title: string;
  description: string;
}): Promise<Classification | null> {
  const model = process.env.CLASSIFIER_MODEL ?? "gemini-2.5-flash-lite";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY!,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: LLM_SYSTEM }] },
          contents: [{ parts: [{ text: LLM_USER(input) }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: {
                fits: { type: "boolean" },
                fields: { type: "array", items: { type: "string", enum: [...FIELD_TAGS] } },
                fit_score: { type: "integer" },
                reason: { type: "string" },
              },
              required: ["fits", "fields", "fit_score", "reason"],
            },
          },
        }),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = (json.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    return text ? normalizeClassification(JSON.parse(text)) : null;
  } finally {
    clearTimeout(timer);
  }
}

async function classifyWithAnthropic(input: {
  title: string;
  description: string;
}): Promise<Classification | null> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: process.env.CLASSIFIER_MODEL ?? "claude-haiku-4-5",
    max_tokens: 300,
    system: LLM_SYSTEM,
    messages: [{ role: "user", content: LLM_USER(input) }],
  });
  const text = msg.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text ? normalizeClassification(JSON.parse(text)) : null;
}

function normalizeClassification(parsed: Classification): Classification {
  return {
    fits: Boolean(parsed.fits),
    fields: (parsed.fields ?? []).filter((f): f is FieldTag => FIELD_TAGS.includes(f as FieldTag)),
    fit_score: Math.max(0, Math.min(100, Math.round(Number(parsed.fit_score) || 0))),
    reason: String(parsed.reason ?? "LLM classification"),
  };
}
