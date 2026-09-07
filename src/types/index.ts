export interface Connector {
  id: string;
  name: string;
  parent: string | null;
  connector_type: string;
  /**
   * Physical placement. Bulkhead and inline are written explicitly.
   * Omitted `mounting` means endpoint.
   *
   * `bulkhead` is only valid when `parent` is an Enclosure. `inline` is a
   * free-hanging pass-through. Legacy files that omit the field are inferred
   * only during input normalization: a connector whose parent is an enclosure
   * becomes a bulkhead.
   */
  mounting?: 'inline' | 'bulkhead';
  /**
   * Selected cavity capacity. Family connectors persist one of their declared
   * housing sizes here; fixed types only use this as an optional override.
   * Occupancy is still derived from path nodes.
   */
  pin_count?: number;
  /** Optional mechanical key selected from the active family cavity variant. */
  keying?: string;
  tags: string[];
  /**
   * Free-form instance properties. `image` is the free-hanging connector
   * thumbnail shown on schematics when this connector is not a bulkhead.
   */
  properties: Record<string, string>;
  /**
   * True when this connector is not authored directly, but synthesized at
   * load time from a `SheetBoundaryPort` declared on a parent sheet (see
   * `server/sheets.ts`). Only meaningful for systems stored in the
   * per-enclosure "sheet" format. Edit the source wiring on the parent
   * sheet instead of this connector's identity fields.
   */
  derived?: boolean;
  /** The id of the `SheetBoundaryPort` this connector was derived from, when `derived` is true. */
  derived_from_port?: string;
}

interface HierarchyEntityBase {
  id: string;
  name: string;
  parent: string | null;
  tags: string[];
  properties: Record<string, string>;
}

/** Leaf equipment. Owns connectors and has no internal sheet. */
export interface Device extends HierarchyEntityBase {
  kind: 'device';
}

/**
 * Equipment with an internal sheet. Conceptually a device that can contain
 * Devices or Enclosures. Remains named Enclosure.
 */
export interface Enclosure extends HierarchyEntityBase {
  kind: 'enclosure';
}

export type HierarchyEntity = Device | Enclosure;

export interface BranchPoint {
  id: string;
  name: string;
  parent: string | null;
  tags: string[];
  properties: Record<string, string>;
  /** See `Connector.derived` — the same sheet-derivation mechanism applies to branch points. */
  derived?: boolean;
  /** The id of the `SheetBoundaryPort` this branch point was derived from, when `derived` is true. */
  derived_from_port?: string;
}

export interface Signal {
  id: string;
  name: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface SignalPropertyDefinition {
  /** Stable schema identity; the property key may be renamed independently. */
  id: string;
  /** Key used in each signal's `properties` record. */
  key: string;
  /** Human-readable field label. */
  name: string;
  type: 'select';
  options: string[];
}

export interface ConnectorPathNode {
  kind: 'connector';
  connector_id: string;
  pin_number: number;
}

export interface BranchPointPathNode {
  kind: 'branch';
  branch_point_id: string;
}

export type PathNode = ConnectorPathNode | BranchPointPathNode;

export interface ConnectorPathNodeRef {
  kind: 'connector';
  connector_id: string;
  pin_number: number;
}

export interface BranchPointPathNodeRef {
  kind: 'branch';
  branch_point_id: string;
}

export type PathNodeRef = ConnectorPathNodeRef | BranchPointPathNodeRef;

export interface PathMeasurement {
  from: PathNodeRef;
  to: PathNodeRef;
  length_mm?: number;
  note?: string;
}

export interface Path {
  id: string;
  name: string;
  /** Stable signal catalog reference. Legacy `signal:*` tags remain readable. */
  signal_id?: string;
  tags: string[];
  properties: Record<string, string>;
  nodes: PathNode[];
  measurements: PathMeasurement[];
}

/** Complete loaded design. */
export interface SystemData {
  schema_version: string;
  /** Mutable system display name. The system storage key/filename is separate and stable. */
  name?: string;
  hierarchy: HierarchyEntity[];
  connectors: Connector[];
  branchPoints: BranchPoint[];
  paths: Path[];
  signals: Signal[];
  signalPropertyDefinitions: SignalPropertyDefinition[];
}

export interface ConnectorCavityVariant {
  /** Physical housing capacity. Family connectors move between these values. */
  pin_count: number;
  /** Housing part number for this exact cavity count. */
  housing_part_number?: string;
  /** Gender-specific housings, when the family uses different mating shells. */
  male_housing_part_number?: string;
  female_housing_part_number?: string;
  /** Keys offered for this exact cavity count. Omitted when keying is not applicable. */
  keyings?: string[];
  /** Pin-reading guide for this cavity count (inspector / manufacturing only). */
  image?: string;
  /** Gender-specific pin-reading guides. Fall back to `image`. */
  male_image?: string;
  female_image?: string;
  /** Bulkhead side view for this cavity count (schematic when wall-mounted on an enclosure). */
  side_image?: string;
  /** Gender-specific bulkhead side views. Fall back to `side_image`. */
  male_side_image?: string;
  female_side_image?: string;
}

export interface ConnectorType {
  id: string;
  name: string;
  /**
   * Fixed types use this capacity directly. Family types set it to 0 and
   * declare their supported physical housings in `cavity_variants`.
   */
  pin_count: number;
  crimp_spec: string;
  /** Male contact/crimp shared by every housing size in this family. */
  male_crimp_part_number?: string;
  /** Female contact/crimp shared by every housing size in this family. */
  female_crimp_part_number?: string;
  wire_gauge: string;
  notes: string;
  /** Supported housings when this entry represents a connector family. */
  cavity_variants?: ConnectorCavityVariant[];
  /**
   * Default/fallback media for fixed types or family variants without media.
   * `image` = pin guide (inspector / manufacturing). `side_image` = bulkhead side view on boxes.
   */
  image?: string;
  male_image?: string;
  female_image?: string;
  side_image?: string;
  male_side_image?: string;
  female_side_image?: string;
  /**
   * Properties copied onto a connector instance when this type is selected.
   * Existing instance values win and later default edits are not retroactive.
   */
  default_properties?: Record<string, string>;
}

export interface ConnectorLibrary {
  schema_version?: string;
  connector_types: ConnectorType[];
}

export type EntityType = 'enclosure' | 'connector' | 'branchPoint' | 'path' | 'signal';

export interface SelectedItem {
  type: EntityType;
  id: string;
}

/** Selected bend / waypoint on a Harness Bundle. `index` is into that edge's stored waypoints. */
export interface SelectedRoutePoint {
  index: number;
}

/** Canvas Harness Bundle edge selection — `id` is the graph Harness Bundle edge id. */
export interface SelectedHarnessBundle {
  id: string;
  pathIds: string[];
  /** When set, Delete/Backspace removes this bend instead of the whole Harness Bundle. */
  routePoint?: SelectedRoutePoint;
}

export interface NodeLayout {
  [nodeId: string]: { x: number; y: number };
}

export interface PortPosition {
  x: number;
  y: number;
}

export interface PortLayouts {
  [connectorId: string]: PortPosition;
}

export interface SizeLayouts {
  [nodeId: string]: { w: number; h: number };
}

export interface FreePortLayouts {
  [connectorId: string]: { x: number; y: number };
}

export interface BranchPointPosition {
  x: number;
  y: number;
}

export interface BranchPointLayouts {
  [contextKey: string]: {
    [branchPointId: string]: BranchPointPosition;
  };
}

export interface BackgroundLayout {
  image: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
}

export interface BackgroundLayouts {
  [contextKey: string]: BackgroundLayout;
}

export type CanvasImageLayer = 'background' | 'foreground';

export interface CanvasImageLayout {
  id: string;
  contextKey: string;
  image: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  locked: boolean;
  layer: CanvasImageLayer;
}

export interface CanvasImageLayouts {
  [id: string]: CanvasImageLayout;
}

export interface ConnectorTypeSizes {
  [typeId: string]: { w: number; h: number };
}

export type TextBoxFontFamily = 'sans' | 'serif' | 'mono';
export type TextBoxFontWeight = 'normal' | 'bold';
export type TextBoxTextAlign = 'left' | 'center' | 'right';

export interface TextBoxLayout {
  id: string;
  contextKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  bgColor: string;
  textColor: string;
  fontSize: number;
  fontFamily: TextBoxFontFamily;
  fontWeight: TextBoxFontWeight;
  textAlign: TextBoxTextAlign;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  opacity: number;
  padding: number;
  /** When true, font size is computed to fill the box. Legacy boxes omit this. */
  autoFit?: boolean;
  /** Enclosure/device this box is attached to. Positions are parent-relative. */
  parentId?: string;
}

export interface TextBoxLayouts {
  [id: string]: TextBoxLayout;
}

export type WaypointItem = { x: number; y: number } | { sharedAnchorId: string };

export interface WaypointLayouts {
  [edgeId: string]: WaypointItem[];
}

/** How a Path Harness Bundle is drawn on the schematic. */
export type WireRouteStyle = 'grid' | 'straight';

/** Per-edge routing style. Missing keys inherit the current view default. */
export interface RouteStyleLayouts {
  [edgeId: string]: WireRouteStyle;
}

/**
 * View-wide routing default. Keys are `system` or `subsystem:<id>`.
 * New wires in that view inherit this until given a per-edge override.
 */
export interface ViewRouteStyleLayouts {
  [viewKey: string]: WireRouteStyle;
}

export interface SharedAnchorLayout {
  id: string;
  x: number;
  y: number;
  memberEdgeIds: string[];
  /** Set only when this join is a Branch Point; omitted means visual Shared Anchor. */
  branchPointId?: string;
}

export interface SharedAnchorLayouts {
  [id: string]: SharedAnchorLayout;
}

export interface RotationLayouts {
  [connectorId: string]: number;
}

export interface ConnectorOccupancy {
  pinNumber: number;
  pathId: string;
  pathName: string;
  signalName: string | null;
  tags: string[];
}

/** One conductor between adjacent termination points on a Path. */
export interface Wire {
  id: string;
  pathId: string;
  pathName: string;
  wireIndex: number;
  from: PathNode;
  to: PathNode;
  tags: string[];
  properties: Record<string, string>;
  /**
   * Far-side neighbor(s) when this wire meets a branch point. Distinct through-routes
   * that share a branch approach (A→branch→B vs A→branch→C) get different keys.
   */
  throughKey?: string;
}

export interface HarnessBundle {
  id: string;
  wireIds: string[];
  pathIds: string[];
  sourceRefKey: string;
  targetRefKey: string;
}

export type ManufacturingStep =
  | 'ordered'
  | 'cut'
  | 'crimped'
  | 'populated'
  | 'qc'
  | 'installed';

export interface ManufacturingWorkAttribution {
  user_id: string;
  user_name: string;
  /** Calendar day is intentionally the finest manufacturing reporting granularity. */
  day: string;
}

export type ManufacturingWorkKind =
  | 'wire-cut'
  | 'wire-end'
  | 'branch-measured'
  | 'connector-guide'
  | 'component-step';

export interface ManufacturingWorkEvent extends ManufacturingWorkAttribution {
  id: string;
  task_key: string;
  kind: ManufacturingWorkKind;
  action: 'complete' | 'reopen';
  /** Optional state for multi-stage tasks such as a connector guide review. */
  state?: string;
  quantity?: number;
  unit?: 'ea' | 'mm';
}

export interface ManufacturingWireProgress {
  cut?: boolean;
  ends?: Partial<Record<'from' | 'to', boolean>>;
}

export type ManufacturingConnectorGuideState = 'checking' | 'verified';

export type ManufacturingTaskUpdate =
  | {
      kind: 'wire-cut';
      wireId: string;
      completed: boolean;
      lengthMm?: number;
    }
  | {
      kind: 'wire-end';
      wireId: string;
      end: 'from' | 'to';
      connectorId?: string;
      completed: boolean;
    }
  | {
      kind: 'branch-measured';
      branchPointId: string;
      completed: boolean;
    }
  | {
      kind: 'connector-guide';
      connectorId: string;
      state: ManufacturingConnectorGuideState | undefined;
    };

export interface ManufacturingBundleProgress {
  /** Legacy whole-harness progress. Used as a fallback for pre-component data. */
  steps: Partial<Record<ManufacturingStep, boolean>>;
  /** Build progress for each connector end or branch point within this harness run. */
  component_steps?: Record<string, Partial<Record<ManufacturingStep, boolean>>>;
  /** Contact gender for every wire ending at a connector in this Harness Bundle. */
  endpoint_genders?: Record<string, 'male' | 'female'>;
  /** Visual workbench progress, kept at wire granularity. */
  wire_progress?: Record<string, ManufacturingWireProgress>;
  /** A branch point is measured once even when several wires meet there. */
  branch_measured?: Record<string, boolean>;
  /** Two-stage pin-guide review: checking (yellow) then verified (green). */
  connector_guide_states?: Record<string, ManufacturingConnectorGuideState>;
  /** Current ownership of completed visual tasks, used for progress metrics. */
  task_attribution?: Record<string, ManufacturingWorkAttribution>;
  /** Append-only, day-granular operator activity for this physical harness run. */
  work_log?: ManufacturingWorkEvent[];
  notes?: string;
}

export interface ManufacturingDocument {
  schema_version: '1.1.0' | '1.2.0';
  bundles: Record<string, ManufacturingBundleProgress>;
}

export type EditingSurface = 'hierarchy' | 'subsystem';
export type AppView = 'canvas' | 'connectorLibrary' | 'signalLibrary' | 'manufacturing';
export type ManufacturingTab = 'cutlists' | 'progress' | 'bom';

export interface SubsystemEntityLayout {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

export interface SubsystemDocument {
  schema_version: '1.0.0';
  id: string;
  name: string;
  tags: string[];
  /** Enclosure frames are both membership and subsystem-specific geometry. */
  enclosures: Record<string, SubsystemEntityLayout>;
  /** Devices are hierarchy entities with `kind: 'device'`. */
  devices: Record<string, SubsystemEntityLayout>;
  /** Directly placed connectors; omitted when their owning device is present. */
  connectors: Record<string, SubsystemEntityLayout>;
  /** Connector instances hidden while their owning device remains represented. */
  hidden_connectors?: string[];
  /** `selected` means the device shell only exposes explicitly placed connectors. */
  device_connector_mode?: Record<string, 'all' | 'selected'>;
  /** Architecture-summary mode: route represented links between owning equipment cards. */
  collapse_connectors?: boolean;
  viewport?: { x: number; y: number; zoom: number };
}
