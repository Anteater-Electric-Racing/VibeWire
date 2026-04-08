import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodesChange,
  type NodeChange,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useHarnessStore } from '../../store';
import { EnclosureNode } from './EnclosureNode';
import { BundleEdge } from './BundleEdge';
import { EnclosureDetailView } from './EnclosureDetailView';
import { BackgroundImageNode } from './BackgroundImageNode';
import { TextBoxNode } from './TextBoxNode';
import { ImagePickerPanel } from './ImagePickerPanel';
import { itemMatchesFilters } from '../../lib/tags';
import { getSignalColor, getSignalFromTags } from '../../lib/colors';
import {
  getConnectorEnclosure,
  isBulkhead,
  getEnclosureConnectors,
  getPortSignalColor,
} from '../../lib/harness';

const BG_NODE_ID = '__bg_image__';
const TB_NODE_PREFIX = '__tb_';

const nodeTypes = {
  enclosure: EnclosureNode,
  backgroundImage: BackgroundImageNode,
  textBox: TextBoxNode,
};
const edgeTypes = { bundle: BundleEdge };

function AddTextBoxButton() {
  const { screenToFlowPosition } = useReactFlow();
  const addTextBox = useHarnessStore((s) => s.addTextBox);

  const handleAdd = () => {
    const pos = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    addTextBox(pos.x - 110, pos.y - 55);
  };

  return (
    <button
      className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors"
      onClick={handleAdd}
      title="Add a floating text box"
    >
      <span className="font-bold text-[12px] leading-none">T</span>
      <span>Text Box</span>
    </button>
  );
}

const DEFAULT_ENC_POSITIONS: Record<string, { x: number; y: number }> = {
  enc_001: { x: 50, y: 80 },
  enc_002: { x: 380, y: 80 },
  enc_003: { x: 710, y: 80 },
};

export function GraphView() {
  const harness = useHarnessStore((s) => s.harness);
  const nodeLayouts = useHarnessStore((s) => s.nodeLayouts);
  const sizeLayouts = useHarnessStore((s) => s.sizeLayouts);
  const updateNodePosition = useHarnessStore((s) => s.updateNodePosition);
  const updateBackground = useHarnessStore((s) => s.updateBackground);
  const backgroundLayouts = useHarnessStore((s) => s.backgroundLayouts);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectedBundle = useHarnessStore((s) => s.selectedBundle);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const activeFilters = useHarnessStore((s) => s.activeFilters);
  const findPinOwner = useHarnessStore((s) => s.findPinOwner);
  const drillDownEnclosure = useHarnessStore((s) => s.drillDownEnclosure);
  const textBoxLayouts = useHarnessStore((s) => s.textBoxLayouts);
  const updateTextBox = useHarnessStore((s) => s.updateTextBox);
  const [pickerOpen, setPickerOpen] = useState(false);

  const { graphNodes, graphEdges } = useMemo(() => {
    if (!harness)
      return { graphNodes: [] as Node[], graphEdges: [] as Edge[] };

    // Build enclosure nodes
    const gNodes: Node[] = harness.enclosures.map((enc) => {
      const pos =
        nodeLayouts[enc.id] ??
        DEFAULT_ENC_POSITIONS[enc.id] ?? { x: 200, y: 200 };
      const size = sizeLayouts[enc.id] ?? { w: 220, h: 180 };

      const allConnectors = getEnclosureConnectors(harness, enc.id);
      const bulkheadCons = allConnectors.filter((c) =>
        isBulkhead(harness, c),
      );
      const headerCount = allConnectors.length - bulkheadCons.length;
      const pcbCount = harness.pcbs.filter((p) => p.parent === enc.id).length;

      // Count wires involving this enclosure
      let wireCount = 0;
      for (const wire of harness.wires) {
        const fromCon = findPinOwner(wire.from);
        const toCon = findPinOwner(wire.to);
        if (!fromCon || !toCon) continue;
        const fromEnc = getConnectorEnclosure(harness, fromCon.id);
        const toEnc = getConnectorEnclosure(harness, toCon.id);
        if (fromEnc === enc.id || toEnc === enc.id) wireCount++;
      }

      const matchesFilter = itemMatchesFilters(enc.tags, activeFilters);

      const ports = bulkheadCons.map((c) => ({
        id: c.id,
        name: c.name,
        signalColor: getPortSignalColor(harness, c),
      }));

      return {
        id: enc.id,
        type: 'enclosure',
        position: pos,
        style: { width: size.w, height: size.h },
        selected: selectedItem?.type === 'enclosure' && selectedItem.id === enc.id,
        data: {
          enclosureId: enc.id,
          label: enc.name,
          tags: enc.tags,
          bulkheadCount: bulkheadCons.length,
          headerCount,
          pcbCount,
          wireCount,
          ports,
          matchesFilter,
        },
      };
    });

    // Build bundled edges between enclosures
    const bundleMap = new Map<
      string,
      {
        wireIds: string[];
        sourceEncId: string;
        targetEncId: string;
        sourcePortId: string;
        targetPortId: string;
      }
    >();

    for (const wire of harness.wires) {
      const fromCon = findPinOwner(wire.from);
      const toCon = findPinOwner(wire.to);
      if (!fromCon || !toCon) continue;

      const fromEnc = getConnectorEnclosure(harness, fromCon.id);
      const toEnc = getConnectorEnclosure(harness, toCon.id);
      if (!fromEnc || !toEnc || fromEnc === toEnc) continue;

      const fromPortId = isBulkhead(harness, fromCon)
        ? fromCon.id
        : fromEnc;
      const toPortId = isBulkhead(harness, toCon) ? toCon.id : toEnc;

      // Normalize key direction
      let srcEnc = fromEnc;
      let tgtEnc = toEnc;
      let srcPort = fromPortId;
      let tgtPort = toPortId;
      if (srcEnc > tgtEnc || (srcEnc === tgtEnc && srcPort > tgtPort)) {
        [srcEnc, tgtEnc] = [tgtEnc, srcEnc];
        [srcPort, tgtPort] = [tgtPort, srcPort];
      }
      const key = `bundle_${srcPort}_${tgtPort}`;
      const existing = bundleMap.get(key);
      if (existing) {
        existing.wireIds.push(wire.id);
      } else {
        bundleMap.set(key, {
          wireIds: [wire.id],
          sourceEncId: srcEnc,
          targetEncId: tgtEnc,
          sourcePortId: srcPort,
          targetPortId: tgtPort,
        });
      }
    }

    const gEdges: Edge[] = [...bundleMap.entries()].map(([key, bundle]) => {
      const signals = new Set<string>();
      let matchesFilter = false;
      for (const wId of bundle.wireIds) {
        const w = harness.wires.find((wire) => wire.id === wId);
        if (!w) continue;
        const sig = getSignalFromTags(w.tags);
        if (sig) signals.add(sig);
        if (itemMatchesFilters(w.tags, activeFilters)) matchesFilter = true;
      }
      const signalColor =
        signals.size === 1
          ? getSignalColor([...signals][0])
          : '#666';

      const isSelected =
        selectedBundle &&
        bundle.wireIds.every((id) => selectedBundle.includes(id)) &&
        selectedBundle.every((id) => bundle.wireIds.includes(id));

      return {
        id: key,
        source: bundle.sourceEncId,
        target: bundle.targetEncId,
        sourceHandle: bundle.sourcePortId,
        targetHandle: bundle.targetPortId,
        type: 'bundle',
        selected: !!isSelected,
        data: {
          wireIds: bundle.wireIds,
          wireCount: bundle.wireIds.length,
          signalColor,
          matchesFilter,
        },
      };
    });

    // Prepend background image node if one is set (zIndex very low)
    const bg = backgroundLayouts['graph'];
    if (bg?.image) {
      gNodes.unshift({
        id: BG_NODE_ID,
        type: 'backgroundImage',
        position: { x: bg.x, y: bg.y },
        draggable: !bg.locked,
        selectable: !bg.locked,
        data: {
          imageUrl: `/img-assets/${bg.image}`,
          w: bg.w,
          h: bg.h,
          locked: bg.locked,
          contextKey: 'graph',
        },
        zIndex: -1000,
        style: { width: bg.w, height: bg.h },
      } as Node);
    }

    // Add text box nodes
    for (const tb of Object.values(textBoxLayouts)) {
      gNodes.push({
        id: `${TB_NODE_PREFIX}${tb.id}`,
        type: 'textBox',
        position: { x: tb.x, y: tb.y },
        draggable: true,
        selectable: true,
        data: {
          tbId: tb.id,
          text: tb.text,
          bgColor: tb.bgColor,
          textColor: tb.textColor,
          fontSize: tb.fontSize,
          w: tb.w,
          h: tb.h,
        },
        style: { width: tb.w, height: tb.h },
        zIndex: 10,
      } as Node);
    }

    return { graphNodes: gNodes, graphEdges: gEdges };
  }, [harness, nodeLayouts, sizeLayouts, selectedItem, selectedBundle, activeFilters, findPinOwner, backgroundLayouts, textBoxLayouts]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(graphNodes);
  const [edges, setEdges] = useEdgesState(graphEdges);

  useEffect(() => {
    setNodes(graphNodes);
  }, [graphNodes, setNodes]);

  useEffect(() => {
    setEdges(graphEdges);
  }, [graphEdges, setEdges]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      for (const change of changes) {
        if (change.type === 'position' && change.position && !change.dragging) {
          if (change.id === BG_NODE_ID) {
            updateBackground('graph', { x: change.position.x, y: change.position.y });
          } else if (change.id.startsWith(TB_NODE_PREFIX)) {
            const tbId = change.id.slice(TB_NODE_PREFIX.length);
            updateTextBox(tbId, { x: change.position.x, y: change.position.y });
          } else {
            updateNodePosition(change.id, change.position.x, change.position.y);
          }
        }
      }
    },
    [onNodesChangeBase, updateNodePosition, updateBackground, updateTextBox],
  );

  const onPaneClick = useCallback(() => {
    selectItem(null);
  }, [selectItem]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id === BG_NODE_ID) return;
      if (node.id.startsWith(TB_NODE_PREFIX)) return;
      selectItem({ type: 'enclosure', id: node.id });
    },
    [selectItem],
  );

  if (drillDownEnclosure) {
    return <EnclosureDetailView enclosureId={drillDownEnclosure} />;
  }

  return (
    <div className="w-full h-full bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.2}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#333"
        />
        <Controls className="!bg-zinc-800 !border-zinc-600 !rounded !shadow-lg [&>button]:!bg-zinc-800 [&>button]:!border-zinc-600 [&>button]:!text-zinc-300 [&>button:hover]:!bg-zinc-700" />
        <Panel position="top-right">
          <div className="flex flex-col gap-1 items-end">
            <div className="relative">
              <button
                className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-zinc-800/90 border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded shadow transition-colors"
                onClick={() => setPickerOpen((p) => !p)}
                title="Set background image"
              >
                <span>🖼</span>
                <span>Background</span>
              </button>
              {pickerOpen && (
                <ImagePickerPanel
                  onPick={(filename) => {
                    const bg = backgroundLayouts['graph'];
                    updateBackground('graph', {
                      image: filename,
                      x: bg?.x ?? -400,
                      y: bg?.y ?? -300,
                      w: bg?.w ?? 900,
                      h: bg?.h ?? 600,
                      locked: false,
                    });
                  }}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
            <AddTextBoxButton />
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
