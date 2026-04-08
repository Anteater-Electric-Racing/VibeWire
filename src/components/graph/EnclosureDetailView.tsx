import { useRef, useState, useEffect } from 'react';
import { useHarnessStore } from '../../store';
import type { PortEdge, PortPosition, ConnectorType } from '../../types';
import type { Connector } from '../../types';
import { getSignalFromTags, getSignalColor } from '../../lib/colors';
import {
  getEnclosureWires,
  isBulkhead,
} from '../../lib/harness';
import { ImagePickerPanel } from './ImagePickerPanel';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PADDING = 70;  // Must be > tab half-width so tabs don't go negative
const HEADER_H = 44;
const FREE_PORT_W = 50;
const FREE_PORT_H = 22;

function getPortAbsPos(
  parentRect: Rect,
  portPos: PortPosition,
): { x: number; y: number } {
  switch (portPos.edge) {
    case 'left':
      return { x: parentRect.x, y: parentRect.y + portPos.ratio * parentRect.h };
    case 'right':
      return { x: parentRect.x + parentRect.w, y: parentRect.y + portPos.ratio * parentRect.h };
    case 'top':
      return { x: parentRect.x + portPos.ratio * parentRect.w, y: parentRect.y };
    case 'bottom':
      return { x: parentRect.x + portPos.ratio * parentRect.w, y: parentRect.y + parentRect.h };
  }
}

function nearestEdge(pos: { x: number; y: number }, r: Rect): PortEdge {
  const dl = pos.x - r.x;
  const dr = r.x + r.w - pos.x;
  const dt = pos.y - r.y;
  const db = r.y + r.h - pos.y;
  const m = Math.min(dl, dr, dt, db);
  if (m === dt) return 'top';
  if (m === db) return 'bottom';
  if (m === dl) return 'left';
  return 'right';
}

function getControlOffset(edge: PortEdge, dist: number) {
  switch (edge) {
    case 'left':   return { dx: -dist, dy: 0 };
    case 'right':  return { dx: dist,  dy: 0 };
    case 'top':    return { dx: 0, dy: -dist };
    case 'bottom': return { dx: 0, dy:  dist };
  }
}

function makeWirePath(
  fromPos: { x: number; y: number }, fromEdge: PortEdge,
  toPos: { x: number; y: number },   toEdge: PortEdge,
): string {
  const dist = 50;
  const c1 = getControlOffset(fromEdge, dist);
  const c2 = getControlOffset(toEdge, dist);
  return `M ${fromPos.x} ${fromPos.y} C ${fromPos.x + c1.dx} ${fromPos.y + c1.dy}, ${toPos.x + c2.dx} ${toPos.y + c2.dy}, ${toPos.x} ${toPos.y}`;
}

function makeStubPath(pos: { x: number; y: number }, edge: PortEdge, length = 25): string {
  const off = getControlOffset(edge, length);
  return `M ${pos.x} ${pos.y} L ${pos.x + off.dx} ${pos.y + off.dy}`;
}

function makeArrowHead(pos: { x: number; y: number }, edge: PortEdge, length = 25): string {
  const off = getControlOffset(edge, length);
  const tip = { x: pos.x + off.dx, y: pos.y + off.dy };
  const size = 5;
  if (edge === 'left' || edge === 'right') {
    return `M ${tip.x} ${tip.y} L ${tip.x - Math.sign(off.dx) * size} ${tip.y - size} M ${tip.x} ${tip.y} L ${tip.x - Math.sign(off.dx) * size} ${tip.y + size}`;
  }
  return `M ${tip.x} ${tip.y} L ${tip.x - size} ${tip.y - Math.sign(off.dy) * size} M ${tip.x} ${tip.y} L ${tip.x + size} ${tip.y - Math.sign(off.dy) * size}`;
}

const DEFAULT_BULKHEAD_W = 56, DEFAULT_BULKHEAD_H = 28;
const DEFAULT_HEADER_W = 54, DEFAULT_HEADER_H = 26;

function ConnectorTabInner({ name, signalColor, ct, isSelected }: {
  name: string; signalColor: string; ct?: ConnectorType; isSelected: boolean;
}) {
  const img = ct?.side_image || ct?.image;
  return (
    <>
      {img && (
        <img
          src={`/connector-lib-photos/${img}`}
          alt=""
          draggable={false}
          className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
          style={{ opacity: 0.75 }}
        />
      )}
      <span
        className={`relative z-10 truncate px-1 text-[9px] font-mono select-none leading-none ${isSelected ? 'text-amber-300' : 'text-zinc-200'}`}
        style={{ textShadow: '0 0 4px #000' }}
      >
        {name}
      </span>
    </>
  );
}

// Edge-snapped tab for bulkhead connectors on enclosure walls
function BulkheadTab({
  connectorId, name, portPos, parentRect, signalColor, ct, typeSize,
  onDragStart, onResizeStart, onClick, isSelected,
}: {
  connectorId: string; name: string; portPos: PortPosition; parentRect: Rect;
  signalColor: string; ct?: ConnectorType; typeSize: { w: number; h: number };
  onDragStart: (e: React.MouseEvent, id: string, parentRect: Rect) => void;
  onResizeStart: (e: React.MouseEvent, typeId: string, cur: { w: number; h: number }) => void;
  onClick: (id: string) => void; isSelected: boolean;
}) {
  const absPos = getPortAbsPos(parentRect, portPos);
  const tabW = typeSize.w, tabH = typeSize.h;
  const left = absPos.x - tabW / 2;
  const top  = absPos.y - tabH / 2;

  return (
    <div
      className={`absolute flex items-center justify-center overflow-hidden rounded select-none cursor-grab active:cursor-grabbing ${isSelected ? 'ring-1 ring-amber-400' : ''}`}
      style={{
        left, top, width: tabW, height: tabH, zIndex: 20,
        background: signalColor !== '#666' ? signalColor + '33' : '#2a2a2a',
        borderWidth: 2, borderStyle: 'solid',
        borderColor: signalColor !== '#666' ? signalColor : '#555',
      }}
      onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, connectorId, parentRect); }}
      onClick={(e) => { e.stopPropagation(); onClick(connectorId); }}
    >
      <ConnectorTabInner name={name} signalColor={signalColor} ct={ct} isSelected={isSelected} />
      {ct && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 hover:opacity-60 bg-white/20"
          onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, ct.id, { w: tabW, h: tabH }); }}
        />
      )}
    </div>
  );
}

// Free-floating badge for header connectors on PCB face
function FreePortBadge({
  connectorId, name, freePos, pcbRect, signalColor, ct, typeSize,
  onDragStart, onResizeStart, onClick, isSelected,
}: {
  connectorId: string; name: string;
  freePos: { x: number; y: number }; pcbRect: Rect;
  signalColor: string; ct?: ConnectorType; typeSize: { w: number; h: number };
  onDragStart: (e: React.MouseEvent, id: string) => void;
  onResizeStart: (e: React.MouseEvent, typeId: string, cur: { w: number; h: number }) => void;
  onClick: (id: string) => void; isSelected: boolean;
}) {
  const tabW = typeSize.w, tabH = typeSize.h;
  const left = pcbRect.x + freePos.x - tabW / 2;
  const top  = pcbRect.y + freePos.y - tabH / 2;

  return (
    <div
      className={`absolute flex items-center justify-center overflow-hidden rounded select-none cursor-grab active:cursor-grabbing ${isSelected ? 'ring-1 ring-amber-400' : ''}`}
      style={{
        left, top, width: tabW, height: tabH, zIndex: 30,
        background: signalColor !== '#666' ? signalColor + '44' : '#0d2222',
        border: `2px solid ${signalColor !== '#666' ? signalColor : '#2dd4bf'}`,
      }}
      onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, connectorId); }}
      onClick={(e) => { e.stopPropagation(); onClick(connectorId); }}
    >
      <ConnectorTabInner name={name} signalColor={signalColor} ct={ct} isSelected={isSelected} />
      {ct && (
        <div
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 hover:opacity-60 bg-white/20"
          onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, ct.id, { w: tabW, h: tabH }); }}
        />
      )}
    </div>
  );
}

export function EnclosureDetailView({ enclosureId }: { enclosureId: string }) {
  const harness           = useHarnessStore((s) => s.harness);
  const nodeLayouts       = useHarnessStore((s) => s.nodeLayouts);
  const sizeLayouts       = useHarnessStore((s) => s.sizeLayouts);
  const portLayouts       = useHarnessStore((s) => s.portLayouts);
  const freePortLayouts   = useHarnessStore((s) => s.freePortLayouts);
  const updateNodePosition   = useHarnessStore((s) => s.updateNodePosition);
  const updateNodeSize       = useHarnessStore((s) => s.updateNodeSize);
  const updatePortLayout     = useHarnessStore((s) => s.updatePortLayout);
  const updateFreePortLayout = useHarnessStore((s) => s.updateFreePortLayout);
  const selectItem   = useHarnessStore((s) => s.selectItem);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const findPinOwner = useHarnessStore((s) => s.findPinOwner);

  const backgroundLayouts = useHarnessStore((s) => s.backgroundLayouts);
  const updateBackground  = useHarnessStore((s) => s.updateBackground);
  const removeBackground  = useHarnessStore((s) => s.removeBackground);
  const connectorLibrary  = useHarnessStore((s) => s.connectorLibrary);
  const connectorTypeSizes = useHarnessStore((s) => s.connectorTypeSizes);
  const updateConnectorTypeSize = useHarnessStore((s) => s.updateConnectorTypeSize);

  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize]   = useState({ w: 800, h: 600 });
  const [localBulkPos, setLocalBulkPos] = useState<Record<string, PortPosition>>({});
  const [localFreePos, setLocalFreePos] = useState<Record<string, { x: number; y: number }>>({});
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  const [pan, setPanState] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const setPan = (next: { x: number; y: number }) => {
    panRef.current = next;
    setPanState(next);
  };
  const [scale, setScaleState] = useState(1);
  const scaleRef = useRef(1);
  const setScale = (next: number) => {
    scaleRef.current = next;
    setScaleState(next);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setCanvasSize({ w: width, h: height });
    });
    observer.observe(el);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left; // cursor x relative to container
      const cy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const oldScale = scaleRef.current;
      const newScale = Math.max(0.15, Math.min(4, oldScale * factor));
      // Zoom toward cursor: adjust pan so the world point under cursor stays fixed
      const newPanX = cx - (cx - panRef.current.x) * (newScale / oldScale);
      const newPanY = cy - (cy - panRef.current.y) * (newScale / oldScale);
      setScale(newScale);
      setPan({ x: newPanX, y: newPanY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  if (!harness) return null;
  const enclosure = harness.enclosures.find((e) => e.id === enclosureId);
  if (!enclosure) return null;

  const pcbs = harness.pcbs.filter((p) => p.parent === enclosureId);
  const bulkheadCons = harness.connectors.filter((c) => c.parent === enclosureId);
  const headerConsByPcb: Record<string, Connector[]> = {};
  for (const pcb of pcbs) {
    headerConsByPcb[pcb.id] = harness.connectors.filter((c) => c.parent === pcb.id);
  }

  const encRect: Rect = {
    x: PADDING, y: PADDING,
    w: canvasSize.w - 2 * PADDING,
    h: canvasSize.h - 2 * PADDING,
  };

  const getBulkPos = (conId: string, index: number, total: number): PortPosition => {
    if (localBulkPos[conId]) return localBulkPos[conId];
    if (portLayouts[conId])  return portLayouts[conId];
    return { edge: 'left' as PortEdge, ratio: (index + 1) / (total + 1) };
  };

  const getFreePos = (conId: string, index: number, total: number, pcbRect: Rect): { x: number; y: number } => {
    if (localFreePos[conId])     return localFreePos[conId];
    if (freePortLayouts[conId])  return freePortLayouts[conId];
    // Default: distribute horizontally near top of PCB
    const cols = Math.ceil(Math.sqrt(total));
    const col  = index % cols;
    const row  = Math.floor(index / cols);
    return {
      x: (pcbRect.w / (cols + 1)) * (col + 1),
      y: 30 + row * 36,
    };
  };

  const getPcbRect = (pcbId: string, index: number): Rect => {
    const pos  = nodeLayouts[pcbId]  ?? { x: encRect.w * 0.3, y: 40 + index * 160 };
    const size = sizeLayouts[pcbId]  ?? { w: 200, h: 130 };
    return { x: encRect.x + pos.x, y: encRect.y + pos.y, w: size.w, h: size.h };
  };

  // Drag bulkhead tabs along enclosure walls
  const handleBulkDragStart = (e: React.MouseEvent, portId: string, parentRect: Rect) => {
    e.preventDefault();
    e.stopPropagation();
    const handleMove = (me: MouseEvent) => {
      const cx = containerRef.current?.getBoundingClientRect();
      const x = (me.clientX - (cx?.left ?? 0) - panRef.current.x) / scaleRef.current;
      const y = (me.clientY - (cx?.top  ?? 0) - panRef.current.y) / scaleRef.current;
      const relX = x - parentRect.x, relY = y - parentRect.y;
      const dl = relX, dr = parentRect.w - relX, dt = relY, db = parentRect.h - relY;
      const m = Math.min(dl, dr, dt, db);
      let edge: PortEdge, ratio: number;
      if (m === dt)      { edge = 'top';    ratio = Math.max(0.08, Math.min(0.92, relX / parentRect.w)); }
      else if (m === db) { edge = 'bottom'; ratio = Math.max(0.08, Math.min(0.92, relX / parentRect.w)); }
      else if (m === dl) { edge = 'left';   ratio = Math.max(0.08, Math.min(0.92, relY / parentRect.h)); }
      else               { edge = 'right';  ratio = Math.max(0.08, Math.min(0.92, relY / parentRect.h)); }
      setLocalBulkPos((p) => ({ ...p, [portId]: { edge, ratio } }));
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setLocalBulkPos((prev) => {
        const pos = prev[portId];
        if (pos) updatePortLayout(portId, pos);
        const next = { ...prev }; delete next[portId]; return next;
      });
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Drag free-floating header badges anywhere on the PCB face
  const handleFreeDragStart = (e: React.MouseEvent, conId: string, pcbRect: Rect) => {
    e.preventDefault();
    e.stopPropagation();
    const handleMove = (me: MouseEvent) => {
      const cx = containerRef.current?.getBoundingClientRect();
      const x = (me.clientX - (cx?.left ?? 0) - panRef.current.x) / scaleRef.current;
      const y = (me.clientY - (cx?.top  ?? 0) - panRef.current.y) / scaleRef.current;
      const relX = Math.max(FREE_PORT_W / 2, Math.min(pcbRect.w - FREE_PORT_W / 2, x - pcbRect.x));
      const relY = Math.max(FREE_PORT_H / 2, Math.min(pcbRect.h - FREE_PORT_H / 2, y - pcbRect.y));
      setLocalFreePos((p) => ({ ...p, [conId]: { x: relX, y: relY } }));
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setLocalFreePos((prev) => {
        const pos = prev[conId];
        if (pos) updateFreePortLayout(conId, pos.x, pos.y);
        const next = { ...prev }; delete next[conId]; return next;
      });
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleBgDragStart = (e: React.MouseEvent, bgKey: string, currentPos: { x: number; y: number }) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const handleMove = (me: MouseEvent) => {
      updateBackground(bgKey, { x: currentPos.x + me.clientX - startX, y: currentPos.y + me.clientY - startY });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleBgResizeStart = (e: React.MouseEvent, bgKey: string, currentSize: { w: number; h: number }) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const handleMove = (me: MouseEvent) => {
      updateBackground(bgKey, {
        w: Math.max(80, currentSize.w + me.clientX - startX),
        h: Math.max(60, currentSize.h + me.clientY - startY),
      });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handlePcbDragStart = (e: React.MouseEvent, pcbId: string, currentPos: { x: number; y: number }) => {
    e.stopPropagation(); e.preventDefault(); e.nativeEvent.stopImmediatePropagation();
    const startX = e.clientX, startY = e.clientY;
    const handleMove = (me: MouseEvent) => {
      const s = scaleRef.current;
      updateNodePosition(pcbId, currentPos.x + (me.clientX - startX) / s, currentPos.y + (me.clientY - startY) / s);
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handlePcbResize = (e: React.MouseEvent, pcbId: string, currentSize: { w: number; h: number }) => {
    e.stopPropagation(); e.preventDefault(); e.nativeEvent.stopImmediatePropagation();
    const startX = e.clientX, startY = e.clientY;
    const handleMove = (me: MouseEvent) => {
      const s = scaleRef.current;
      updateNodeSize(pcbId, Math.max(120, currentSize.w + (me.clientX - startX) / s), Math.max(80, currentSize.h + (me.clientY - startY) / s));
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Get connector type for a connector
  const getConnectorType = (con: Connector) =>
    connectorLibrary?.connector_types.find((t) => t.id === con.connector_type);

  // Get the display size for a connector's tab
  const getBulkheadSize = (con: Connector) =>
    connectorTypeSizes[con.connector_type] ?? { w: getConnectorType(con)?.side_image || getConnectorType(con)?.image ? 90 : DEFAULT_BULKHEAD_W, h: getConnectorType(con)?.side_image || getConnectorType(con)?.image ? 52 : DEFAULT_BULKHEAD_H };

  const getHeaderSize = (con: Connector) =>
    connectorTypeSizes[con.connector_type] ?? { w: getConnectorType(con)?.side_image || getConnectorType(con)?.image ? 80 : DEFAULT_HEADER_W, h: getConnectorType(con)?.side_image || getConnectorType(con)?.image ? 46 : DEFAULT_HEADER_H };

  // Resize a connector type tab by dragging the corner
  const handleConnectorTypeResizeStart = (e: React.MouseEvent, typeId: string, cur: { w: number; h: number }) => {
    e.stopPropagation(); e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const handleMove = (me: MouseEvent) => {
      const s = scaleRef.current;
      updateConnectorTypeSize(typeId, Math.max(36, cur.w + (me.clientX - startX) / s), Math.max(18, cur.h + (me.clientY - startY) / s));
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  // Pan handler — fires on empty-space mousedown; distinguishes click from drag
  const handleContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const startX = e.clientX, startY = e.clientY;
    const startPan = { ...panRef.current };
    let dragged = false;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX, dy = me.clientY - startY;
      if (!dragged && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) dragged = true;
      if (dragged) setPan({ x: startPan.x + dx, y: startPan.y + dy });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragged) selectItem(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Build port position map for wire drawing
  const portPositions = new Map<string, { pos: { x: number; y: number }; edge: PortEdge }>();

  bulkheadCons.forEach((con, i) => {
    const pp = getBulkPos(con.id, i, bulkheadCons.length);
    portPositions.set(con.id, { pos: getPortAbsPos(encRect, pp), edge: pp.edge });
  });

  pcbs.forEach((pcb, pi) => {
    const pcbRect = getPcbRect(pcb.id, pi);
    const headers = headerConsByPcb[pcb.id] ?? [];
    headers.forEach((con, hi) => {
      const fp = getFreePos(con.id, hi, headers.length, pcbRect);
      const absPos = { x: pcbRect.x + fp.x, y: pcbRect.y + fp.y };
      portPositions.set(con.id, { pos: absPos, edge: nearestEdge(absPos, pcbRect) });
    });
  });

  const getPortColor = (con: Connector): string => {
    const pinIds = new Set(con.pins.map((p) => p.id));
    const wires = harness.wires.filter((w) => pinIds.has(w.from) || pinIds.has(w.to));
    const sigs = new Set<string>();
    for (const w of wires) { const s = getSignalFromTags(w.tags); if (s) sigs.add(s); }
    if (sigs.size === 1) return getSignalColor([...sigs][0]);
    return '#666';
  };

  // Compute wire segments
  const { internal, external } = getEnclosureWires(harness, enclosureId, findPinOwner);

  const wireSegments: { key: string; path: string; color: string; wireId: string }[] = [];
  const stubSegments: { key: string; stubPath: string; arrowPath: string; color: string; wireId: string }[] = [];

  for (const wire of internal) {
    const fromCon = findPinOwner(wire.from);
    const toCon   = findPinOwner(wire.to);
    if (!fromCon || !toCon) continue;
    const fp = portPositions.get(fromCon.id);
    const tp = portPositions.get(toCon.id);
    if (!fp || !tp) continue;
    const sig = getSignalFromTags(wire.tags);
    wireSegments.push({
      key: wire.id,
      path: makeWirePath(fp.pos, fp.edge, tp.pos, tp.edge),
      color: sig ? getSignalColor(sig) : '#7c3aed',
      wireId: wire.id,
    });
  }

  for (const { wire, internalConId } of external) {
    const con = harness.connectors.find((c) => c.id === internalConId);
    if (!con) continue;
    const pp = portPositions.get(internalConId);
    if (!pp) continue;
    const sig = getSignalFromTags(wire.tags);
    const color = sig ? getSignalColor(sig) : '#7c3aed';
    if (isBulkhead(harness, con)) {
      stubSegments.push({ key: wire.id, stubPath: makeStubPath(pp.pos, pp.edge), arrowPath: makeArrowHead(pp.pos, pp.edge), color, wireId: wire.id });
    } else {
      const bhCon = bulkheadCons[0];
      if (bhCon) {
        const bhPP = portPositions.get(bhCon.id);
        if (bhPP) {
          wireSegments.push({ key: `${wire.id}_to_bh`, path: makeWirePath(pp.pos, pp.edge, bhPP.pos, bhPP.edge), color, wireId: wire.id });
          stubSegments.push({ key: wire.id, stubPath: makeStubPath(bhPP.pos, bhPP.edge), arrowPath: makeArrowHead(bhPP.pos, bhPP.edge), color, wireId: wire.id });
        }
      }
    }
  }

  return (
    <div className="w-full h-full bg-zinc-950 flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center px-3 gap-3 border-b border-zinc-800 shrink-0" style={{ height: HEADER_H }}>
        <button onClick={() => setDrillDown(null)} className="text-zinc-400 hover:text-zinc-200 text-sm font-medium">
          ← Back
        </button>
        <div className="text-[11px] text-zinc-500 flex-1">
          <button onClick={() => setDrillDown(null)} className="hover:text-zinc-300 transition-colors">
            All Enclosures
          </button>
          <span className="mx-1.5 text-zinc-600">›</span>
          <span className="text-zinc-300 font-medium">{enclosure.name}</span>
        </div>
        <div className="relative">
          <button
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors"
            onClick={() => setBgPickerOpen((p) => !p)}
          >
            <span>🖼</span>
            <span>Background</span>
          </button>
          {bgPickerOpen && (
            <ImagePickerPanel
              onPick={(filename) => {
                const bg = backgroundLayouts[enclosureId];
                updateBackground(enclosureId, {
                  image: filename,
                  x: bg?.x ?? encRect.x,
                  y: bg?.y ?? encRect.y,
                  w: bg?.w ?? encRect.w,
                  h: bg?.h ?? encRect.h,
                  locked: false,
                });
                setBgPickerOpen(false);
              }}
              onClose={() => setBgPickerOpen(false)}
            />
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden"
        onMouseDown={handleContainerMouseDown}
      >
        {/* Panned + scaled world — all content inside. Large fixed size so edges aren't clipped. */}
        <div style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: '0 0',
          position: 'absolute',
          width: 4000,
          height: 4000,
          top: 0,
          left: 0,
        }}>
        {/* Background image layer */}
        {(() => {
          const bg = backgroundLayouts[enclosureId];
          if (!bg?.image) return null;
          return (
            <div
              className="absolute group"
              style={{ left: bg.x, top: bg.y, width: bg.w, height: bg.h, zIndex: 0, opacity: bg.locked ? 1 : 0.85, cursor: bg.locked ? 'default' : 'grab' }}
              onMouseDown={!bg.locked ? (e) => handleBgDragStart(e, enclosureId, { x: bg.x, y: bg.y }) : undefined}
            >
              <img
                src={`/img-assets/${bg.image}`}
                alt="background"
                draggable={false}
                className="w-full h-full object-contain select-none pointer-events-none"
              />
              {/* Controls */}
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  title={bg.locked ? 'Unlock' : 'Lock position'}
                  className="text-[10px] bg-zinc-900/80 border border-zinc-600 text-zinc-300 hover:text-amber-400 rounded px-1.5 py-0.5 transition-colors"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); updateBackground(enclosureId, { locked: !bg.locked }); }}
                >
                  {bg.locked ? '🔓' : '🔒'}
                </button>
                <button
                  title="Remove background"
                  className="text-[10px] bg-zinc-900/80 border border-zinc-600 text-zinc-400 hover:text-red-400 rounded px-1.5 py-0.5 transition-colors"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); removeBackground(enclosureId); }}
                >
                  ✕
                </button>
              </div>
              {/* Resize handle (bottom-right corner) */}
              {!bg.locked && (
                <div
                  className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
                  onMouseDown={(e) => handleBgResizeStart(e, enclosureId, { w: bg.w, h: bg.h })}
                />
              )}
            </div>
          );
        })()}

        {/* Enclosure bounding rectangle */}
        <div
          className="absolute rounded border-2 border-dashed border-zinc-700"
          style={{ left: encRect.x, top: encRect.y, width: encRect.w, height: encRect.h, background: '#111', zIndex: 1, overflow: 'visible' }}
        >
          <div className="absolute -top-6 left-2 text-xs text-zinc-500 font-semibold uppercase tracking-wider">
            {enclosure.name}
          </div>
        </div>

        {/* PCBs */}
        {pcbs.map((pcb, pi) => {
          const pcbR        = getPcbRect(pcb.id, pi);
              const pcbLocalPos = nodeLayouts[pcb.id] ?? { x: encRect.w * 0.3, y: 40 + pi * 160 };
          const pcbLocalSize = sizeLayouts[pcb.id] ?? { w: 200, h: 130 };
          const isPcbSelected = selectedItem?.type === 'pcb' && selectedItem.id === pcb.id;
          const pcbImage = pcb.properties?.image;

          return (
            <div
              key={pcb.id}
              className={`absolute rounded border overflow-hidden ${isPcbSelected ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-teal-700'} cursor-move select-none`}
              style={{ left: pcbR.x, top: pcbR.y, width: pcbR.w, height: pcbR.h, background: '#0d2b2b', zIndex: 10 }}
              onMouseDown={(e) => handlePcbDragStart(e, pcb.id, pcbLocalPos)}
              onClick={(e) => { e.stopPropagation(); selectItem({ type: 'pcb', id: pcb.id }); }}
            >
              {pcbImage ? (
                <img
                  src={`/img-assets/${pcbImage}`}
                  alt={pcb.name}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  onLoad={(e) => {
                    if (sizeLayouts[pcb.id]) return;
                    const img = e.currentTarget;
                    const maxW = 300, maxH = 220;
                    const ar = img.naturalWidth / img.naturalHeight;
                    let w = img.naturalWidth, h = img.naturalHeight;
                    if (w > maxW) { w = maxW; h = w / ar; }
                    if (h > maxH) { h = maxH; w = h * ar; }
                    updateNodeSize(pcb.id, Math.round(w), Math.round(h));
                  }}
                />
              ) : null}
              <div className={`absolute top-0 left-0 right-0 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 ${pcbImage ? 'bg-zinc-900/70 text-teal-300' : 'text-teal-400'}`}>
                {pcb.name}
              </div>
              {/* Resize handle */}
              <div
                className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize hover:bg-teal-400/30 rounded-tl z-20"
                onMouseDown={(e) => handlePcbResize(e, pcb.id, pcbLocalSize)}
              />
            </div>
          );
        })}

        {/* Bulkhead port tabs (edge-snapped on enclosure walls) */}
        {bulkheadCons.map((con, i) => (
          <BulkheadTab
            key={con.id}
            connectorId={con.id}
            name={con.name}
            portPos={getBulkPos(con.id, i, bulkheadCons.length)}
            parentRect={encRect}
            signalColor={getPortColor(con)}
            ct={getConnectorType(con)}
            typeSize={getBulkheadSize(con)}
            onDragStart={handleBulkDragStart}
            onResizeStart={handleConnectorTypeResizeStart}
            onClick={(id) => selectItem({ type: 'connector', id })}
            isSelected={selectedItem?.type === 'connector' && selectedItem.id === con.id}
          />
        ))}

        {/* Header connector badges (free-floating on PCB face) */}
        {pcbs.map((pcb, pi) => {
          const pcbR    = getPcbRect(pcb.id, pi);
          const headers = headerConsByPcb[pcb.id] ?? [];
          return headers.map((con, hi) => (
            <FreePortBadge
              key={con.id}
              connectorId={con.id}
              name={con.name}
              freePos={getFreePos(con.id, hi, headers.length, pcbR)}
              pcbRect={pcbR}
              signalColor={getPortColor(con)}
              ct={getConnectorType(con)}
              typeSize={getHeaderSize(con)}
              onDragStart={(e, id) => handleFreeDragStart(e, id, pcbR)}
              onResizeStart={handleConnectorTypeResizeStart}
              onClick={(id) => selectItem({ type: 'connector', id })}
              isSelected={selectedItem?.type === 'connector' && selectedItem.id === con.id}
            />
          ));
        })}

        {/* Wire SVG overlay — z-index above PCBs (10) but below port badges (30) */}
        <svg
          className="absolute pointer-events-none"
          style={{ left: 0, top: 0, width: 4000, height: 4000, zIndex: 20, overflow: 'visible' }}
        >
          {wireSegments.map((seg) => (
            <g key={seg.key}>
              <path d={seg.path} fill="none" stroke={seg.color} strokeWidth={2}
                opacity={selectedItem?.type === 'wire' && selectedItem.id === seg.wireId ? 1 : 0.7}
                filter={selectedItem?.type === 'wire' && selectedItem.id === seg.wireId ? `drop-shadow(0 0 4px ${seg.color})` : undefined}
              />
              <path d={seg.path} fill="none" stroke="transparent" strokeWidth={12}
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => { e.stopPropagation(); selectItem({ type: 'wire', id: seg.wireId }); }}
              />
            </g>
          ))}
          {stubSegments.map((seg) => (
            <g key={seg.key}>
              <path d={seg.stubPath} fill="none" stroke={seg.color} strokeWidth={2} strokeDasharray="4 3" opacity={0.6} />
              <path d={seg.arrowPath} fill="none" stroke={seg.color} strokeWidth={2} opacity={0.6} />
              <path d={seg.stubPath} fill="none" stroke="transparent" strokeWidth={12}
                className="pointer-events-auto cursor-pointer"
                onClick={(e) => { e.stopPropagation(); selectItem({ type: 'wire', id: seg.wireId }); }}
              />
            </g>
          ))}
        </svg>
        </div> {/* end panned world */}
      </div>
    </div>
  );
}

