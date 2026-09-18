/**
 * Enclosure ↔ device conversion: keep the entity, drop nested contents,
 * and flip connector roles derived from `container`.
 */
import assert from 'node:assert/strict';
import { DOUBLE_CLICK_GUARD_MS, inspectorRevealDelayMs } from '../src/lib/doubleClickGuard.js';
import { getHierarchyHotkey } from '../src/lib/hierarchyHotkeys.js';
import { getConnectorRole } from '../src/lib/systemTopology.js';
import { useSystemStore } from '../src/store/index.js';
import type { SystemData } from '../src/types/index.js';

const fixture: SystemData = {
  signalPropertyDefinitions: [],
  schema_version: '0.2.0-sheets',
  name: 'Kind convert',
  hierarchy: [
    { id: 'enc_box', name: 'Cube Box', parent: null, kind: 'enclosure', tags: [], properties: {} },
    { id: 'enc_inner', name: 'Inner Box', parent: 'enc_box', kind: 'enclosure', tags: [], properties: {} },
    { id: 'dev_a', name: 'Device A', parent: 'enc_box', kind: 'device', tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: 'enc_inner', kind: 'device', tags: [], properties: {} },
    { id: 'dev_solo', name: 'Solo', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_wall', name: 'Wall', parent: 'enc_box', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_a', name: 'A', parent: 'dev_a', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_b', name: 'B', parent: 'dev_b', connector_type: 'generic', tags: [], properties: {} },
    { id: 'con_solo', name: 'Solo port', parent: 'dev_solo', connector_type: 'generic', tags: [], properties: {} },
  ],
  branchPoints: [
    { id: 'mp_inside', name: 'Inside branch', parent: 'enc_box', tags: [], properties: {} },
  ],
  paths: [
    {
      id: 'path_nested',
      name: 'Nested',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
      ],
      measurements: [],
    },
    {
      id: 'path_wall',
      name: 'Wall to solo',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_wall', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_solo', pin_number: 1 },
      ],
      measurements: [],
    },
  ],
  signals: [],
};

function reset(data: SystemData = fixture) {
  useSystemStore.getState().resetForSystemSwitch();
  useSystemStore.getState().setCollabAvailable(false);
  useSystemStore.getState().loadSystem(structuredClone(data));
  useSystemStore.setState({
    undoStack: [],
    redoStack: [],
    selectedItem: { type: 'enclosure', id: 'enc_box' },
    selectedHarnessBundle: null,
    selectedTextBoxId: null,
    openEnclosureId: 'enc_box',
  });
}

reset();
{
  const impact = useSystemStore.getState().getEnclosureKindConvertImpact('enc_box');
  assert.equal(impact?.fromEnclosure, true);
  assert.deepEqual(new Set(impact?.nestedDeviceIds), new Set(['dev_a', 'dev_b']));
  assert.deepEqual(impact?.nestedEnclosureIds, ['enc_inner']);
  assert.deepEqual(new Set(impact?.connectorIds), new Set(['con_a', 'con_b']));
  assert.deepEqual(impact?.branchPointIds, ['mp_inside']);
  assert.ok(impact?.pathIds.includes('path_nested'));
  assert.ok(!impact?.pathIds.includes('path_wall'));
  assert.ok((impact?.nestedDeviceIds.length ?? 0) >= 2, 'two nested devices must trigger a second confirm in the UI');
}

{
  const converted = useSystemStore.getState().convertEnclosureKind('enc_box');
  assert.equal(converted, true);
  const system = useSystemStore.getState().system;
  assert.ok(system);
  const box = system.hierarchy.find((item) => item.id === 'enc_box');
  assert.equal(box?.kind === 'enclosure', false);
  assert.equal(system.hierarchy.some((item) => item.id === 'dev_a'), false);
  assert.equal(system.hierarchy.some((item) => item.id === 'dev_b'), false);
  assert.equal(system.hierarchy.some((item) => item.id === 'enc_inner'), false);
  assert.ok(system.connectors.some((item) => item.id === 'con_wall'));
  assert.equal(system.connectors.some((item) => item.id === 'con_a'), false);
  assert.equal(system.branchPoints.length, 0);
  assert.equal(system.paths.some((path) => path.id === 'path_nested'), false);
  assert.ok(system.paths.some((path) => path.id === 'path_wall'));
  assert.equal(getConnectorRole(system, 'con_wall'), 'bulkhead');
  assert.equal(useSystemStore.getState().openEnclosureId, null);
}

useSystemStore.getState().undo();
{
  const system = useSystemStore.getState().system;
  assert.equal(system?.hierarchy.find((item) => item.id === 'enc_box')?.kind === 'enclosure', true);
  assert.ok(system?.hierarchy.some((item) => item.id === 'dev_a'));
  assert.ok(system?.paths.some((path) => path.id === 'path_nested'));
}

reset();
{
  const converted = useSystemStore.getState().convertEnclosureKind('dev_solo');
  assert.equal(converted, true);
  const system = useSystemStore.getState().system;
  assert.ok(system);
  assert.equal(system.hierarchy.find((item) => item.id === 'dev_solo')?.kind === 'enclosure', true);
  assert.ok(system.connectors.some((item) => item.id === 'con_solo'));
  assert.equal(getConnectorRole(system, 'con_solo'), 'bulkhead');
  const impact = useSystemStore.getState().getEnclosureKindConvertImpact('dev_solo');
  assert.equal(impact?.fromEnclosure, true);
  assert.equal(impact?.nestedDeviceIds.length, 0);
}

// The contextual canvas action uses the inspected entity as the connector parent.
for (const [parentId, expectedRole] of [['dev_solo', 'endpoint'], ['enc_box', 'bulkhead']] as const) {
  reset();
  const beforeCount = useSystemStore.getState().system!.connectors.length;
  const connectorId = useSystemStore.getState().addConnector(parentId, { focusName: true });
  assert.ok(connectorId);
  const state = useSystemStore.getState();
  assert.equal(state.system!.connectors.find((item) => item.id === connectorId)?.parent, parentId);
  assert.equal(getConnectorRole(state.system!, connectorId), expectedRole);
  assert.deepEqual(state.selectedItem, { type: 'connector', id: connectorId });
  assert.equal(state.pendingInspectorNameFocusId, connectorId, 'new connector name is ready for typing');
  assert.ok(state.portLayouts[connectorId], 'new connector has a canvas position');
  state.undo();
  assert.equal(useSystemStore.getState().system!.connectors.length, beforeCount);
}

// Creation keys must not steal typing, modified commands, or session activation.
const keyEvent = {
  key: 'd', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, defaultPrevented: false, isComposing: false,
};
const hotkeyContext = { isEditor: true, isTyping: false, modalOpen: false };
for (const [key, kind] of [['d', 'device'], ['D', 'device'], ['e', 'enclosure'], ['E', 'enclosure']] as const) {
  const event = { ...keyEvent, key };
  assert.equal(getHierarchyHotkey(event, hotkeyContext), kind);
  assert.equal(getHierarchyHotkey(event, { ...hotkeyContext, isEditor: false }), null);
  assert.equal(getHierarchyHotkey(event, { ...hotkeyContext, isTyping: true }), null);
  assert.equal(getHierarchyHotkey(event, { ...hotkeyContext, modalOpen: true }), null);
  for (const guard of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat', 'defaultPrevented', 'isComposing'] as const) {
    assert.equal(getHierarchyHotkey({ ...event, [guard]: true }, hotkeyContext), null, guard);
  }
}
assert.equal(getHierarchyHotkey({ ...keyEvent, key: 'n' }, hotkeyContext), null);

assert.equal(inspectorRevealDelayMs({
  show: false, alreadyRevealed: false, immediate: false, fromCanvasPointer: true,
}), null);
assert.equal(inspectorRevealDelayMs({
  show: true, alreadyRevealed: true, immediate: false, fromCanvasPointer: true,
}), 0);
assert.equal(inspectorRevealDelayMs({
  show: true, alreadyRevealed: false, immediate: true, fromCanvasPointer: true,
}), 0);
assert.equal(inspectorRevealDelayMs({
  show: true, alreadyRevealed: false, immediate: false, fromCanvasPointer: false,
}), 0);
assert.equal(inspectorRevealDelayMs({
  show: true, alreadyRevealed: false, immediate: false, fromCanvasPointer: true,
}), DOUBLE_CLICK_GUARD_MS);

console.log('test-enclosure-kind: ok');
