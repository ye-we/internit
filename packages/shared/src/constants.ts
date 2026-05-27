// Field classification keywords — see CLAUDE.md "Field classification".
// Tier 1 keyword check runs on every scraped listing before any LLM call.

export const INCLUDE_KEYWORDS = [
  "political",
  "IR",
  "international relations",
  "governance",
  "policy",
  "peace",
  "conflict",
  "election",
  "civic",
  "democracy",
  "human rights",
  "diplomacy",
  "advocacy",
  "civil society",
  "social science",
  "sociology",
  "anthropology",
  "development studies",
  "public administration",
  "public policy",
  "gender",
  "women's rights",
  "refugees",
  "migration",
  "peacebuilding",
] as const;

export const EXCLUDE_KEYWORDS = [
  "health",
  "medical",
  "nutrition",
  "WASH",
  "livestock",
  "agriculture",
  "veterinary",
  "accountant",
  "finance officer",
  "engineering",
  "mechanic",
  "supply chain",
  "logistics officer",
  "driver",
  "IT support",
  "network admin",
  "sales",
] as const;

export const FIELD_TAGS = [
  "governance",
  "human-rights",
  "peace-conflict",
  "elections-democracy",
  "policy",
  "international-relations",
  "gender",
  "migration-refugees",
  "civil-society",
  "development-studies",
  "sociology",
  "advocacy-comms",
  "digital-rights",
] as const;
export type FieldTag = (typeof FIELD_TAGS)[number];

export const SCRAPE_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type ScrapePriority = (typeof SCRAPE_PRIORITIES)[number];

export const LISTING_STATUS = ["active", "expired", "hidden"] as const;
export type ListingStatus = (typeof LISTING_STATUS)[number];

export const ORG_CATEGORIES = [
  "un",
  "au",
  "regional",
  "think-tank",
  "human-rights-intl",
  "human-rights-eth",
  "election-democracy",
  "ingo",
  "bilateral",
  "embassy",
  "foundation",
  "multilateral",
  "gender",
  "climate",
  "media",
  "digital-rights",
  "government-eth",
  "aggregator",
  "other",
] as const;

export const FIT_THRESHOLDS = {
  showOnSite: 50,
  broadcastToChannel: 70,
  bullseye: 90,
} as const;
