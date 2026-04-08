import { useState } from 'react';
import { useHarnessStore } from '../../store';
import type { Enclosure, PCB, Connector, Pin } from '../../types';

function TagPill({ tag }: { tag: string }) {
  return (
    <span className="inline-block text-[9px] px-1 py-px rounded bg-zinc-700 text-zinc-400 max-w-[80px] truncate">
      {tag}
    </span>
  );
}

function PinRow({ pin }: { pin: Pin }) {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected = selectedItem?.type === 'pin' && selectedItem.id === pin.id;

  return (
    <div
      className={`pl-14 pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1.5 ${
        isSelected
          ? 'bg-amber-900/30 text-amber-200'
          : 'text-zinc-400 hover:bg-zinc-800'
      }`}
      onClick={() => selectItem({ type: 'pin', id: pin.id })}
    >
      <span className="text-zinc-600 font-mono text-[10px] w-4 text-right shrink-0">
        {pin.pin_number}
      </span>
      <span className="truncate">{pin.name}</span>
      <div className="ml-auto flex gap-0.5 shrink-0">
        {pin.tags.slice(0, 2).map((t) => (
          <TagPill key={t} tag={t} />
        ))}
      </div>
    </div>
  );
}

function ConnectorRow({ connector }: { connector: Connector }) {
  const [expanded, setExpanded] = useState(false);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected =
    selectedItem?.type === 'connector' && selectedItem.id === connector.id;

  return (
    <>
      <div
        className={`pl-10 pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${
          isSelected
            ? 'bg-amber-900/30 text-amber-200'
            : 'text-zinc-300 hover:bg-zinc-800'
        }`}
        onClick={() => selectItem({ type: 'connector', id: connector.id })}
      >
        <button
          className="text-zinc-600 hover:text-zinc-400 text-[9px] w-3 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <span className="font-medium">{connector.name}</span>
        <span className="text-zinc-500 text-[10px]">
          ({connector.pins.length}p)
        </span>
        <div className="ml-auto flex gap-0.5 shrink-0">
          {connector.tags.slice(0, 2).map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </div>
      </div>
      {expanded &&
        connector.pins.map((pin) => <PinRow key={pin.id} pin={pin} />)}
    </>
  );
}

function PCBRow({ pcb, connectors }: { pcb: PCB; connectors: Connector[] }) {
  const [expanded, setExpanded] = useState(true);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected =
    selectedItem?.type === 'pcb' && selectedItem.id === pcb.id;

  return (
    <>
      <div
        className={`pl-5 pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${
          isSelected
            ? 'bg-amber-900/30 text-amber-200'
            : 'text-teal-300 hover:bg-zinc-800'
        }`}
        onClick={() => selectItem({ type: 'pcb', id: pcb.id })}
      >
        <button
          className="text-zinc-600 hover:text-zinc-400 text-[9px] w-3 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <svg className="w-3 h-3 text-teal-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <circle cx="8" cy="12" r="1.5" />
          <circle cx="16" cy="12" r="1.5" />
        </svg>
        <span className="font-medium">{pcb.name}</span>
        <div className="ml-auto flex gap-0.5 shrink-0">
          {pcb.tags.slice(0, 2).map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </div>
      </div>
      {expanded &&
        connectors.map((c) => <ConnectorRow key={c.id} connector={c} />)}
    </>
  );
}

function EnclosureRow({
  enclosure,
  pcbs,
  connectors,
}: {
  enclosure: Enclosure;
  pcbs: PCB[];
  connectors: Connector[];
}) {
  const [expanded, setExpanded] = useState(true);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected =
    selectedItem?.type === 'enclosure' && selectedItem.id === enclosure.id;

  const directConnectors = connectors.filter(
    (c) => c.parent === enclosure.id,
  );
  const childPcbs = pcbs.filter((p) => p.parent === enclosure.id);

  return (
    <>
      <div
        className={`pr-2 py-1 text-xs cursor-pointer flex items-center gap-1 ${
          isSelected
            ? 'bg-amber-900/30 text-amber-200'
            : 'text-zinc-200 hover:bg-zinc-800'
        }`}
        onClick={() =>
          selectItem({ type: 'enclosure', id: enclosure.id })
        }
      >
        <button
          className="text-zinc-600 hover:text-zinc-400 text-[9px] w-4 pl-1 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
        </svg>
        <span className="font-medium">{enclosure.name}</span>
        <div className="ml-auto flex gap-0.5 shrink-0">
          {enclosure.tags.slice(0, 2).map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </div>
      </div>
      {expanded && (
        <>
          {childPcbs.map((pcb) => (
            <PCBRow
              key={pcb.id}
              pcb={pcb}
              connectors={connectors.filter((c) => c.parent === pcb.id)}
            />
          ))}
          {directConnectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} />
          ))}
        </>
      )}
    </>
  );
}

export function TreeView() {
  const harness = useHarnessStore((s) => s.harness);

  if (!harness) return null;

  return (
    <div className="py-1 select-none">
      <div className="px-2 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
        Hierarchy
      </div>
      {harness.enclosures.map((enc) => (
        <EnclosureRow
          key={enc.id}
          enclosure={enc}
          pcbs={harness.pcbs}
          connectors={harness.connectors}
        />
      ))}
    </div>
  );
}
