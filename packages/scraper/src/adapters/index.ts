import type { Adapter } from "./types.js";
import { genericHtmlAdapter } from "./generic-html.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { idealistAdapter } from "./idealist.js";
import { inspiraAdapter } from "./inspira.js";
import { leverAdapter } from "./lever.js";
import { oracleHcmAdapter } from "./oracle-hcm.js";
import { reliefwebAdapter } from "./reliefweb.js";
import { smartrecruitersAdapter } from "./smartrecruiters.js";
import { successfactorsAdapter } from "./successfactors.js";
import { wordpressAdapter } from "./wordpress.js";
import { workdayAdapter } from "./workday.js";

// Registered in priority order: most specific detector first. The dispatcher
// picks the first match; generic-html matches everything so it MUST stay last.
export const ADAPTERS: Adapter[] = [
  inspiraAdapter,
  idealistAdapter,
  oracleHcmAdapter,
  reliefwebAdapter,
  workdayAdapter,
  greenhouseAdapter,
  leverAdapter,
  smartrecruitersAdapter,
  successfactorsAdapter,
  wordpressAdapter,
  genericHtmlAdapter,
];

export {
  genericHtmlAdapter,
  greenhouseAdapter,
  idealistAdapter,
  inspiraAdapter,
  leverAdapter,
  oracleHcmAdapter,
  reliefwebAdapter,
  smartrecruitersAdapter,
  successfactorsAdapter,
  wordpressAdapter,
  workdayAdapter,
};

export type { Adapter, AdapterConfig, AdapterOpts } from "./types.js";
export { isInternship, isEthiopiaAccessible } from "./types.js";
