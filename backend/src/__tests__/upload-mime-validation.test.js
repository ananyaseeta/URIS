'use strict';
/**
 * Unit tests — FIX 12: Profile picture MIME type validation
 *
 * Tests the readMagicBytes() helper and validateAndStore() directly —
 * no HTTP layer needed since validation lives in the service.
 */

const { readMagicBytes } = require('../services/upload.service');

describe('FIX 12 — MIME magic-byte validation', () => {
  test('detects JPEG from FF D8 FF header', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    expect(readMagicBytes(buf)).toBe('image/jpeg');
  });

  test('detects PNG from 89 50 4E 47 0D 0A 1A 0A header', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00]);
    expect(readMagicBytes(buf)).toBe('image/png');
  });

  test('detects WebP from RIFF....WEBP header', () => {
    // RIFF = 52 49 46 46, 4 size bytes, WEBP = 57 45 42 50
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,  // RIFF
      0x00, 0x00, 0x00, 0x00,  // size (ignored)
      0x57, 0x45, 0x42, 0x50,  // WEBP
    ]);
    expect(readMagicBytes(buf)).toBe('image/webp');
  });

  test('returns null for a PDF header', () => {
    // PDF: 25 50 44 46 (%PDF)
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E]);
    expect(readMagicBytes(buf)).toBeNull();
  });

  test('returns null for a GIF header', () => {
    // GIF: 47 49 46 38 (GIF8)
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(readMagicBytes(buf)).toBeNull();
  });

  test('returns null for a zip/exe header', () => {
    // ZIP: 50 4B 03 04
    const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    expect(readMagicBytes(buf)).toBeNull();
  });

  test('returns null for too-short buffer', () => {
    expect(readMagicBytes(Buffer.from([0xFF, 0xD8]))).toBeNull();
    expect(readMagicBytes(null)).toBeNull();
    expect(readMagicBytes(Buffer.alloc(0))).toBeNull();
  });

  test('returns null for empty/text buffer', () => {
    const buf = Buffer.from('hello world this is a text file');
    expect(readMagicBytes(buf)).toBeNull();
  });
});
