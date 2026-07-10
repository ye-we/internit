// Pre-classifier gates every source applies before yielding a listing.
// Deterministic, no AI: "is this an internship at all" (the product is
// internships only) and "can a student in Ethiopia plausibly take it".
// The downstream classifier handles field-fit (political science vs finance).

import { collapse } from "./html.js";

// --- Internship-only matcher -------------------------------------------------

// Positive: internship/intern/traineeship. "traineeship" is the EU/UN word for
// an internship (Blue Book Traineeship, AU Internship/Traineeship). Bare
// "trainee", "fellowship", and "graduate programme" are deliberately excluded —
// they're early-career *jobs*, not internships.
const INTERN_RE = /\b(intern|interns|internship|internships|traineeship|traineeships)\b/i;

// Titles that contain "intern(ship)" but name a staff role that *runs* an
// internship programme rather than an internship a student can hold:
// "Internship Coordinator", "Internship Programme Manager", "Intern Supervisor".
const STAFF_RE =
  /\bintern(?:ship)?s?\s+(?:programme?\s+)?(?:and\s+\w+\s+)?(coordinator|co-?ordinator|coordination|manager|management|supervisor|officer|lead|leader|specialist|consultant|advis(?:or|er)|director|mentor|focal\s+point|liaison)\b/i;

export function isInternship(title: string): boolean {
  const t = collapse(title);
  if (!INTERN_RE.test(t)) return false;
  if (STAFF_RE.test(t)) return false;
  return true;
}

// Aggregator/digest posts — "Job vacancies at X", "10 Job and Internship
// opportunities at Y" — bundle many roles under one post, so they aren't a
// single internship and shouldn't enter the feed as one listing. The numbered
// arm deliberately omits "intern(s)" so "5 Interns Required" (one role, several
// openings) is NOT treated as a digest.
const ROUNDUP_RE =
  /\b\d+\s+(?:jobs?|positions?|roles?|opportunit\w*|vacanc\w*)\b|\b(?:job|internship)s?\s+(?:vacanc\w*|opportunit\w*)\s+(?:at|with|in)\b|\b(?:vacancies|opportunities)\s+(?:at|with)\b/i;

export function isRoundup(title: string): boolean {
  return ROUNDUP_RE.test(collapse(title));
}

// --- Ethiopia accessibility --------------------------------------------------

export type AccessCategory =
  | "ethiopia"
  | "remote"
  | "sponsored"
  | "restricted"
  | "elsewhere"
  | "unclear";

export type AccessResult = {
  accessible: boolean;
  category: AccessCategory;
  reason: string;
};

export type AccessParts = {
  location?: string | null;
  title?: string;
  descriptionText?: string;
};

const ETHIOPIA_RE =
  /\b(ethiopia|ethiopian|addis\s*ababa|addis|hawassa|awassa|bahir\s*dar|mekelle|mek'?ele|dire\s*dawa|adama|jimma|gondar|jijiga)\b/i;

// Remote as a work *modality*, not the dictionary word.
const REMOTE_WORD = /\bremote\b/i;
const REMOTE_MODALITY =
  /\b(fully\s+remote|100%\s+remote|remote(?:\s+(?:position|role|internship|work|working|based|first|only|eligible|opportunity))|home[-\s]?based|work\s+from\s+home|work\s+from\s+anywhere|telecommut\w+|virtual\s+internship|distance\s+internship)\b/i;
// "remote areas / villages / field" = humanitarian geography, not modality.
const REMOTE_GEOGRAPHY =
  /\bremote\s+(areas?|regions?|villages?|communit\w+|locations?|location|field|districts?|woredas?|zones?|parts?|settings?|sites?|rural)\b/i;
// Phrases that cancel a remote signal. The `no(?:t)?\s+(?:\w+\s+){0,2}remote`
// arm catches "not remote", "no remote", and "not a remote position". The
// hybrid/percentage/days arms catch partial-remote perks anchored to a foreign
// duty station ("up to 40% of remote work", "2 days remote per week") — the
// 1–2-digit bound deliberately lets "100% remote" through as fully remote.
const REMOTE_NEG =
  /\b(no(?:t)?\s+(?:\w+\s+){0,2}remote|non[-\s]?remote|on[-\s]?site|in[-\s]?person|in\s+the\s+office|must\s+relocate|relocation\s+(?:is\s+)?required|based\s+(?:in|at)\s+(?:our|the)\s+\S+\s+office|hybrid|\d{1,2}\s*%\s+(?:of\s+)?remote|\d+\s+days?\s+(?:of\s+)?remote)\b/i;

// Travel / visa / relocation explicitly provided → abroad but doable.
// Deliberately precise: vague phrases like "fully funded" (usually a programme
// scholarship, not relocation) and "visa support" (matches "visa support
// letter", which is NOT sponsorship) are excluded. Accommodation/housing alone
// is NOT sponsorship either — "basic accommodation provided" at a foreign duty
// station doesn't cover the flight and visa that actually gate an Ethiopian
// applicant.
const SPONSOR_RE =
  /\b(visa\s+sponsorship|visa\s+(?:will\s+be\s+)?(?:sponsored|provided|arranged)|relocation\s+(?:support|assistance|package|allowance|provided|covered|reimbursed)|(?:travel|airfare|flights?)\s+(?:costs?\s+|expenses?\s+)?(?:are\s+|will\s+be\s+|is\s+)?(?:provided|covered|reimbursed|arranged)|(?:cover|covers|provide|provides|reimburse|reimburses)\s+(?:the\s+(?:cost\s+of\s+)?|your\s+|all\s+)?(?:travel|airfare|flights?|relocation))\b/i;
// Cancels a sponsorship signal: "we do not cover travel", "cannot provide
// visa", or the giveaway "visa support letter".
const SPONSOR_NEG =
  /\b(?:not|cannot|can'?t|unable\s+to|will\s+not|won'?t|does\s+not|do\s+not|don'?t|no(?:t)?)\b[^.]{0,30}\b(?:cover|covers|provide|provides|sponsor|fund|funded|reimburse|reimburses|arrange)\b|\bvisa\s+support\s+letter\b/i;

// Explicit work-authorization / nationality lock to a non-Ethiopia country.
const RESTRICT_RE =
  /\b(must\s+(?:be\s+)?(?:eligible|authoriz\w+|authoris\w+|legally\s+(?:able|entitled)|have\s+the\s+(?:legal\s+)?right)\s+to\s+work\s+in\s+(?:the\s+)?(?:us|u\.s\.?|usa|united\s+states|uk|united\s+kingdom|eu|european\s+union|canada|australia|switzerland|schengen)|work\s+(?:authoriz\w+|authoris\w+|permit|visa)\s+(?:in|for)\s+(?:the\s+)?(?:us|usa|united\s+states|uk|eu|canada|australia)|(?:us|u\.s\.?|eu|uk|canadian|australian|swiss)\s+(?:citizens?|nationals?|residents?)\s+only|right\s+to\s+work\s+in\s+(?:the\s+)?(?:us|uk|eu|united|canada|australia))\b/i;

export function ethiopiaAccess(parts: AccessParts): AccessResult {
  const loc = collapse(parts.location ?? "");
  const text = `${parts.title ?? ""}\n${parts.descriptionText ?? ""}`;
  const hay = `${loc}\n${text}`;

  if (ETHIOPIA_RE.test(loc) || ETHIOPIA_RE.test(text)) {
    return { accessible: true, category: "ethiopia", reason: "Ethiopia-based duty station." };
  }

  const remoteInLoc = REMOTE_WORD.test(loc) && !REMOTE_GEOGRAPHY.test(loc);
  const remoteInText = REMOTE_MODALITY.test(text) && !REMOTE_GEOGRAPHY.test(text);
  if ((remoteInLoc || remoteInText) && !REMOTE_NEG.test(hay)) {
    return {
      accessible: true,
      category: "remote",
      reason: "Remote / home-based, not locked to a foreign duty station.",
    };
  }

  if (RESTRICT_RE.test(text)) {
    return {
      accessible: false,
      category: "restricted",
      reason: "Requires work authorization in a country other than Ethiopia.",
    };
  }

  if (SPONSOR_RE.test(text) && !SPONSOR_NEG.test(text)) {
    return {
      accessible: true,
      category: "sponsored",
      reason: "Abroad, but travel/visa/relocation support is offered.",
    };
  }

  if (loc) {
    return {
      accessible: false,
      category: "elsewhere",
      reason: `In-person at "${loc}", outside Ethiopia, with no remote option or travel support.`,
    };
  }

  return {
    accessible: false,
    category: "unclear",
    reason: "No Ethiopia, remote, or sponsorship signal found.",
  };
}

export function isEthiopiaAccessible(parts: AccessParts): boolean {
  return ethiopiaAccess(parts).accessible;
}
