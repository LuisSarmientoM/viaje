import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_IMAGE_BYTES,
  detectImageType,
  hasSameOrigin,
  imageKey,
} from "../functions/lib/images.js";

test("detecta únicamente firmas JPEG, PNG y WebP", () => {
  assert.equal(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(
    detectImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(
    detectImageType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    "image/webp",
  );
  assert.equal(detectImageType(new TextEncoder().encode("<svg></svg>")), null);
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
});

test("limita ids y claves al namespace del viaje", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(imageKey({ TRIP_ID: "europa_2026" }, id), `europa_2026/${id}`);
  assert.equal(imageKey({ TRIP_ID: "../otro" }, id), null);
  assert.equal(imageKey({ TRIP_ID: "europa" }, "../imagen"), null);
});

test("acepta solicitudes sin Origin o del mismo origen", () => {
  assert.equal(hasSameOrigin(new Request("http://localhost:8788/api/images")), true);
  assert.equal(
    hasSameOrigin(
      new Request("http://localhost:8788/api/images", {
        headers: { Origin: "http://localhost:8788" },
      }),
    ),
    true,
  );
  assert.equal(
    hasSameOrigin(
      new Request("http://localhost:8788/api/images", {
        headers: { Origin: "https://example.com" },
      }),
    ),
    false,
  );
});
