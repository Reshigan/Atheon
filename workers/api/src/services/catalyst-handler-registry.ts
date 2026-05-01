/**
 * Catalyst Handler Registry
 *
 * Extension point for domain-specific catalyst action handlers. Replaces the
 * previous keyword-sniff dispatch in catalyst-engine.ts::performAction.
 *
 * Handlers registered via registerHandler (domain plugins) are tried first.
 * Handlers registered via registerDefaultHandler (built-in generic handlers)
 * are tried last. Within each group, insertion order wins.
 *
 * The last default handler registered MUST always match (catch-all) — if no
 * handler matches, dispatchAction throws.
 */

import type { TaskDefinition } from './catalyst-engine';
import { loadProcessContextForTenant } from './erp-process-profile';

export type CatalystHandler = {
  /** Human-readable name for logging and observability. */
  name: string;
  /** Return true if this handler can execute the task. */
  match: (task: TaskDefinition) => boolean;
  /** Execute the task and return the output payload. */
  execute: (task: TaskDefinition, db: D1Database) => Promise<Record<string, unknown>>;
};

const customHandlers: CatalystHandler[] = [];
const defaultHandlers: CatalystHandler[] = [];

/** Register a domain-specific handler. Tried before built-in defaults. */
export function registerHandler(handler: CatalystHandler): void {
  customHandlers.push(handler);
}

/** Register a built-in generic handler. Tried after custom handlers. */
export function registerDefaultHandler(handler: CatalystHandler): void {
  defaultHandlers.push(handler);
}

/**
 * Dispatch a task to the first handler whose match() returns true.
 *
 * The returned object is the handler's own output with two reserved fields
 * attached:
 *   `_handler`        — name of the handler that ran (observability;
 *                       callers persist this in audit_log + catalyst_actions
 *                       output_data for free tracing).
 *   `processContext`  — the customer's resolved process profile (matching
 *                       mode, tolerance %, payment terms days, default
 *                       currency, fiscal year start, etc.) plus per-field
 *                       evidence sources. Injected for ALL 470 sub-catalysts
 *                       in one place so insights are always auditable
 *                       under shared-savings billing — the customer can see
 *                       which rules drove every reported number. Handlers
 *                       that produce their own `processContext` (e.g. a
 *                       handler that needs to override with rules from a
 *                       specific connection) win — registry only injects
 *                       when the handler did not.
 *
 * Both keys are reserved; handlers should not collide with them.
 */
export async function dispatchAction(
  task: TaskDefinition,
  db: D1Database,
): Promise<Record<string, unknown>> {
  for (const h of customHandlers) {
    if (h.match(task)) {
      const output = await h.execute(task, db);
      return await annotateOutput(output, h.name, task, db);
    }
  }
  for (const h of defaultHandlers) {
    if (h.match(task)) {
      const output = await h.execute(task, db);
      return await annotateOutput(output, h.name, task, db);
    }
  }
  throw new Error(`catalyst-engine: no handler matched action "${task.action}"`);
}

/** Wrap a handler's raw output with the reserved annotation fields. */
async function annotateOutput(
  output: Record<string, unknown>,
  handlerName: string,
  task: TaskDefinition,
  db: D1Database,
): Promise<Record<string, unknown>> {
  const annotated: Record<string, unknown> = { ...output, _handler: handlerName };
  // Only inject processContext when the handler didn't already supply one.
  if (annotated.processContext === undefined) {
    try {
      annotated.processContext = await loadProcessContextForTenant(db, task.tenantId);
    } catch { /* non-fatal — leave processContext undefined */ }
  }
  return annotated;
}

/** Test-only helpers. Do not use in production code. */
export function _resetRegistryForTests(): void {
  customHandlers.length = 0;
  defaultHandlers.length = 0;
}
export function _listHandlersForTests(): { custom: string[]; defaults: string[] } {
  return {
    custom: customHandlers.map(h => h.name),
    defaults: defaultHandlers.map(h => h.name),
  };
}
