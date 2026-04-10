import { useState } from 'react';
import { useHarnessStore } from '../../store';
import type { Enclosure, Connector, Pin } from '../../types';

function TagPill({ tag }: { tag: string }) {
  return (
    <span className="inline-block text-[9px] px-1 py-px rounded bg-zinc-700 text-zinc-400 max-w-[80px] truncate">
      {tag}
    </span>
  );
}

function PinRow({ pin, depth }: { pin: Pin; depth: number }) {
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected = selectedItem?.type === 'pin' && selectedItem.id === pin.id;

  return (
    <div
      className={`pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1.5 ${
        isSelected
          ? 'bg-amber-900/30 text-amber-200'
          : 'text-zinc-400 hover:bg-zinc-800'
      }`}
      style={{ paddingLeft: (depth + 1) * 16 + 8 }}
      onClick={() => selectItem({ type: 'pin', id: pin.id })}
    >
      <span className="text-zinc-600 font-mono text-[10px] w-4 text-right shrink-0">
        {pin.pin_number}
      </span>
      <span className="truncate">{pin.name}</span>
      <div className="ml-auto flex gap-0.5 shrink-0">
        {(pin.tags ?? []).slice(0, 2).map((t) => (
          <TagPill key={t} tag={t} />
        ))}
      </div>
    </div>
  );
}

function ConnectorRow({ connector, depth }: { connector: Connector; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const isSelected =
    selectedItem?.type === 'connector' && selectedItem.id === connector.id;

  return (
    <>
      <div
        className={`pr-2 py-0.5 text-[11px] cursor-pointer flex items-center gap-1 ${
          isSelected
            ? 'bg-amber-900/30 text-amber-200'
            : 'text-zinc-300 hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: depth * 16 + 8 }}
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
          {(connector.tags ?? []).slice(0, 2).map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </div>
      </div>
      {expanded &&
        connector.pins.map((pin) => <PinRow key={pin.id} pin={pin} depth={depth + 1} />)}
    </>
  );
}

function EnclosureRow({
  enclosure,
  allEnclosures,
  allConnectors,
  depth = 0,
}: {
  enclosure: Enclosure;
  allEnclosures: Enclosure[];
  allConnectors: Connector[];
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const selectedItem = useHarnessStore((s) => s.selectedItem);
  const selectItem = useHarnessStore((s) => s.selectItem);
  const setDrillDown = useHarnessStore((s) => s.setDrillDown);
  const isSelected =
    selectedItem?.type === 'enclosure' && selectedItem.id === enclosure.id;

  const childEnclosures = allEnclosures.filter(
    (e) => e.parent === enclosure.id,
  );
  const directConnectors = allConnectors.filter(
    (c) => c.parent === enclosure.id,
  );

  const isContainer = enclosure.container;

  const icon = isContainer ? (
    <svg className="w-3.5 h-3.5 text-zinc-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-teal-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
    </svg>
  );

  return (
    <>
      <div
        className={`pr-2 py-1 text-xs cursor-pointer flex items-center gap-1 ${
          isSelected
            ? 'bg-amber-900/30 text-amber-200'
            : isContainer
            ? 'text-zinc-200 hover:bg-zinc-800'
            : 'text-teal-300 hover:bg-zinc-800'
        }`}
        style={{ paddingLeft: depth * 16 + 4 }}
        onClick={() =>
          selectItem({ type: 'enclosure', id: enclosure.id })
        }
        onDoubleClick={() => {
          if (isContainer) setDrillDown(enclosure.id);
        }}
      >
        <button
          className="text-zinc-600 hover:text-zinc-400 text-[9px] w-4 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? '▼' : '▶'}
        </button>
        {icon}
        <span className="font-medium">{enclosure.name}</span>
        <div className="ml-auto flex gap-0.5 shrink-0">
          {(enclosure.tags ?? []).slice(0, 2).map((t) => (
            <TagPill key={t} tag={t} />
          ))}
        </div>
      </div>
      {expanded && (
        <>
          {childEnclosures.map((child) => (
            <EnclosureRow
              key={child.id}
              enclosure={child}
              allEnclosures={allEnclosures}
              allConnectors={allConnectors}
              depth={depth + 1}
            />
          ))}
          {directConnectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} depth={depth + 2} />
          ))}
        </>
      )}
    </>
  );
}

export function TreeView() {
  const harness = useHarnessStore((s) => s.harness);

  if (!harness) return null;

  const rootEnclosures = harness.enclosures.filter((e) => e.parent === null);
  const rootConnectors = harness.connectors.filter((c) => c.parent === null);

  return (
    <div className="py-1 select-none">
      {rootEnclosures.map((enc) => (
        <EnclosureRow
          key={enc.id}
          enclosure={enc}
          allEnclosures={harness.enclosures}
          allConnectors={harness.connectors}
        />
      ))}
      {rootConnectors.length > 0 && (
        <>
          <div className="px-2 py-1 text-[10px] text-zinc-500 font-medium uppercase tracking-wider border-t border-zinc-800 mt-1">
            Free Connectors
          </div>
          {rootConnectors.map((c) => (
            <ConnectorRow key={c.id} connector={c} depth={0} />
          ))}
        </>
      )}
    </div>
  );
}
