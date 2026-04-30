import assert from "node:assert/strict";
import test from "node:test";
import { formatUserFacingError } from "../dist/utils/errors.js";

test("formatUserFacingError explains EADDRINUSE without throwing", () => {
  const err = new Error("listen EADDRINUSE: address already in use :::5173");
  Object.assign(err, { code: "EADDRINUSE" });
  const msg = formatUserFacingError(err);
  assert.match(msg, /5173/);
  assert.match(msg, /deskpack\.config\.json/);
  assert.ok(!/^\s+at\s+/m.test(msg));
});

test("formatUserFacingError handles configured-port unavailable wording", () => {
  const err = new Error(
    "Configured backend port 3300 is unavailable. Stop the process using it or update deskpack.config.json.",
  );
  const msg = formatUserFacingError(err);
  assert.match(msg, /3300/);
  assert.ok(!msg.includes("Configured backend"));
});

test("formatUserFacingError passes through unrelated errors", () => {
  assert.equal(formatUserFacingError(new Error("missing module")), "missing module");
});
