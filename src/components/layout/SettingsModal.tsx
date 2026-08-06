import type { ReactNode } from 'react';
import { useHarnessStore } from '../../store';
import { ModalShell } from '../collab/ModalShell';

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.4rem] items-center justify-center rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-center font-mono text-[10px] leading-none text-zinc-200 shadow-sm">
      {children}
    </kbd>
  );
}

function Shortcut({ keys, children }: { keys: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-xs text-zinc-300">{children}</span>
      <span className="flex shrink-0 items-center gap-1 pt-0.5">{keys}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h3>
      <div className="divide-y divide-zinc-800/70 rounded border border-zinc-800 bg-zinc-950/40 px-3">
        {children}
      </div>
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return <li className="py-1.5 text-xs text-zinc-300">{children}</li>;
}

export function SettingsModal() {
  const isOpen = useHarnessStore((s) => s.settingsOpen);
  const setOpen = useHarnessStore((s) => s.setSettingsOpen);

  if (!isOpen) return null;

  return (
    <ModalShell title="Settings" onClose={() => setOpen(false)} widthClassName="w-[540px]">
      <Section title="Views & navigation">
        <Shortcut keys={<><Kbd>1</Kbd><Kbd>2</Kbd><Kbd>3</Kbd><Kbd>4</Kbd><Kbd>5</Kbd></>}>
          Jump to System / Subsystem / Manufacturing / Connectors / Signals
        </Shortcut>
        <Shortcut keys={<Kbd>2</Kbd>}>
          Pressed again while already on Subsystem — opens the subsystem picker
        </Shortcut>
        <Shortcut keys={<Kbd>3</Kbd>}>
          Pressed again while already on Manufacturing — opens the harness / Build·Progress·BOM picker
        </Shortcut>
        <Shortcut keys={<><Kbd>1</Kbd><span className="text-zinc-600">–</span><Kbd>9</Kbd></>}>
          While a subsystem or manufacturing picker is open — jumps straight to that numbered item
        </Shortcut>
        <Shortcut keys={<Kbd>`</Kbd>}>
          Step the selection up one level (connector → its enclosure → out of the sheet); also closes the inspector
        </Shortcut>
        <Shortcut keys={<Kbd>Esc</Kbd>}>
          Deselect, or close the current panel / drill-down
        </Shortcut>
      </Section>

      <Section title="Editing">
        <Shortcut keys={<><Kbd>⌘</Kbd><Kbd>Z</Kbd></>}>
          Undo (Ctrl+Z on Windows/Linux)
        </Shortcut>
        <Shortcut keys={<><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>Z</Kbd></>}>
          Redo (also ⌘Y / Ctrl+Y)
        </Shortcut>
        <Shortcut keys={<Kbd>R</Kbd>}>
          Rotate the selected connector or enclosure 90°
        </Shortcut>
        <Shortcut keys={<Kbd>Delete</Kbd>}>
          Delete the selection (Backspace also works) — always asks first and shows the cascade impact
        </Shortcut>
      </Section>

      <Section title="Canvas tricks">
        <ul className="divide-y divide-transparent">
          <Tip>Double-click a device or enclosure to drill into it.</Tip>
          <Tip>Double-click a wire bundle to add a bend point. Drag a bend point close to another wire to fuse them into a junction/splice.</Tip>
          <Tip>Drag a cavity pin handle onto another cavity to reorder it, or onto another connector to route a wire there.</Tip>
          <Tip>In a subsystem, drag one connector on top of another to pair them as a bulkhead pass-through.</Tip>
          <Tip>Double-click or right-click a pin&apos;s signal tag to jump straight to that signal.</Tip>
          <Tip>Toggle <span className="text-zinc-100">Lasso</span> (top-right of the canvas) to drag-select multiple items instead of panning.</Tip>
          <Tip>With a wire bundle selected, use <span className="text-zinc-100">+ Route points</span> to click free bend points onto empty canvas — press Esc when done.</Tip>
          <Tip>In the wire-color picker, Shift/Ctrl/Cmd-click two swatches to build a striped color like <span className="font-mono text-zinc-100">white/brown</span>.</Tip>
        </ul>
      </Section>

      <Section title="Manufacturing progress">
        <ul className="divide-y divide-transparent">
          <Tip>Double-click a pin, splice, or wire in the harness diagram to toggle it done.</Tip>
          <Tip>Shift-click or shift-drag across several items to invert all of them at once.</Tip>
        </ul>
      </Section>

      <Section title="Collaboration">
        <ul className="divide-y divide-transparent">
          <Tip><span className="text-zinc-100">Read only</span> appears for viewers — they can look around but can&apos;t change data.</Tip>
          <Tip>
            Undo is <span className="text-zinc-100">per-person and time-ordered</span>, not a global history: it undoes
            your last change, not necessarily the most recent one overall. The status chip next to Undo turns red if
            someone else has edited since your last change, since undoing then risks crossing their work.
          </Tip>
          <Tip><span className="text-zinc-100">Checkpoints</span> save and restore full snapshots of the harness — VibeWire also takes one automatically before risky operations.</Tip>
          <Tip><span className="text-zinc-100">Activity</span> lists recent changes and who made them.</Tip>
          <Tip>Admins get a <span className="text-zinc-100">Manage users</span> icon in the top bar to add people and set roles.</Tip>
        </ul>
      </Section>

      <Section title="Good to know">
        <ul className="divide-y divide-transparent">
          <Tip>Renaming a system or subsystem only changes its display name — its stable storage ID never changes, so nothing referencing it breaks.</Tip>
          <Tip>Your pan/zoom position on each sheet, and the last manufacturing harness you viewed, are remembered per browser so you land back where you left off.</Tip>
          <Tip>Numbers next to items in the subsystem/manufacturing pickers are their keyboard shortcut (1–9).</Tip>
        </ul>
      </Section>

      <Section title="About">
        <Shortcut keys={<span className="text-xs text-zinc-300">VibeWire v0.1.0</span>}>
          Application
        </Shortcut>
        <Shortcut keys={<span className="font-mono text-xs text-zinc-300">public/user-data/</span>}>
          User data folder
        </Shortcut>
        <Shortcut keys={<span className="text-xs text-zinc-300">0.1.0</span>}>
          Schema version
        </Shortcut>
      </Section>
    </ModalShell>
  );
}
