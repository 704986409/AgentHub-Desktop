'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('legacy renderer compaction queue and delivery latch stay removed', () => {
  const hive = fs.readFileSync(path.join(root, 'src/renderer/src/hooks/useHive.ts'), 'utf8');
  const store = fs.readFileSync(path.join(root, 'src/renderer/src/store/store.ts'), 'utf8');
  assert.doesNotMatch(hive, /enqueueMessage|compactUsed|lastCompactUsed|deliverWithAcknowledgement/);
  assert.doesNotMatch(store, /enqueueMessage|compactUsed|messageQueues/);
  assert.equal(fs.existsSync(path.join(root, 'src/renderer/src/hooks/queueDelivery.ts')), false);
});
