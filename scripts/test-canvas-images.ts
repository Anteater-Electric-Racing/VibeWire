import assert from 'node:assert/strict';
import {
  canvasImageContextKey,
  imageMatchesContext,
  migrateCanvasImages,
  viewFromImageContextKey,
} from '../src/lib/canvasImages.js';
import { useSystemStore } from '../src/store/index.js';

{
  assert.equal(
    canvasImageContextKey('hierarchy', null, 'sub_power'),
    'graph',
  );
  assert.equal(
    canvasImageContextKey('hierarchy', 'enc_box', 'sub_power'),
    'enc_box',
  );
  assert.equal(
    canvasImageContextKey('subsystem', 'enc_box', 'sub_power'),
    'subsystem:sub_power',
  );
  assert.equal(
    canvasImageContextKey('subsystem', null, null),
    'graph',
  );
}

{
  assert.deepEqual(viewFromImageContextKey('graph'), {
    editingSurface: 'hierarchy',
    openEnclosureId: null,
    activeSubsystemId: null,
  });
  assert.deepEqual(viewFromImageContextKey('enc_box'), {
    editingSurface: 'hierarchy',
    openEnclosureId: 'enc_box',
    activeSubsystemId: null,
  });
  assert.deepEqual(viewFromImageContextKey('subsystem:sub_power'), {
    editingSurface: 'subsystem',
    openEnclosureId: null,
    activeSubsystemId: 'sub_power',
  });
}

{
  assert.equal(imageMatchesContext('graph', 'graph'), true);
  assert.equal(imageMatchesContext(undefined, 'graph'), true);
  assert.equal(imageMatchesContext('graph', 'subsystem:sub_power'), false);
  assert.equal(imageMatchesContext('subsystem:sub_power', 'subsystem:sub_power'), true);
}

{
  const migrated = migrateCanvasImages({}, {
    graph: {
      x: 1, y: 2, w: 3, h: 4, locked: true,
      image: 'sheet.png',
    },
    enc_box: {
      x: 5, y: 6, w: 7, h: 8, locked: false,
      image: 'inside.png',
    },
  });
  assert.equal(migrated.img_graph?.contextKey, 'graph');
  assert.equal(migrated.img_enc_box?.contextKey, 'enc_box');
}

{
  useSystemStore.getState().resetForSystemSwitch();
  useSystemStore.getState().setCollabAvailable(false);
  useSystemStore.setState({
    editingSurface: 'hierarchy',
    openEnclosureId: null,
    activeSubsystemId: 'sub_power',
    imageLayouts: {},
  });
  useSystemStore.getState().addImage(0, 0, 'root.png');
  const root = Object.values(useSystemStore.getState().imageLayouts);
  assert.equal(root.length, 1);
  assert.equal(root[0]?.contextKey, 'graph');

  useSystemStore.setState({
    openEnclosureId: 'enc_box',
    imageLayouts: {},
  });
  useSystemStore.getState().addImage(0, 0, 'inside.png');
  const inside = Object.values(useSystemStore.getState().imageLayouts);
  assert.equal(inside[0]?.contextKey, 'enc_box');

  useSystemStore.setState({
    editingSurface: 'subsystem',
    activeSubsystemId: 'sub_power',
    openEnclosureId: 'enc_box',
    imageLayouts: {},
  });
  useSystemStore.getState().addImage(0, 0, 'sub.png');
  const sub = Object.values(useSystemStore.getState().imageLayouts);
  assert.equal(sub[0]?.contextKey, 'subsystem:sub_power');
}

console.log('test-canvas-images: ok');
