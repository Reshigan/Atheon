import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Clean LLM text that may contain raw JSON or markdown code fences.
 * The backend strips code fences before JSON.parse, but if parsing fails
 * the raw text (possibly still with fences or raw JSON) reaches the frontend.
 * This helper extracts readable text from such responses.
 */
export function cleanLlmText(text: string | undefined | null): string {
  if (!text) return '';
  let cleaned = text.trim();

  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // If the cleaned text looks like a JSON object, try to extract the summary/text field
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    try {
      const parsed = JSON.parse(cleaned);
      // Try common LLM response fields in priority order
      const summaryField = parsed.executiveSummary || parsed.summary || parsed.insights
        || parsed.narrative || parsed.text || parsed.content || parsed.response;
      if (typeof summaryField === 'string') return summaryField;
      // If no string field found, format the object nicely
      return formatJsonAsText(parsed);
    } catch {
      // Not valid JSON, return as-is
    }
  }

  return cleaned;
}

/**
 * Format a parsed JSON object into readable text sections.
 * Used when AI Insights returns structured data that should be displayed as text.
 */
export function formatJsonAsText(obj: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    // Skip metadata fields
    if (['generatedAt', 'poweredBy', 'domain', 'traceability'].includes(key)) continue;

    const label = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();

    if (typeof value === 'string') {
      parts.push(`${label}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (typeof value[0] === 'string') {
        parts.push(`${label}:\n${value.map(v => `  • ${v}`).join('\n')}`);
      } else if (typeof value[0] === 'object') {
        const items = value.map(item => {
          const vals = Object.values(item as Record<string, unknown>).filter(v => typeof v === 'string');
          return `  • ${vals.join(' — ')}`;
        });
        parts.push(`${label}:\n${items.join('\n')}`);
      }
    } else if (typeof value === 'number') {
      parts.push(`${label}: ${value}`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Format a duration into a human-readable string.
 *
 * Accepts seconds (default) or milliseconds, and chooses a sensible unit:
 *   < 60s        → "45s"
 *   < 60m        → "12m"
 *   < 24h        → "3h 15m"
 *   < 30 days    → "4d 6h"
 *   ≥ 30 days    → "2mo"
 *
 * Returns "—" for null / undefined / NaN / non-finite values. This prevents
 * the platform from rendering bare `Infinity`, `NaN`, or `undefined` as
 * user-visible text — which is what was happening on Process Mining (the
 * backend stores `avg_duration` in seconds but the UI labeled it "days",
 * and several callers reached into step objects whose duration field was
 * never populated → `undefined` rendered as text).
 */
export function formatDuration(
  value: number | null | undefined,
  unit: 'seconds' | 'milliseconds' = 'seconds',
): string {
  if (value == null || !Number.isFinite(value) || value < 0) return '—';
  const seconds = unit === 'milliseconds' ? value / 1000 : value;
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days < 30) return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;

  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/**
 * Safely divide; returns 0 (or `fallback`) when the divisor is 0 / undefined
 * / NaN, so callers don't ship `Infinity` or `NaN` into the UI.
 */
export function safeDivide(
  num: number | null | undefined,
  den: number | null | undefined,
  fallback = 0,
): number {
  if (num == null || den == null || !Number.isFinite(num) || !Number.isFinite(den) || den === 0) return fallback;
  const r = num / den;
  return Number.isFinite(r) ? r : fallback;
}
