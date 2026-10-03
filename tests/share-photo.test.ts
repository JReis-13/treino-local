import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SHARE_PHOTO_BYTES, MAX_SHARE_PHOTO_EDGE, photoSelectionError } from "../lib/training/share-photo";

test("photo intake accepts phone raster formats and rejects unsupported, empty, and oversized files", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/heif"]) {
    assert.equal(photoSelectionError({ type, size: 5_000_000 }), undefined);
  }
  assert.match(photoSelectionError({ type: "image/svg+xml", size: 100 })!, /Choose a JPEG/);
  assert.match(photoSelectionError({ type: "application/pdf", size: 100 })!, /Choose a JPEG/);
  assert.match(photoSelectionError({ type: "image/jpeg", size: 0 })!, /too large or empty/);
  assert.match(photoSelectionError({ type: "image/jpeg", size: MAX_SHARE_PHOTO_BYTES + 1 })!, /under 30 MB/);
  assert.equal(MAX_SHARE_PHOTO_EDGE, 1600);
});
