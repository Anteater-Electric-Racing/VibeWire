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
  parent: string;
  connector_type: string;
  tags: string[];
  pins: Pin[];
  properties: Record<string, string>;
}

export interface Enclosure {
  id: string;
  name: string;
  parent: string | null;
  tags: string[];
  properties: Record<string, string>;
}

export interface PCB {
  id: string;
  name: string;
  parent: string;
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
  pcbs: PCB[];
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

export type EntityType = 'enclosure' | 'pcb' | 'connector' | 'pin' | 'wire' | 'signal';

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

export type PortEdge = 'top' | 'right' | 'bottom' | 'left';

export interface PortPosition {
  edge: PortEdge;
  ratio: number;
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
}

export interface TextBoxLayouts {
  [id: string]: TextBoxLayout;
}
