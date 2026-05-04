/**
 * Inference Feedback Routes — Phase 10-16.
 *
 * Closes the calibration loop opened by Phase 10-15. Customers can now
 * mark an Atheon inference (RCA, signal_impact attribution, metric
 * correlation) as correct or incorrect; the verdict feeds
 * inference_calibration as a user_feedback observation.
 *
 * Combined with the auto-tuning service (services/threshold-autotune.ts),
 * this means a tenant whose users repeatedly reject signal attributions
 * with |r| just above 0.6 will see the gate auto-tightened to 0.65 on
 * the next sweep — without engineering intervention.
 *
 * Routes:
 *   POST /api/v1/inferences/feedback
 *     Body: {
 *       inference_type: 'rca' | 'signal_impact' | 'metric_correlation',
 *       reference_id: string,           // RCA id, signal_impact id, etc.
 *       verdict: 'correct' | 'incorrect',
 *       notes?: string                   // optional free-text reason
 *     }
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  recordOutcome,
  type GateName,
  type CalibrationOutcome,
} from '../services/inference-calibration';

const feedback = new Hono<AppBindings>();

const VALID_INFERENCE_TYPES = new Set(['rca', 'signal_impact', 'metric_correlation']);
const VALID_VERDICTS = new Set(['correct', 'incorrect']);

interface FeedbackBody {
  inference_type: string;
  reference_id: string;
  verdict: string;
  notes?: string;
}

function gateForInference(type: string): GateName {
  switch (type) {
    case 'signal_impact': return 'signal_attribution.min_correlation';
    case 'metric_correlation': return 'metric_correlation.min_correlation';
    case 'rca':
    default: return 'cross_rca.min_causal_factors';
  }
}

feedback.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const tenantId = auth?.tenantId;
  const userId = auth?.userId;
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  let body: FeedbackBody;
  try {
    body = await c.req.json<FeedbackBody>();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  if (!body.inference_type || !VALID_INFERENCE_TYPES.has(body.inference_type)) {
    return c.json({ error: 'inference_type must be one of: rca, signal_impact, metric_correlation' }, 400);
  }
  if (!body.reference_id || typeof body.reference_id !== 'string') {
    return c.json({ error: 'reference_id required' }, 400);
  }
  if (!body.verdict || !VALID_VERDICTS.has(body.verdict)) {
    return c.json({ error: 'verdict must be: correct or incorrect' }, 400);
  }

  const outcome: CalibrationOutcome = body.verdict === 'correct' ? 'true_positive' : 'false_positive';
  const gate = gateForInference(body.inference_type);

  const ok = await recordOutcome({
    db: c.env.DB,
    tenantId,
    gate,
    outcome,
    source: 'user_feedback',
    context: {
      inference_type: body.inference_type,
      reference_id: body.reference_id,
      user_id: userId,
      notes: body.notes ?? null,
    },
  });

  return c.json({ recorded: ok, gate, outcome });
});

export default feedback;
