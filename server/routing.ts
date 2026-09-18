import { createHash } from 'node:crypto';
export {
  AUTO_BULKHEAD_REASON,
  BULKHEAD_DISPLAY_PROPERTY,
  BULKHEAD_DOT_DISPLAY,
  BULKHEAD_DOT_SIZE,
  DEFAULT_BULKHEAD_SIZE,
  ensureEnclosureBulkheadPlaceholders,
  isAutoBulkheadPlaceholder,
  isTerminalVisualDot,
  planBoundaryRoute as planSheetRoute,
  planEnclosureRoute,
  unmergeNonTerminalVisualDots,
  type BulkheadRepairOptions,
  type BulkheadRepairResult,
  type EnclosureRoutePlan as SheetRoutePlan,
} from '../src/lib/bulkheadRouting.js';

export function routeRequestToken(requestKey: string): string {
  return createHash('sha256').update(requestKey).digest('hex').slice(0, 12);
}
