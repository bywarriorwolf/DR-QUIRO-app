import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { archName, assertModel, assertNativeBinaries, ortPackageFor, pruneNativeBinaries } = require('../scripts/after-pack.cjs') as {
  archName(arch: number | string): string;
  ortPackageFor(os: string, arch: string): string;
  pruneNativeBinaries(nm: string, os: string, arch: string): void;
  assertNativeBinaries(nm: string, os: string, arch: string): void;
  assertModel(resourcesDir: string): void;
};

function touch(file: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'x');
}

function fixture(): string {
  const nm = mkdtempSync(path.join(tmpdir(), 'drq-pack-'));
  for (const pkg of ['onnxruntime-node', 'onnxruntime-node-darwin-x64']) {
    for (const [os, arch] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['win32', 'x64'],
      ['linux', 'x64'],
    ]) {
      touch(path.join(nm, pkg, 'bin', 'napi-v6', os, arch, 'onnxruntime_binding.node'));
    }
  }
  for (const name of [
    'sharp-darwin-arm64',
    'sharp-darwin-x64',
    'sharp-libvips-darwin-arm64',
    'sharp-libvips-darwin-x64',
    'sharp-linux-x64',
    'sharp-libvips-linux-x64',
    'sharp-win32-x64',
    'colour',
  ]) {
    touch(path.join(nm, '@img', name, 'pkg'));
  }
  return nm;
}

describe('afterPack native prune', () => {
  it('maps electron-builder arch numbers', () => {
    expect(archName(1)).toBe('x64');
    expect(archName(3)).toBe('arm64');
    expect(ortPackageFor('darwin', 'x64')).toBe('onnxruntime-node-darwin-x64');
    expect(ortPackageFor('darwin', 'arm64')).toBe('onnxruntime-node');
    expect(ortPackageFor('win32', 'x64')).toBe('onnxruntime-node');
  });

  it('Apple Silicon keeps onnxruntime-node and sharp arm64, and drops Intel and other OSes', () => {
    const nm = fixture();
    try {
      pruneNativeBinaries(nm, 'darwin', 'arm64');
      assertNativeBinaries(nm, 'darwin', 'arm64');
      expect(path.join(nm, 'onnxruntime-node/bin/napi-v6/darwin/x64')).toMatch(/x64/);
      const { existsSync } = require('node:fs') as typeof import('node:fs');
      expect(existsSync(path.join(nm, 'onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node'))).toBe(true);
      expect(existsSync(path.join(nm, 'onnxruntime-node/bin/napi-v6/darwin/x64'))).toBe(false);
      expect(existsSync(path.join(nm, 'onnxruntime-node/bin/napi-v6/win32/x64'))).toBe(false);
      expect(existsSync(path.join(nm, 'onnxruntime-node-darwin-x64/bin/napi-v6/darwin/x64'))).toBe(false);
      expect(existsSync(path.join(nm, '@img/sharp-darwin-arm64'))).toBe(true);
      expect(existsSync(path.join(nm, '@img/sharp-libvips-darwin-arm64'))).toBe(true);
      expect(existsSync(path.join(nm, '@img/sharp-darwin-x64'))).toBe(false);
      expect(existsSync(path.join(nm, '@img/sharp-linux-x64'))).toBe(false);
      expect(existsSync(path.join(nm, '@img/colour'))).toBe(true);
    } finally {
      rmSync(nm, { recursive: true, force: true });
    }
  });

  it('Intel Macs keep the 1.23 alias and sharp x64', () => {
    const nm = fixture();
    try {
      pruneNativeBinaries(nm, 'darwin', 'x64');
      assertNativeBinaries(nm, 'darwin', 'x64');
      const { existsSync } = require('node:fs') as typeof import('node:fs');
      expect(existsSync(path.join(nm, 'onnxruntime-node-darwin-x64/bin/napi-v6/darwin/x64/onnxruntime_binding.node'))).toBe(true);
      expect(existsSync(path.join(nm, 'onnxruntime-node-darwin-x64/bin/napi-v6/darwin/arm64'))).toBe(false);
      expect(existsSync(path.join(nm, 'onnxruntime-node/bin/napi-v6/darwin/arm64'))).toBe(false);
      expect(existsSync(path.join(nm, '@img/sharp-darwin-x64'))).toBe(true);
      expect(existsSync(path.join(nm, '@img/sharp-libvips-darwin-x64'))).toBe(true);
      expect(existsSync(path.join(nm, '@img/sharp-darwin-arm64'))).toBe(false);
    } finally {
      rmSync(nm, { recursive: true, force: true });
    }
  });

  it('refuses a bundle with no ONNX model', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'drq-model-'));
    try {
      expect(() => assertModel(dir)).toThrow(/modelo ONNX/);
      touch(path.join(dir, 'models', 'isnet-general-use.onnx'));
      expect(() => assertModel(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
