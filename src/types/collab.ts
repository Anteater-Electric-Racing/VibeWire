import type {
  AppView,
  BackgroundLayouts,
  CanvasImageLayouts,
  ConnectorLibrary,
  ConnectorTypeSizes,
  EditingSurface,
  FreePortLayouts,
  SystemData,
  SharedAnchorLayouts,
  ManufacturingDocument,
  BranchPointLayouts,
  NodeLayout,
  PortLayouts,
  RotationLayouts,
  RouteStyleLayouts,
  SizeLayouts,
  SubsystemDocument,
  TextBoxLayouts,
  ViewRouteStyleLayouts,
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
  | 'branchPoint'
  | 'path'
  | 'signal'
  | 'harnessBundle'
  | 'connectorType'
  | 'subsystem'
  | 'textBox'
  | 'image';

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
  system: string;
  appView: AppView;
  editingSurface: EditingSurface;
  openEnclosureId: string | null;
  activeSubsystemId: string | null;
  focus: PresenceTarget | null;
  editing: PresenceTarget | null;
  lastSeen: number;
}

export type PresenceUpdate = Partial<Pick<
  PeerPresence,
  | 'appView'
  | 'editingSurface'
  | 'openEnclosureId'
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
  kind: 'system' | 'library' | 'rebase';
  server: RevisionConflictResponse | {
    error: string;
    currentRev: number;
    lastWriter: RevisionWriter | null;
    changedEntityIds: string[];
  };
  localDiffJson: string;
}

export interface AttributionEntry {
  by: RevisionWriter;
  at: string;
  rev: number;
}

export interface CollaborationLayouts {
  nodes: NodeLayout;
  ports: PortLayouts;
  sizes: SizeLayouts;
  free: FreePortLayouts;
  backgrounds: BackgroundLayouts;
  images: CanvasImageLayouts;
  connectorTypeSizes: ConnectorTypeSizes;
  textBoxes: TextBoxLayouts;
  waypoints: WaypointLayouts;
  sharedAnchors: SharedAnchorLayouts;
  branchPoints: BranchPointLayouts;
  rotations: RotationLayouts;
  routeStyles: RouteStyleLayouts;
  viewRouteStyles: ViewRouteStyleLayouts;
}

type FlatLayoutKey = Exclude<keyof CollaborationLayouts, 'branchPoints'>;

export type LayoutRemovedKeys = Partial<Record<FlatLayoutKey, string[]>> & {
  branchPoints?: string[] | Record<string, string[]>;
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
  system?: SystemData;
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
  system: SystemData;
  layouts: Partial<CollaborationLayouts>;
  manufacturing: ManufacturingDocument;
  subsystems: SubsystemDocument[] | Record<string, SubsystemDocument>;
  attribution: Record<string, AttributionEntry>;
  lastWriter: RevisionWriter | null;
}

export type RevisionKind =
  | 'system'
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
