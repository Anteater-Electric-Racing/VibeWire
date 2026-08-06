import type {
  AppView,
  BackgroundLayouts,
  ConnectorLibrary,
  ConnectorTypeSizes,
  EditingSurface,
  FreePortLayouts,
  HarnessData,
  JunctionLayouts,
  ManufacturingDocument,
  MergePointLayouts,
  NodeLayout,
  PortLayouts,
  RotationLayouts,
  SizeLayouts,
  SubsystemDocument,
  TextBoxLayouts,
  WaypointLayouts,
} from './index';

export type UserRole = 'editor' | 'viewer';

export interface SessionUser {
  id: string;
  displayName: string;
  role: UserRole;
  /** Stable presence colour assigned by the server at account creation. */
  color: string;
}

/**
 * Login needs to distinguish "that name isn't recognised" from "you're locked
 * out for a minute" — collapsing them to a boolean leaves a rate-limited user
 * retrying a name that was correct all along.
 */
export type LoginOutcome =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'rateLimited' | 'unavailable' | 'error' };

export type CreateAccountOutcome =
  | { ok: true }
  | { ok: false; reason: 'taken' | 'rateLimited' | 'unavailable' | 'invalid' | 'error' };

export interface CollaborationSession {
  /** Who the session cookie says you are. Known on boot, before you can edit. */
  user: SessionUser | null;
  /**
   * Whether this browser session has been explicitly activated for editing.
   * A remembered cookie identifies you but never arms editing on its own —
   * you have to click "Continue as <name>" or press E. This is the accidental-edit guard.
   */
  editSessionActive: boolean;
  isEditor: boolean;
}

export type PresenceTargetKind =
  | 'enclosure'
  | 'connector'
  | 'mergePoint'
  | 'path'
  | 'signal'
  | 'bundle'
  | 'connectorType'
  | 'subsystem'
  | 'textBox';

export interface PresenceTarget {
  kind: PresenceTargetKind;
  id: string;
  field?: string;
}

export interface PeerPresence {
  sessionId: string;
  userId: string;
  displayName: string;
  color: string;
  harness: string;
  appView: AppView;
  editingSurface: EditingSurface;
  drillDownEnclosure: string | null;
  activeSubsystemId: string | null;
  focus: PresenceTarget | null;
  editing: PresenceTarget | null;
  lastSeen: number;
}

export type PresenceUpdate = Partial<Pick<
  PeerPresence,
  | 'appView'
  | 'editingSurface'
  | 'drillDownEnclosure'
  | 'activeSubsystemId'
  | 'focus'
  | 'editing'
>>;

export type SyncStatus = 'live' | 'polling' | 'offline';

export interface RevisionWriter {
  id: string;
  displayName: string;
}

export interface RevisionConflictResponse {
  error: 'conflict' | string;
  currentRev: number;
  baseRev: number;
  lastWriter: RevisionWriter | null;
  changedEntityIds: string[];
}

export interface SyncConflict {
  kind: 'harness' | 'library' | 'rebase';
  server: RevisionConflictResponse | {
    error: string;
    currentRev: number;
    lastWriter: RevisionWriter | null;
    changedEntityIds: string[];
  };
  localDiffJson: string;
}

export interface AttributionEntry {
  by: string;
  at: string;
  rev: number;
}

export interface CollaborationLayouts {
  nodes: NodeLayout;
  ports: PortLayouts;
  sizes: SizeLayouts;
  free: FreePortLayouts;
  backgrounds: BackgroundLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxes: TextBoxLayouts;
  waypoints: WaypointLayouts;
  junctions: JunctionLayouts;
  mergePoints: MergePointLayouts;
  rotations: RotationLayouts;
}

type FlatLayoutKey = Exclude<keyof CollaborationLayouts, 'mergePoints'>;

export type LayoutRemovedKeys = Partial<Record<FlatLayoutKey, string[]>> & {
  mergePoints?: string[] | Record<string, string[]>;
};

export interface LayoutPatch {
  patch: Partial<CollaborationLayouts>;
  removed: LayoutRemovedKeys;
}

export interface MapPatch<T> {
  patch: Record<string, T>;
  removed: string[];
}

export interface CollaborationDocumentState {
  harness?: HarnessData;
  connectorLibrary?: ConnectorLibrary;
  library?: ConnectorLibrary;
  layouts?: Partial<CollaborationLayouts> | LayoutPatch;
  manufacturing?: ManufacturingDocument | MapPatch<ManufacturingDocument['bundles'][string]>;
  subsystems?: SubsystemDocument[] | Record<string, SubsystemDocument> | MapPatch<SubsystemDocument>;
  attribution?: Record<string, AttributionEntry>;
  lastWriter?: RevisionWriter | null;
}

export interface CollaborationStateResponse extends CollaborationDocumentState {
  rev: number;
  libraryRev: number;
  harness: HarnessData;
  layouts: Partial<CollaborationLayouts>;
  manufacturing: ManufacturingDocument;
  subsystems: SubsystemDocument[] | Record<string, SubsystemDocument>;
  attribution: Record<string, AttributionEntry>;
  lastWriter: RevisionWriter | null;
}

export type RevisionKind =
  | 'harness'
  | 'layouts'
  | 'manufacturing'
  | 'subsystem'
  | 'library'
  | 'restore';

export interface RevisionEvent {
  rev: number;
  kind: RevisionKind;
  by: RevisionWriter | null;
  changedEntityIds: string[];
}

export interface SyncPayload extends CollaborationDocumentState {
  rev: number;
  libraryRev?: number;
  full: boolean;
  changed?: CollaborationDocumentState;
  kind?: RevisionKind;
  by?: RevisionWriter | null;
  changedEntityIds?: string[];
}

export interface UndoStaleness {
  state: 'green' | 'red' | 'none';
  lastWriter: RevisionWriter | null;
  since: number | null;
}
