import test from "node:test";
import assert from "node:assert/strict";
import { postAuthPath } from "../frontend/assets/js/core/auth-redirect.js";

test("post-auth redirects default to role dashboards", () => {
  assert.equal(postAuthPath({ isStaff: false }), "/account");
  assert.equal(postAuthPath({ isStaff: true }), "/admin");
});

test("post-auth redirects preserve safe internal paths", () => {
  assert.equal(postAuthPath({ isStaff: false }, "/checkout?step=delivery#address"), "/checkout?step=delivery#address");
  assert.equal(postAuthPath({ isStaff: true }, "/admin/orders"), "/admin/orders");
});

test("post-auth redirects reject external and unsafe paths", () => {
  for (const path of ["https://example.com", "//example.com", "/\\example.com", "/%2f%2fexample.com"]) {
    assert.equal(postAuthPath({ isStaff: false }, path), "/account");
  }
});

test("customers cannot be redirected into admin paths", () => {
  assert.equal(postAuthPath({ isStaff: false }, "/admin"), "/account");
  assert.equal(postAuthPath({ isStaff: false }, "/%61dmin/orders"), "/account");
});
