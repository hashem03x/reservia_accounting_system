const { test } = require('node:test');
const assert = require('node:assert/strict');
const ApiFeatures = require('../../utils/apiFeatures');

// ApiFeatures.filter(): operators the CLIENT puts in the query string are refused (no query
// injection through ?$where= / ?$or=); the server-built filter object (req.filterObject) may use
// $and/$or itself - it is trusted, and the caller already applied it to its own find/count.

const fakeQuery = () => {
  const calls = [];
  return { calls, find(arg) { calls.push(arg); return this; } };
};

test('a client-supplied top-level operator is still refused', () => {
  for (const key of ['$where', '$or', '$and', '$expr']) {
    assert.throws(() => new ApiFeatures(fakeQuery(), { [key]: '1' }).filter({}), /Invalid field name/);
  }
});

test('the server-built filter may combine clauses with $and / $or, and plain client fields still pass through', () => {
  const query = fakeQuery();
  const serverFilter = { $and: [{ $or: [{ a: 1 }, { b: 2 }] }, { c: 3 }] };
  new ApiFeatures(query, { status: 'posted', price: { gte: '5' } }).filter(serverFilter);
  assert.deepEqual(query.calls[0], { ...serverFilter, status: 'posted', price: { $gte: '5' } });
});
