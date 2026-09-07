#!/usr/bin/env -S npx tsx
import {
  DEFAULT_JOIN_KIND,
  JOIN_KIND_LABELS,
  nextJoinKind,
  resolveJoinPromptKey,
} from '../src/lib/joinChoice.js';
import {
  applyBundleJoin,
  branchPointToSharedAnchorBlockReason,
  createVisualSharedAnchor,
  demoteBranchPointToSharedAnchor,
  promoteSharedAnchorToBranchPoint,
  type SharedAnchorDocument,
} from '../src/lib/sharedAnchorJoin.js';
import { useSystemStore } from '../src/store/index.js';
import type { SystemData } from '../src/types/index.js';

const fixture: SystemData = {
  schema_version: '0.3.0',
  name: 'Join fixture',
  hierarchy: [
    { id: 'dev_a', name: 'Device A', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_b', name: 'Device B', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_c', name: 'Device C', parent: null, kind: 'device', tags: [], properties: {} },
    { id: 'dev_d', name: 'Device D', parent: null, kind: 'device', tags: [], properties: {} },
  ],
  connectors: [
    { id: 'con_a', name: 'A', parent: 'dev_a', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
    { id: 'con_b', name: 'B', parent: 'dev_b', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
    { id: 'con_c', name: 'C', parent: 'dev_c', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
    { id: 'con_d', name: 'D', parent: 'dev_d', connector_type: 'generic', pin_count: 1, tags: [], properties: {} },
  ],
  branchPoints: [],
  paths: [
    {
      id: 'path_ab',
      name: 'AB',
      signal_id: 'sig_ab',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_a', pin_number: 1 },
        to: { kind: 'connector', connector_id: 'con_b', pin_number: 1 },
        length_mm: 100,
      }],
    },
    {
      id: 'path_cd',
      name: 'CD',
      signal_id: 'sig_cd',
      tags: [],
      properties: {},
      nodes: [
        { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
        { kind: 'connector', connector_id: 'con_d', pin_number: 1 },
      ],
      measurements: [{
        from: { kind: 'connector', connector_id: 'con_c', pin_number: 1 },
        to: { kind: 'connector', connector_id: 'con_d', pin_number: 1 },
        length_mm: 80,
      }],
    },
  ],
  signals: [
    { id: 'sig_ab', name: 'AB', tags: [], properties: {} },
    { id: 'sig_cd', name: 'CD', tags: [], properties: {} },
  ],
  signalPropertyDefinitions: [],
};

const sourceEdgeId = 'bundle:connector:con_a|connector:con_b';
const targetEdgeId = 'bundle:connector:con_c|connector:con_d';

let failures = 0;
function check(name: string, condition: boolean) {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

function emptyDoc(system: SystemData = structuredClone(fixture)): SharedAnchorDocument {
  return {
    system,
    waypointLayouts: {
      [sourceEdgeId]: [{ x: 25, y: 30 }],
    },
    sharedAnchors: {},
    branchPointLayouts: {},
    openEnclosureId: null,
  };
}

check('popup default is Shared Anchor', DEFAULT_JOIN_KIND === 'shared-anchor');
check('Enter confirms the focused Shared Anchor', resolveJoinPromptKey('Enter') === 'shared-anchor');
check('Escape cancels the join', resolveJoinPromptKey('Escape') === 'cancel');
check('arrow keys switch options', resolveJoinPromptKey('ArrowDown') === 'focus-next');
check('next option is Branch point', nextJoinKind('shared-anchor', 1) === 'branch-point');
check('user-facing Shared anchor label', JOIN_KIND_LABELS['shared-anchor'] === 'Shared anchor');
check('user-facing Branch point label', JOIN_KIND_LABELS['branch-point'] === 'Branch point');

const visualOnly = createVisualSharedAnchor(emptyDoc(), { x: 50, y: 60 }, sourceEdgeId, 0, 'jct_visual');
check(
  'pure shared anchor does not change SystemData',
  JSON.stringify(visualOnly.system) === JSON.stringify(emptyDoc().system)
  && !visualOnly.sharedAnchors.jct_visual?.branchPointId
  && visualOnly.sharedAnchors.jct_visual?.memberEdgeIds.includes(sourceEdgeId) === true,
);

const visualJoin = applyBundleJoin(emptyDoc(), {
  sourceEdgeId,
  sourceWaypointIndex: 0,
  targetEdgeId,
  insertAfterIndex: -1,
  position: { x: 50, y: 60 },
  kind: 'shared-anchor',
  sharedAnchorId: 'jct_join',
});
if ('error' in visualJoin) {
  check('visual join applies', false);
} else {
  const members = visualJoin.document.sharedAnchors.jct_join?.memberEdgeIds ?? [];
  check(
    'visual join keeps both Harness Bundle members',
    members.includes(sourceEdgeId) && members.includes(targetEdgeId),
  );
  check(
    'visual join leaves paths without a branch point',
    visualJoin.document.system?.branchPoints.length === 0
    && visualJoin.document.system?.paths.every((path) =>
      path.nodes.every((node) => node.kind !== 'branch')
    ) === true,
  );
  check(
    'visual join preserves path measurements',
    visualJoin.document.system?.paths[0]?.measurements[0]?.length_mm === 100
    && visualJoin.document.system?.paths[1]?.measurements[0]?.length_mm === 80,
  );
}

const generatedVisualJoin = applyBundleJoin(emptyDoc(), {
  sourceEdgeId,
  sourceWaypointIndex: 0,
  targetEdgeId,
  insertAfterIndex: -1,
  position: { x: 45, y: 55 },
  kind: 'shared-anchor',
});
check(
  'new Shared Anchor ids use the canonical prefix',
  !('error' in generatedVisualJoin) && generatedVisualJoin.sharedAnchorId.startsWith('sa_'),
);

const branchJoin = applyBundleJoin(emptyDoc(), {
  sourceEdgeId,
  sourceWaypointIndex: 0,
  targetEdgeId,
  insertAfterIndex: -1,
  position: { x: 50, y: 60 },
  kind: 'branch-point',
  sharedAnchorId: 'jct_branch',
  branchPointId: 'bp_join',
});
if ('error' in branchJoin) {
  check('branch-point join applies', false);
} else {
  const system = branchJoin.document.system!;
  check(
    'Branch Point mode inserts topology',
    system.branchPoints.some((item) => item.id === 'bp_join')
    && system.paths.every((path) =>
      path.nodes.some((node) => node.kind === 'branch' && node.branch_point_id === 'bp_join')
    ),
  );
  check(
    'branch join splits measurements across the new hops',
    system.paths[0].measurements.length === 2
    && system.paths[0].measurements.reduce((sum, item) => sum + (item.length_mm ?? 0), 0) === 100,
  );
  check(
    'branch join couples the shared anchor',
    branchJoin.document.sharedAnchors.jct_branch?.branchPointId === 'bp_join',
  );
}

if (!('error' in visualJoin)) {
  const promoted = promoteSharedAnchorToBranchPoint(visualJoin.document, 'jct_join', 'bp_from_visual');
  if ('error' in promoted) {
    check('promote visual to branch', false);
  } else {
    const system = promoted.document.system!;
    const members = promoted.document.sharedAnchors.jct_join?.memberEdgeIds ?? [];
    check(
      'promote visual to branch inserts one BranchPoint',
      promoted.branchPointId === 'bp_from_visual'
      && system.branchPoints.length === 1
      && system.paths.every((path) =>
        path.nodes.some((node) => node.kind === 'branch' && node.branch_point_id === 'bp_from_visual')
      ),
    );
    check(
      'promote preserves the shared visual anchor',
      promoted.document.sharedAnchors.jct_join?.branchPointId === 'bp_from_visual'
      && members.length >= 2,
    );
    const demoted = demoteBranchPointToSharedAnchor(promoted.document, 'bp_from_visual', 'jct_join');
    if ('error' in demoted) {
      check('demote branch to visual', false);
    } else {
      const after = demoted.document.system!;
      check(
        'demote branch to visual removes the topology node',
        after.branchPoints.length === 0
        && after.paths.every((path) => path.nodes.every((node) => node.kind !== 'branch')),
      );
      check(
        'demote preserves shared-anchor geometry and members',
        demoted.document.sharedAnchors.jct_join?.x === 50
        && demoted.document.sharedAnchors.jct_join?.y === 60
        && !demoted.document.sharedAnchors.jct_join?.branchPointId
        && (demoted.document.sharedAnchors.jct_join?.memberEdgeIds.length ?? 0) >= 2,
      );
      check(
        'demote restores original hop measurements',
        after.paths[0].measurements[0]?.length_mm === 100
        && after.paths[1].measurements[0]?.length_mm === 80,
      );
    }
  }
}

if (!('error' in branchJoin)) {
  const withoutAnchor = {
    ...branchJoin.document,
    sharedAnchors: {},
  };
  const generatedDemotion = demoteBranchPointToSharedAnchor(withoutAnchor, 'bp_join');
  check(
    'demotion fallback uses a canonical Shared Anchor id',
    !('error' in generatedDemotion) && generatedDemotion.sharedAnchorId.startsWith('sa_'),
  );
}

const orphan: SystemData = {
  ...structuredClone(fixture),
  branchPoints: [{ id: 'bp_orphan', name: 'Orphan', parent: null, tags: [], properties: {}, derived: true }],
};
check(
  'sheet-derived branch point cannot demote',
  branchPointToSharedAnchorBlockReason(orphan, 'bp_orphan') !== null,
);

function resetStore() {
  useSystemStore.getState().resetForSystemSwitch();
  useSystemStore.getState().setCollabAvailable(false);
  useSystemStore.getState().loadSystem(structuredClone(fixture));
  useSystemStore.setState({
    undoStack: [],
    redoStack: [],
    waypointLayouts: { [sourceEdgeId]: [{ x: 25, y: 30 }] },
    sharedAnchors: {},
    branchPointLayouts: {},
  });
}

resetStore();
const createdAnchorId = useSystemStore.getState().createSharedAnchor(
  { x: 40, y: 45 },
  sourceEdgeId,
  0,
);
check('direct Shared Anchor creation uses the canonical prefix', createdAnchorId.startsWith('sa_'));
resetStore();
const joinedId = useSystemStore.getState().joinBundlesAtDrop({
  sourceEdgeId,
  sourceWaypointIndex: 0,
  targetEdgeId,
  insertAfterIndex: -1,
  position: { x: 40, y: 45 },
  kind: 'shared-anchor',
});
check('store visual join returns an id', typeof joinedId === 'string');
check('store visual join uses a canonical Shared Anchor id', joinedId?.startsWith('sa_') === true);
const afterVisual = useSystemStore.getState();
check(
  'store visual join does not mint a branch point',
  afterVisual.system?.branchPoints.length === 0
  && !!joinedId
  && !afterVisual.sharedAnchors[joinedId]?.branchPointId,
);
useSystemStore.getState().convertSharedAnchorToBranchPoint(joinedId!);
check(
  'store promote is one undoable action',
  useSystemStore.getState().system?.branchPoints.length === 1,
);
useSystemStore.getState().undo();
check(
  'undo restore visual shared anchor',
  useSystemStore.getState().system?.branchPoints.length === 0
  && !useSystemStore.getState().sharedAnchors[joinedId!]?.branchPointId,
);
useSystemStore.getState().redo();
const promotedId = useSystemStore.getState().sharedAnchors[joinedId!]?.branchPointId;
check(
  'redo reapplies promote',
  !!promotedId && useSystemStore.getState().system?.branchPoints.length === 1,
);
useSystemStore.getState().convertBranchPointToSharedAnchor(promotedId!);
check(
  'store demote returns to visual',
  useSystemStore.getState().system?.branchPoints.length === 0
  && !useSystemStore.getState().sharedAnchors[joinedId!]?.branchPointId,
);
useSystemStore.getState().undo();
check(
  'undo restore branch point after demote',
  useSystemStore.getState().system?.branchPoints.length === 1,
);

if (failures > 0) {
  console.error(`\nFAIL ${failures} join-choice test${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\nPASS join-choice tests');
