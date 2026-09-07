import type { ReactNode } from 'react';
import { useSystemStore } from '../../store';
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
  const isOpen = useSystemStore((s) => s.settingsOpen);
  const setOpen = useSystemStore((s) => s.setSettingsOpen);

  if (!isOpen) return null;

  return (
    <ModalShell title="Tips" onClose={() => setOpen(false)} widthClassName="w-[540px]">
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
          Deselect, or close the current panel / close the enclosure
        </Shortcut>
        <Shortcut keys={<Kbd>F</Kbd>}>
          Fit the canvas to everything on screen (same as the fit-view button)
        </Shortcut>
        <Shortcut keys={<><Kbd>⌘</Kbd><Kbd>B</Kbd></>}>
          Go back through camera positions, inspector states, and top-page navigation (Ctrl+B on Windows/Linux)
        </Shortcut>
        <Shortcut keys={<><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>B</Kbd></>}>
          Go forward again after going back (Ctrl+Shift+B on Windows/Linux)
        </Shortcut>
      </Section>

      <Section title="Editing">
        <Shortcut keys={<Kbd>E</Kbd>}>
          Continue as the last logged-in user (arms editing after a cookie restore)
        </Shortcut>
        <Shortcut keys={<><Kbd>⌘</Kbd><Kbd>Z</Kbd></>}>
          Undo (Ctrl+Z on Windows/Linux)
        </Shortcut>
        <Shortcut keys={<><Kbd>⌘</Kbd><Kbd>⇧</Kbd><Kbd>Z</Kbd></>}>
          Redo (also ⌘Y / Ctrl+Y)
        </Shortcut>
        <Shortcut keys={<Kbd>R</Kbd>}>
          Rotate the selected connector or enclosure 90°
        </Shortcut>
        <Shortcut keys={<Kbd>N</Kbd>}>
          Add a device or enclosure (same as the + button in the hierarchy)
        </Shortcut>
        <Shortcut keys={<Kbd>Enter</Kbd>}>
          Confirm the Choose signal popup after routing a wire
        </Shortcut>
        <Shortcut keys={<Kbd>Delete</Kbd>}>
          Delete the selection (Backspace also works). Devices and Harness Bundles ask first. A selected route point is removed immediately.
        </Shortcut>
      </Section>

      <Section title="Hierarchy">
        <ul className="divide-y divide-transparent">
          <Tip>Double-click a row to expand or collapse it.</Tip>
          <Tip>Hold <span className="text-zinc-100">Shift</span> and drag across rows to open several dropdowns at once.</Tip>
          <Tip>Press <span className="text-zinc-100">N</span> or click <span className="text-zinc-100">+</span> to add a device or enclosure.</Tip>
          <Tip>Images and text boxes for the current sheet are listed at the bottom. System, each enclosure, and each subsystem keep their own images. Click a row to inspect it.</Tip>
        </ul>
      </Section>

      <Section title="Canvas tricks">
        <ul className="divide-y divide-transparent">
          <Tip>Double-click a device or enclosure to open it. Use the breadcrumb or Esc to close the enclosure.</Tip>
          <Tip>Double-click a Harness Bundle to add a bend point. Click a bend dot to select it — Delete/Backspace then removes that point, not the whole path. Drag a bend and the wire follows live. On a grid wire, unused bends on a straight run drop away when you click off the wire or drag a segment. Drag a bend onto another Harness Bundle to join them: the popup defaults to Shared anchor (visual only, Enter confirms). Choose Branch point to insert a real topology node. Escape cancels the join. Dropping onto an existing shared join keeps that type without asking again. Convert either way later from the inspector.</Tip>
          <Tip>When several circuits share a branch approach but go to different places, a small colored handle appears at the branch point. Drag it away to separate that connection onto its own new branch point — wires that go to the same destinations stay together and can&apos;t be pulled apart.</Tip>
          <Tip>Click a branch point to see each signal, the full device chain of every path through it in both directions, and a <span className="text-zinc-100">Harness Bundles</span> list with a <span className="text-zinc-100">Split out</span> button for each distinct connection — the explicit way to undo a fuse.</Tip>
          <Tip>Drag one free-floating branch point onto another to fuse them into one — the inverse of separating one apart.</Tip>
          <Tip>Click the triangle on a connector, or double-click / Shift-click the connector, to open or close its pin table. Wires fan out to each cavity; collapse it to bundle them again.</Tip>
          <Tip>Drag a cavity pin handle onto another cavity to reorder it, or onto another connector to route a wire there.</Tip>
          <Tip>While dragging a wire from a pin, hover another connector to open its pin table so you can drop on a specific cavity. After you finish the route, that table stays open briefly, then closes.</Tip>
          <Tip>After you drop a wire, the signal popup starts on an uninitialized signal. Type a name, pick a color, and press Enter to route — or choose an existing signal from the list. Open full editor routes and takes you to the Signals page. Esc cancels.</Tip>
          <Tip>Drag one inline connector or bulkhead onto another of the same kind to merge them. Nearby bulkheads on the same wall also merge.</Tip>
          <Tip>Double-click or right-click a pin&apos;s signal tag to jump straight to that signal.</Tip>
          <Tip>Hold <span className="text-zinc-100">Shift</span> and drag on the canvas to lasso-select multiple items.</Tip>
          <Tip>With a Harness Bundle selected, use <span className="text-zinc-100">+ Route points</span> or <span className="text-zinc-100">+ Inline connector</span> then click anywhere to place — drag existing points to move them, Esc when done.</Tip>
          <Tip>On a grid wire, drag the segment to move a run. Bend dots appear only where you placed a point or the wire actually turns — computed grid corners are not leftover handles.</Tip>
          <Tip>In the wire-color picker, Shift/Ctrl/Cmd-click two swatches to build a striped color like <span className="font-mono text-zinc-100">white/brown</span>.</Tip>
          <Tip>Click <span className="text-zinc-100">Image</span> to drop pictures on the sheet you are looking at — System, an open enclosure, or a subsystem each has its own set. In the inspector, lock one so dragging does not move it — double-click a locked image to select it. Background images sit behind the wiring; Foreground images sit on top.</Tip>
        </ul>
      </Section>

      <Section title="Manufacturing progress">
        <ul className="divide-y divide-transparent">
          <Tip>Double-click a pin, branch point, or wire in the harness diagram to toggle it done.</Tip>
          <Tip>Shift-click or shift-drag across several items to invert all of them at once.</Tip>
        </ul>
      </Section>

      <Section title="Collaboration">
        <ul className="divide-y divide-transparent">
          <Tip>Colored initials show where other people are working. A pulsing badge means they are actively editing that item; hover a badge or the topbar people list for names and locations.</Tip>
          <Tip>The inspector footer shows who last saved the selected item and when. For a Harness Bundle, it shows the newest save among its paths.</Tip>
          <Tip><span className="text-zinc-100">Read only</span> appears for viewers — they can look around but can&apos;t change data.</Tip>
          <Tip>
            Undo is <span className="text-zinc-100">per-person and time-ordered</span>, not a global history: it undoes
            your last change, not necessarily the most recent one overall. The status chip next to Undo turns red if
            someone else has edited since your last change, since undoing then risks crossing their work.
          </Tip>
          <Tip><span className="text-zinc-100">Checkpoints</span> save and restore full snapshots of the system — VibeWire also takes one automatically before risky operations.</Tip>
          <Tip><span className="text-zinc-100">Activity</span> lists recent changes and who made them.</Tip>
          <Tip>Anyone can create their own account from the <span className="text-zinc-100">Log in</span> panel — pick Editor to make changes or Viewer to just look around.</Tip>
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
