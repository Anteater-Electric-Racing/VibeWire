import { createContext, useContext, type MouseEvent } from 'react';
import type { SelectedHarnessBundle } from '../../types';

export type CanvasPlacementMode = 'none' | 'route-point' | 'inline-connector';

export type CanvasPlacementApi = {
  mode: CanvasPlacementMode;
  /** Return true if the click was consumed (placed an item). */
  handleFlowClick: (event: MouseEvent, clickedBundle?: SelectedHarnessBundle) => boolean;
};

export const CanvasPlacementContext = createContext<CanvasPlacementApi>({
  mode: 'none',
  handleFlowClick: () => false,
});

export function useCanvasPlacement(): CanvasPlacementApi {
  return useContext(CanvasPlacementContext);
}
