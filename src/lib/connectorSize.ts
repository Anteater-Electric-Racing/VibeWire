import type { Connector, ConnectorType } from '../types';
import { getEffectivePinCount } from './systemTopology';

/** Auto-expand shows at most this many pin rows; more pins scroll until the user resizes. */
export const MAX_AUTO_EXPAND_PINS = 12;
export const CONNECTOR_HEADER_HEIGHT = 36;
export const CONNECTOR_PIN_ROW_HEIGHT = 26;
export const AUTO_EXPANDED_CONNECTOR_WIDTH = 160;
/**
 * Graph stacking order (React Flow `zIndexMode="manual"`):
 * background image < enclosure < wire < connector/merge < text <
 * foreground image < selected image < selected wire <
 * expanded connector < pin-attached wire < selected pin-attached wire.
 * Collapsed wires stay under connector bodies (they emit from the node center).
 * Pin-expanded wires sit above the cavity table so they can land on pin rows.
 */
export const GRAPH_Z_BACKGROUND = -1000;
export const GRAPH_Z_ENCLOSURE = 0;
export const GRAPH_Z_WIRE = 2;
export const GRAPH_Z_CONNECTOR = 3;
export const GRAPH_Z_MERGE = 3;
export const GRAPH_Z_TEXT = 10;
export const GRAPH_Z_IMAGE_FOREGROUND = 12;
export const GRAPH_Z_SELECTED_IMAGE = 25;
export const GRAPH_Z_SELECTED_WIRE = 1000;
/** Keep expanded cavity tables above other graph nodes (and their parents). */
export const EXPANDED_CONNECTOR_Z_INDEX = 2000;
export const GRAPH_Z_PIN_WIRE = EXPANDED_CONNECTOR_Z_INDEX + 1;
export const GRAPH_Z_SELECTED_PIN_WIRE = EXPANDED_CONNECTOR_Z_INDEX + 1000;

export function graphWireZIndex(selected: boolean, pinAttached: boolean): number {
  if (pinAttached) {
    return selected ? GRAPH_Z_SELECTED_PIN_WIRE : GRAPH_Z_PIN_WIRE;
  }
  return selected ? GRAPH_Z_SELECTED_WIRE : GRAPH_Z_WIRE;
}

type GraphNodeSize = {
  w: number;
  h: number;
};

/** Height/width that fits up to {@link MAX_AUTO_EXPAND_PINS} cavity rows. */
export function getAutoExpandedConnectorSize(pinCount: number): GraphNodeSize {
  const rows = Math.max(1, Math.min(Math.max(0, pinCount), MAX_AUTO_EXPAND_PINS));
  return {
    w: AUTO_EXPANDED_CONNECTOR_WIDTH,
    h: CONNECTOR_HEADER_HEIGHT + rows * CONNECTOR_PIN_ROW_HEIGHT,
  };
}

/** Pin rows shown in the expanded cavity table (type/instance capacity + used pins). */
export function getConnectorTablePinCount(
  connector: Pick<Connector, 'pin_count'>,
  type: Pick<ConnectorType, 'id' | 'pin_count' | 'cavity_variants'> | undefined | null,
  occupiedPinNumbers: readonly number[] = [],
): number {
  const used = occupiedPinNumbers.filter((pin) => Number.isInteger(pin) && pin > 0);
  return Math.max(
    getEffectivePinCount(connector, type),
    ...used,
    1,
  );
}

/**
 * Collapsed size is the persisted layout. Expanded uses an auto-fit (≤12 pins)
 * unless the user has manually resized during this expand session.
 */
export function resolveConnectorRenderedSize(
  collapsed: GraphNodeSize,
  expanded: boolean,
  pinCount: number,
  expandedOverride?: GraphNodeSize | null,
): GraphNodeSize {
  if (!expanded) return collapsed;
  if (expandedOverride) return expandedOverride;
  const fitted = getAutoExpandedConnectorSize(pinCount);
  return {
    w: Math.max(collapsed.w, fitted.w),
    h: Math.max(collapsed.h, fitted.h),
  };
}
