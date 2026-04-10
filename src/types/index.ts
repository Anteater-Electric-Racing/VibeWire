export interface Pin {
  id: string;
  pin_number: number;
  name: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface Connector {
  id: string;
  name: string;
  parent: string | null;
  connector_type: string;
  tags: string[];
  pins: Pin[];
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

export interface Wire {
  id: string;
  from: string;
  to: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface Signal {
  id: string;
  name: string;
  tags: string[];
  properties: Record<string, string>;
}

export interface HarnessData {
  schema_version: string;
  enclosures: Enclosure[];
  connectors: Connector[];
  wires: Wire[];
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

export type EntityType = 'enclosure' | 'connector' | 'pin' | 'wire' | 'signal';

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
