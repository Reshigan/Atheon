/**
 * Competitor Strategy Classifier — Phase 10-8.
 *
 * Pure deterministic mapping from a news/press headline to one of a
 * fixed set of strategy categories that drive Apex/RCA narratives.
 * No LLM, no API call — runs on raw text in O(n) regex evaluations.
 *
 * The categories were chosen because each implies a *measurable
 * downstream effect* on a customer's KPIs:
 *
 *   pricing          → revenue / margin pressure
 *   product_launch   → revenue / market-share movement
 *   market_expansion → distribution / share-of-shelf threat
 *   hiring           → talent-market signal (key-person hires =
 *                      capability shift)
 *   funding_or_ma    → balance-sheet shift; competitor capacity grows
 *   partnership      → distribution channel realignment
 *   trouble          → opportunity for the customer (lawsuits,
 *                      losses, downgrades) — adverse for the
 *                      competitor, often tailwind for the customer
 *   general          → default bucket — still ingested, just no
 *                      strategic-class signal
 *
 * Each rule is a regex (case-insensitive) on the headline. Severity
 * defaults to 'info'; specific categories that materially threaten
 * the customer (pricing, market expansion) get 'warning'; high-impact
 * events (M&A, new entrant) get 'critical'.
 *
 * Why deterministic over LLM-classification:
 *  - Runs on every cron tick on every competitor with zero token cost
 *  - Stable: same headline always classifies the same way (auditable)
 *  - Cheap to extend: add a regex, ship a PR
 *  - The diagnostics-engine-v2 LLM still gets the raw radar_signals
 *    rows for richer narration; this layer just gives downstream
 *    consumers a category to filter/group on
 */

export type StrategyCategory =
  | 'pricing'
  | 'product_launch'
  | 'market_expansion'
  | 'hiring'
  | 'funding_or_ma'
  | 'partnership'
  | 'trouble'
  | 'general';

export type StrategySeverity = 'info' | 'warning' | 'critical';

export interface StrategyClassification {
  category: StrategyCategory;
  severity: StrategySeverity;
  /** Which keyword(s) matched — useful for explaining the classification
   *  in Apex narratives. */
  matched: string[];
}

interface Rule {
  category: StrategyCategory;
  severity: StrategySeverity;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    category: 'pricing',
    severity: 'warning',
    patterns: [
      /\bcuts?\s+(?:the\s+)?prices?\b/i,
      /\bdiscount\b/i,
      /\bprice\s+(?:cut|reduction|drop|war)\b/i,
      /\bslash(?:es|ed)?\s+prices?\b/i,
      /\blower(?:s|ed)?\s+(?:its\s+)?(?:fees?|prices?|tariffs?|rates?)\b/i,
      /\bfee\s+(?:cut|reduction|waiver)\b/i,
      /\bpromo(?:tion)?\s+(?:campaign|launch)\b/i,
      /\bzero[- ]?fee\b/i,
    ],
  },
  {
    category: 'product_launch',
    severity: 'warning',
    patterns: [
      /\b(?:launch(?:es|ed)?|unveils?|introduces?|debuts?|rolls?\s+out|releases?)\b.*\b(?:product|service|app|platform|feature|version|model)\b/i,
      /\bnew\s+(?:product|service|app|platform|feature|model|edition)\b/i,
      /\bgoes\s+live\b/i,
    ],
  },
  {
    category: 'market_expansion',
    severity: 'critical',
    patterns: [
      /\bopens?\s+(?:its\s+)?(?:first\s+)?(?:store|branch|office|warehouse|hub)\b/i,
      /\benters?\s+(?:the\s+)?(?:market|sector|industry)\b/i,
      /\bexpand(?:s|ed|ing)?\s+(?:into|to)\b/i,
      /\bnew\s+(?:store|branch|location|outlet|hub)\b/i,
      /\bgeographic(?:al)?\s+expansion\b/i,
    ],
  },
  {
    category: 'funding_or_ma',
    severity: 'critical',
    patterns: [
      /\bacquir(?:es|ed|ing|ition)\b/i,
      /\bmerger\b|\bmerges?\s+with\b/i,
      /\b(?:raises?|raised)\s+\$?\d/i,
      /\bseries\s+[a-z]\s+(?:funding|round)\b/i,
      /\bipo\b/i,
      /\bgoes?\s+public\b/i,
      /\bbuyout\b|\btakeover\b/i,
    ],
  },
  {
    category: 'partnership',
    severity: 'info',
    patterns: [
      /\bpartner(?:s|ship|ed|ing)?\s+with\b/i,
      /\bsigns?\s+(?:a\s+)?(?:deal|agreement|mou|contract)\b/i,
      /\bjoint\s+venture\b/i,
      /\bstrategic\s+alliance\b/i,
    ],
  },
  {
    category: 'hiring',
    severity: 'info',
    patterns: [
      /\bappoint(?:s|ed|ing|ment)?\b/i,
      /\bnames?\s+(?:new\s+)?(?:ceo|cto|cfo|coo|chair(?:man|person)?|president)\b/i,
      /\b(?:hires?|hired|hiring)\s+(?:as\s+)?(?:ceo|cto|cfo|coo|head\s+of)\b/i,
      /\bjoins?\s+as\s+(?:ceo|cto|cfo|coo|chair)/i,
      /\bsteps?\s+down\b|\bresigns?\b/i,
    ],
  },
  {
    category: 'trouble',
    severity: 'info', // adverse for competitor often = tailwind for customer
    patterns: [
      /\blawsuit\b|\bsued?\b|\blitigation\b/i,
      /\bbankruptc(?:y|ies)\b|\binsolven(?:t|cy)\b|\bliquidation\b/i,
      /\bfine[ds]?\b.{0,40}\b(?:million|billion|regulator|fined)\b/i,
      /\bdowngrade[ds]?\b|\bcredit\s+downgrade\b/i,
      /\bprofit\s+warning\b|\bmissed\s+(?:earnings|estimates|targets)\b/i,
      /\brecall(?:s|ed)?\b/i,
      /\bdata\s+breach\b|\bhacked?\b/i,
      /\binvestigat(?:ion|ed|ing)\b.{0,30}\b(?:regulator|sec|cma|comp(?:etition)?\s+commission)\b/i,
    ],
  },
];

/** Decode a few common HTML entities that show up in Google News RSS titles. */
export function decodeBasicEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/** Classify a headline. Returns the FIRST matching category by rule order
 *  (rules are ordered most-specific-first). Falls through to 'general'
 *  with severity 'info' when nothing matches. */
export function classifyStrategy(headline: string): StrategyClassification {
  const text = decodeBasicEntities(headline);
  const matched: string[] = [];
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const m = text.match(pattern);
      if (m) {
        matched.push(m[0]);
        return { category: rule.category, severity: rule.severity, matched };
      }
    }
  }
  return { category: 'general', severity: 'info', matched: [] };
}
