// Guarded LLM extraction for the two fields deterministic parsing misses most:
// the application deadline and whether the role is paid. Both are things
// students act on, so the LLM is held to a strict rule — it must quote the
// supporting phrase from the posting, and we reject anything whose quote isn't
// found verbatim in the text. That fills gaps (undated AU/Idealist listings,
// deadlines buried in prose, oddly-worded pay terms) WITHOUT inventing values.
//
// Only called as a fallback when the deterministic value is null, and cached by
// content hash upstream, so it's cheap on the LLM budget.

import { parseDeadline } from "./text-extract.js";

export type Gaps = { deadline: Date | null; isPaid: boolean | null };

const EMPTY: Gaps = { deadline: null, isPaid: null };
const GEMINI_MODEL = process.env.STRUCTURER_MODEL ?? "gemini-2.5-flash-lite";

const GAP_SCHEMA = {
  type: "object",
  properties: {
    deadline_iso: {
      type: "string",
      description: "Application deadline as YYYY-MM-DD if explicitly stated, else empty string",
    },
    deadline_evidence: {
      type: "string",
      description: "The exact phrase from the posting that states the deadline, copied verbatim; else empty",
    },
    is_paid: { type: "string", enum: ["paid", "unpaid", "unclear"] },
    pay_evidence: {
      type: "string",
      description: "The exact phrase from the posting that states pay/stipend or that it is unpaid, verbatim; else empty",
    },
  },
  required: ["deadline_iso", "deadline_evidence", "is_paid", "pay_evidence"],
};

type GapResponse = {
  deadline_iso?: string;
  deadline_evidence?: string;
  is_paid?: string;
  pay_evidence?: string;
};

export async function extractGaps(input: {
  title: string;
  descriptionText: string;
}): Promise<Gaps> {
  if (!process.env.GEMINI_API_KEY) return EMPTY;

  const text = input.descriptionText.slice(0, 8000);
  const prompt =
    `From this internship posting, extract ONLY information that is explicitly stated. Never infer or guess.\n\n` +
    `Title: ${input.title}\n\nPosting:\n${text}\n\n` +
    `Return: the application deadline (deadline_iso, YYYY-MM-DD) with the exact quote stating it (deadline_evidence); ` +
    `and whether interns are paid (is_paid: paid/unpaid/unclear) with the exact quote (pay_evidence). ` +
    `If the deadline is not explicitly stated, return empty strings. If pay is not stated, return "unclear".`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: GAP_SCHEMA,
          },
        }),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return EMPTY;
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!raw) return EMPTY;
    return verify(JSON.parse(raw) as GapResponse, text);
  } catch {
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

// The guard: an extracted field is only trusted if its quoted evidence actually
// appears in the posting text. No grounding quote → null (never invented).
export function verify(out: GapResponse, sourceText: string): Gaps {
  const hay = norm(sourceText);

  let deadline: Date | null = null;
  if (out.deadline_iso && grounded(out.deadline_evidence, hay)) {
    deadline = parseDeadline(out.deadline_iso) ?? safeDate(out.deadline_iso);
  }

  let isPaid: boolean | null = null;
  if ((out.is_paid === "paid" || out.is_paid === "unpaid") && grounded(out.pay_evidence, hay)) {
    isPaid = out.is_paid === "paid";
  }

  return { deadline, isPaid };
}

function grounded(evidence: string | undefined, hay: string): boolean {
  const e = norm(evidence ?? "");
  return e.length >= 8 && hay.includes(e);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
