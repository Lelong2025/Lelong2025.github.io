import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifySepaySignature } from "../src/index.js";

const secret = "test-secret-that-is-at-least-32-characters";
const body = JSON.stringify({ id: 123, transferAmount: 25000 });

function signedRequest(timestamp, signedBody = body) {
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${signedBody}`).digest("hex")}`;
  return new Request("https://example.test/hooks/sepay-payment", {
    headers: {
      "X-SePay-Signature": signature,
      "X-SePay-Timestamp": String(timestamp)
    }
  });
}

test("accepts a valid SePay HMAC signature", async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal(await verifySepaySignature(body, signedRequest(timestamp), secret), true);
});

test("rejects a tampered SePay payload", async () => {
  const timestamp = Math.floor(Date.now() / 1000);
  assert.equal(await verifySepaySignature(`${body}x`, signedRequest(timestamp), secret), false);
});

test("rejects a replayed SePay signature", async () => {
  const timestamp = Math.floor(Date.now() / 1000) - 301;
  assert.equal(await verifySepaySignature(body, signedRequest(timestamp), secret), false);
});
