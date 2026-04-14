export interface Connector {
  id: string;
  name: string;
  parent: string | null;
  connector_type: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface Enclosure {
  id: string;
  name: string;
  parent: string | null;
  container: boolean;
  tags: string[];
  properties: Record<string, string>;
}

export interface MergePoint {
  id: string;
  name: string;
  parent: string | null;
  tags: string[];
  properties: Record<string, string>;
}

export interface Signal {
  id: string;
  name: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface ConnectorPathNode {
  kind: 'connector';
  connector_id: string;
  pin_number: number;
}

export interface MergePointPathNode {
  kind: 'merge';
  merge_point_id: string;
}

export type PathNode = ConnectorPathNode | MergePointPathNode;

export interface ConnectorPathNodeRef {
  kind: 'connector';
  connector_id: string;
  pin_number: number;
}

export interface MergePointPathNodeRef {
  kind: 'merge';
  merge_point_id: string;
}

export type PathNodeRef = ConnectorPathNodeRef | MergePointPathNodeRef;

export interface PathMeasurement {
  from: PathNodeRef;
  to: PathNodeRef;
  length_mm?: number;
  note?: string;
}

export interface Path {
  id: string;
  name: string;
  tags: string[];
  properties: Record<string, string>;
  nodes: PathNode[];
  measurements: PathMeasurement[];
}

export interface HarnessData {
  schema_version: string;
  enclosures: Enclosure[];
  connectors: Connector[];
  mergePoints: MergePoint[];
  paths: Path[];
  signals: Signal[];
}

export interface ConnectorType {
  id: string;
  name: string;
  pin_count: number;
  crimp_spec: string;
  wire_gauge: string;
  notes: string;
  image?: string;
  side_image?: string;
}

export interface ConnectorLibrary {
  connector_types: ConnectorType[];
}

export type EntityType = 'enclosure' | 'connector' | 'mergePoint' | 'path' | 'signal';

export interface SelectedItem {
  type: EntityType;
  id: string;
}

export interface TagFilter {
  namespace: string;
  values: Set<string>;
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

export interface MergePointPosition {
  x: number;
  y: number;
}

export interface MergePointLayouts {
  [contextKey: string]: {
    [mergePointId: string]: MergePointPosition;
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
}

export interface TextBoxLayouts {
  [id: string]: TextBoxLayout;
}

export type WaypointItem = { x: number; y: number } | { junctionId: string };

export interface WaypointLayouts {
  [edgeId: string]: WaypointItem[];
}

export interface JunctionLayout {
  id: string;
  x: number;
  y: number;
  memberEdgeIds: string[];
}

export interface JunctionLayouts {
  [id: string]: JunctionLayout;
}

export interface ConnectorOccupancy {
  pinNumber: number;
  pathId: string;
  pathName: string;
  signalName: string | null;
  tags: string[];
}

export interface DerivedSegment {
  id: string;
  pathId: string;
  pathName: string;
  segmentIndex: number;
  from: PathNode;
  to: PathNode;
  tags: string[];
  properties: Record<string, string>;
}

export interface DerivedBundle {
  id: string;
  segmentIds: string[];
  pathIds: string[];
  sourceRefKey: string;
  targetRefKey: string;
}
