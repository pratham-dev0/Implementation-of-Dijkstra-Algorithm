"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRouterName } = require("../static/js/router_names.js");

test("accepts one-character names", () => assert.equal(validateRouterName("A", Object.create(null)), "A"));
test("accepts two-character names", () => assert.equal(validateRouterName("R1", Object.create(null)), "R1"));
test("trims leading and trailing spaces", () => assert.equal(validateRouterName(" AB ", Object.create(null)), "AB"));
test("rejects names longer than two characters", () => assert.throws(() => validateRouterName("ABC", Object.create(null)), /one or two characters/));
test("rejects empty and whitespace-only names", () => {
  assert.throws(() => validateRouterName("", Object.create(null)), /cannot be empty/);
  assert.throws(() => validateRouterName("   ", Object.create(null)), /cannot be empty/);
});
test("rejects duplicate names but permits the current name during rename", () => {
  const graph = Object.assign(Object.create(null), { A: Object.create(null) });
  assert.throws(() => validateRouterName("A", graph), /already exists/);
  assert.equal(validateRouterName("A", graph, "A"), "A");
});
test("rejects __proto__ by the two-character limit before graph mutation", () => {
  const graph = Object.create(null);
  assert.throws(() => validateRouterName("__proto__", graph), /one or two characters/);
  assert.equal(Object.hasOwn(graph, "__proto__"), false);
  assert.equal(Object.getPrototypeOf(graph), null);
});
test("rename validation rejects a duplicate and accepts a unique two-character name", () => {
  const graph = Object.assign(Object.create(null), { A: Object.create(null), B: Object.create(null) });
  assert.throws(() => validateRouterName("B", graph, "A"), /already exists/);
  assert.equal(validateRouterName("R2", graph, "A"), "R2");
});
