import {
  StructuredListingSchema,
  type StructuredListing,
} from "@internit/shared";
import type { ScrapedListing } from "./index.js";

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_MAX_INPUT_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_RETRIES = 5;

// Free tier allows 15 requests/min; pace to ≤12/min so a burst never trips the
// RPM limit, and count requests so a run can report how close it came to the
// 1,500/day cap. Module-global: one structurer process = one paced request stream.
const MIN_REQUEST_INTERVAL_MS = Number(process.env.STRUCTURER_MIN_INTERVAL_MS ?? 5_000);
let lastRequestAt = 0;
let geminiRequestCount = 0;

export function getGeminiRequestCount(): number {
  return geminiRequestCount;
}

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  geminiRequestCount += 1;
}

export async function structureListing(
  listing: ScrapedListing,
): Promise<StructuredListing | null> {
  const batch = await structureListingsBatch([listing]);
  return batch.get(listing.sourceUrl) ?? null;
}

export async function structureListingsBatch(
  listings: ScrapedListing[],
): Promise<Map<string, StructuredListing>> {
  if (process.env.STRUCTURER_ENABLED !== "true") return new Map();

  const provider = process.env.STRUCTURER_PROVIDER ?? "gemini";
  if (provider !== "gemini") {
    console.warn(`[structurer] unsupported provider: ${provider}`);
    return new Map();
  }

  try {
    return await structureBatchWithGemini(listings);
  } catch (err) {
    console.warn(
      `[structurer] failed batch:`,
      err instanceof Error ? err.message : err,
    );
    return new Map();
  }
}

async function structureBatchWithGemini(
  listings: ScrapedListing[],
): Promise<Map<string, StructuredListing>> {
  const out = new Map<string, StructuredListing>();
  if (listings.length === 0) return out;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return out;

  const model = process.env.STRUCTURER_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = numberEnv("STRUCTURER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const retries = numberEnv("STRUCTURER_RETRIES", DEFAULT_RETRIES);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      await throttle();
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: buildBatchPrompt(listings) }],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema:
              listings.length === 1
                ? structuredListingJsonSchema
                : structuredListingBatchJsonSchema,
          },
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        const retryMs = retryDelayMs(res.status, body, attempt);
        if (retryMs !== null && attempt < retries) {
          await sleep(retryMs);
          continue;
        }
        throw new Error(`Gemini HTTP ${res.status}: ${body}`);
      }

      const text = extractGeminiText((await res.json()) as GeminiResponse);
      if (!text) return out;
      const parsed = JSON.parse(text);
      if (listings.length === 1) {
        out.set(listings[0]!.sourceUrl, StructuredListingSchema.parse(parsed));
        return out;
      }

      for (const item of parseStructuredListingBatch(parsed)) {
        out.set(item.source_url, item.data);
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  return out;
}

function buildBatchPrompt(listings: ScrapedListing[]): string {
  if (listings.length === 1) return buildPrompt(listings[0]!);

  const maxChars = numberEnv("STRUCTURER_MAX_INPUT_CHARS", DEFAULT_MAX_INPUT_CHARS);
  const items = listings
    .map((listing, index) => {
      const text = listing.descriptionText.slice(0, maxChars);
      return `Listing ${index + 1}
Source URL: ${listing.sourceUrl}
Parsed title: ${listing.title}
Parsed organization: ${listing.orgName}
Parsed location: ${listing.location ?? "unknown"}
Parsed deadline: ${listing.deadline?.toISOString() ?? "unknown"}

Posting text:
${text}`;
    })
    .join("\n\n---\n\n");

  return `Extract and clean each internship/job posting for a reader-mode listing.

Rules:
${STRUCTURER_RULES}
- Return one result for every input listing.
- Preserve the exact source_url for each result.
- Do not mix facts between listings.

Listings:
${items}`;
}

function buildPrompt(listing: ScrapedListing): string {
  const maxChars = numberEnv("STRUCTURER_MAX_INPUT_CHARS", DEFAULT_MAX_INPUT_CHARS);
  const text = listing.descriptionText.slice(0, maxChars);

  return `Extract and clean this internship/job posting for a reader-mode listing.

Rules:
${STRUCTURER_RULES}

Source URL: ${listing.sourceUrl}
Parsed title: ${listing.title}
Parsed organization: ${listing.orgName}
Parsed location: ${listing.location ?? "unknown"}
Parsed deadline: ${listing.deadline?.toISOString() ?? "unknown"}

Posting text:
${text}`;
}

const STRUCTURER_RULES = `- Return only data explicitly present in the text.
- Use null when a value is unclear or missing.
- Do not infer paid/unpaid from general benefits language unless stipend, allowance, paid, unpaid, or not remunerated is explicit.
- application_url must be a complete http or https URL explicitly present in the posting.
- If the posting only says "link", "click here", ">>LINK", or has placeholder text without a real URL, application_url must be null.
- deadline must be the verbatim deadline string if present.
- ethiopia_access classifies whether this is realistically useful for a student applying from Ethiopia:
  - "ethiopia-based": based in Ethiopia or explicitly for Ethiopia.
  - "remote": remote/home-based and open internationally or not country-restricted away from Ethiopia.
  - "sponsored-abroad": abroad/in-person but travel, visa, relocation, housing, or comparable support is explicitly provided.
  - "open-but-self-funded-abroad": abroad/in-person and Ethiopian candidates may apply, but travel/visa/living costs appear self-funded or unclear.
  - "not-realistic": requires in-person work outside Ethiopia with no sponsorship/support, requires local work authorization abroad, or is restricted to another country/region.
  - "unclear": not enough information.
- Favor "not-realistic" over "unclear" when the duty station is outside Ethiopia and the posting does not say remote or provide travel/visa/relocation support.
- If the posting says the internship can be based in Ethiopia, has Ethiopia/Addis Ababa as an allowed duty station, or is explicitly for Ethiopia, use "ethiopia-based" even if other countries are also listed.
- sections must reorganize the posting into readable sections with short titles, paragraphs, and bullets.
- Preserve important application details, dates, eligibility, duties, and documents required.
- Remove ad text, navigation text, repeated boilerplate, and broken formatting.
- Do not create sections for information that is not in the posting.
- confidence is 0 to 1 for extraction confidence.
- warnings should list extraction ambiguities, missing deadline, missing apply instructions, or conflicting fields.`;

function extractGeminiText(response: GeminiResponse): string | null {
  return (
    response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() || null
  );
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function retryDelayMs(status: number, body: string, attempt: number): number | null {
  if (status !== 429 && status !== 503) return null;
  if (body.includes("GenerateRequestsPerDay")) return null;
  const retryInfo = /"retryDelay"\s*:\s*"(\d+)s"/.exec(body);
  if (retryInfo?.[1]) return (Number(retryInfo[1]) + 1) * 1000;
  // Exponential backoff with jitter so retries don't stampede in lockstep.
  return Math.min(60_000, 5_000 * 2 ** attempt) + Math.floor(Math.random() * 1000);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

function parseStructuredListingBatch(
  raw: unknown,
): Array<{ source_url: string; data: StructuredListing }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Gemini batch response was not an object");
  }
  const listings = (raw as { listings?: unknown }).listings;
  if (!Array.isArray(listings)) {
    throw new Error("Gemini batch response had no listings array");
  }
  return listings.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Gemini batch item was not an object");
    }
    const sourceUrl = (item as { source_url?: unknown }).source_url;
    if (typeof sourceUrl !== "string") {
      throw new Error("Gemini batch item had no source_url");
    }
    return {
      source_url: new URL(sourceUrl).href,
      data: StructuredListingSchema.parse((item as { data?: unknown }).data),
    };
  });
}

const nullableString = {
  anyOf: [{ type: "string" }, { type: "null" }],
};

const nullableBoolean = {
  anyOf: [{ type: "boolean" }, { type: "null" }],
};

const structuredListingJsonSchema = {
  type: "object",
  properties: {
    organization: {
      ...nullableString,
      description: "Organization name exactly as stated, or null.",
    },
    location: {
      ...nullableString,
      description: "Work location exactly as stated, or null.",
    },
    deadline: {
      ...nullableString,
      description: "Application deadline exactly as stated, or null.",
    },
    application_url: {
      anyOf: [{ type: "string", format: "uri" }, { type: "null" }],
      description: "Complete explicit http or https application URL, or null.",
    },
    application_email: {
      ...nullableString,
      description: "Explicit application email address, or null.",
    },
    application_method: {
      type: "string",
      enum: ["portal", "email", "in-person", "unclear"],
    },
    ethiopia_access: {
      type: "string",
      enum: [
        "ethiopia-based",
        "remote",
        "sponsored-abroad",
        "open-but-self-funded-abroad",
        "not-realistic",
        "unclear",
      ],
      description:
        "Whether the opportunity is realistically useful for a student applying from Ethiopia.",
    },
    ethiopia_access_reason: {
      type: "string",
      description:
        "Short reason for the Ethiopia-access classification, based only on the posting.",
    },
    is_paid: {
      ...nullableBoolean,
      description: "true, false, or null when compensation is unclear.",
    },
    stipend_text: {
      ...nullableString,
      description: "Verbatim stipend or allowance phrase, or null.",
    },
    summary: {
      type: "string",
      description: "One concise sentence summarizing the opportunity.",
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short reader-mode section heading.",
          },
          paragraphs: {
            type: "array",
            items: { type: "string" },
            description: "Clean prose paragraphs for this section.",
          },
          bullets: {
            type: "array",
            items: { type: "string" },
            description: "Clean bullet points for this section.",
          },
        },
        required: ["title", "paragraphs", "bullets"],
      },
      description:
        "Reader-mode sections that preserve the posting's important body content.",
    },
    requirements: {
      type: "array",
      items: { type: "string" },
      description: "Explicit eligibility, qualifications, or requirements.",
    },
    responsibilities: {
      type: "array",
      items: { type: "string" },
      description: "Explicit duties or responsibilities.",
    },
    how_to_apply: {
      ...nullableString,
      description: "Concise application instructions, or null.",
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description: "Ambiguities, missing important fields, or conflicts.",
    },
    confidence: {
      type: "number",
      description: "Extraction confidence from 0 to 1.",
    },
  },
  required: [
    "organization",
    "location",
    "deadline",
    "application_url",
    "application_email",
    "application_method",
    "ethiopia_access",
    "ethiopia_access_reason",
    "is_paid",
    "stipend_text",
    "summary",
    "sections",
    "requirements",
    "responsibilities",
    "how_to_apply",
    "warnings",
    "confidence",
  ],
} as const;

const structuredListingBatchJsonSchema = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source_url: {
            type: "string",
            format: "uri",
            description: "Exact source URL from the input listing.",
          },
          data: structuredListingJsonSchema,
        },
        required: ["source_url", "data"],
      },
    },
  },
  required: ["listings"],
} as const;
