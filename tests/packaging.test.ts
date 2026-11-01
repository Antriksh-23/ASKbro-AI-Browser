import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { verifyDistDirectory, packageExtension, formatBytes } from '../scripts/package.js';

test('Slice 4.4 - formatBytes formats byte sizes accurately', () => {
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1024), '1 KB');
  assert.strictEqual(formatBytes(1048576), '1 MB');
  assert.strictEqual(formatBytes(1536), '1.5 KB');
});

test('Slice 4.4 - verifyDistDirectory validates production dist folder correctly', () => {
  const distPath = path.resolve('dist');
  assert.strictEqual(fs.existsSync(distPath), true, 'dist/ directory must exist');

  const result = verifyDistDirectory(distPath);
  assert.strictEqual(result.valid, true, `Verification failed with errors: ${result.errors.join(', ')}`);
  assert.strictEqual(result.manifestVersion, '3');
  assert.strictEqual(result.extensionVersion, '1.0.0');
  assert.strictEqual(result.extensionName, 'ASKbro - AI Browser Agent');
  assert.ok(result.filesCount >= 10, 'Expected at least 10 production files in dist');
  assert.ok(result.uncompressedSizeBytes > 50000, 'Expected non-trivial file size');
});

test('Slice 4.4 - verifyDistDirectory reports errors for non-existent or invalid directory', () => {
  const fakeDir = path.resolve('tests/fixtures/non-existent-dist');
  const result = verifyDistDirectory(fakeDir);
  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('does not exist')));
});

test('Slice 4.4 - packageExtension generates clean standalone and release ZIP archives', () => {
  const result = packageExtension();

  assert.strictEqual(result.version, '1.0.0');
  assert.strictEqual(result.versionedZipName, 'ASKbro-v1.0.0.zip');
  assert.ok(fs.existsSync(result.versionedZipPath), 'ASKbro-v1.0.0.zip must exist');
  assert.ok(fs.existsSync(result.releaseZipPath), 'release.zip must exist');

  const stat = fs.statSync(result.versionedZipPath);
  assert.ok(stat.size > 50000, 'Compressed ZIP archive should be at least 50KB');

  // Verify internal zip structure
  const zip = new AdmZip(result.versionedZipPath);
  const zipEntries = zip.getEntries();
  const entryNames = zipEntries.map(e => e.entryName.replace(/\\/g, '/'));

  // Must contain manifest.json at root
  assert.ok(entryNames.includes('manifest.json'), 'ZIP root must contain manifest.json');

  // Must contain background service worker and side panel HTML
  assert.ok(entryNames.some(name => name.includes('service-worker')), 'ZIP must contain background worker');
  assert.ok(entryNames.includes('src/sidepanel/index.html'), 'ZIP must contain sidepanel HTML');

  // Must not contain forbidden dev files
  assert.ok(!entryNames.some(name => name.includes('.git/')), 'ZIP must not contain .git');
  assert.ok(!entryNames.some(name => name.includes('node_modules/')), 'ZIP must not contain node_modules');
  assert.ok(!entryNames.some(name => name.endsWith('.ts') && !name.endsWith('.d.ts')), 'ZIP must not contain .ts source files');
});

test('Slice 4.4 - public/landing/index.html contains complete product landing page structure', () => {
  const landingPath = path.resolve('public/landing/index.html');
  assert.ok(fs.existsSync(landingPath), 'public/landing/index.html must exist');

  const content = fs.readFileSync(landingPath, 'utf-8');

  // Title and branding
  assert.ok(content.includes('ASKbro'), 'Must mention ASKbro branding');
  assert.ok(content.includes('Manifest V3'), 'Must highlight Chrome Manifest V3');

  // Four Pillars
  assert.ok(content.includes('The Eyes: Read the Web'), 'Must include Phase 1 Pillar');
  assert.ok(content.includes('The Brain: Understand Page'), 'Must include Phase 2 Pillar');
  assert.ok(content.includes('The Hands: Controlled Action'), 'Must include Phase 3 Pillar');
  assert.ok(content.includes('Memory & Safety Guardrails'), 'Must include Phase 4 Pillar');

  // Safety Matrix
  assert.ok(content.includes('Deterministic Safety Guardrails'), 'Must include Safety Matrix heading');
  assert.ok(content.includes('Banking & Payments'), 'Must detail banking domain guard');
  assert.ok(content.includes('Passwords & PINs'), 'Must detail password field guard');
  assert.ok(content.includes('OTP & 2FA Codes'), 'Must detail OTP field guard');

  // Interactive practice tasks
  assert.ok(content.includes('internship-application.html'), 'Must link to practice internship form');
  assert.ok(content.includes('shop-search-filter.html'), 'Must link to practice search and filter');

  // Step-by-Step Installation
  assert.ok(content.includes('chrome://extensions'), 'Must provide chrome://extensions URL');
  assert.ok(content.includes('Developer mode'), 'Must instruct enabling Developer mode');
  assert.ok(content.includes('Load unpacked'), 'Must instruct clicking Load unpacked');

  // Download link
  assert.ok(content.includes('ASKbro-v1.0.0.zip'), 'Must provide link to download standalone ZIP');
});

test('Slice 4.4 - README.md contains comprehensive documentation and architectural diagrams', () => {
  const readmePath = path.resolve('README.md');
  assert.ok(fs.existsSync(readmePath), 'README.md must exist in root');

  const readme = fs.readFileSync(readmePath, 'utf-8');

  // Core sections
  assert.ok(
    readme.includes('# ASKbro — AI Browser Agent for Web Browsers') ||
    readme.includes('# ASKbro — AI Browser Agent for Web Browser') ||
    readme.includes('# ASKbro — AI Browser Agent for Google Chrome'),
    'Must have main title'
  );
  assert.ok(readme.includes('System Architecture'), 'Must describe system architecture');
  assert.ok(readme.includes('Phase 1: The Eyes'), 'Must document Phase 1 features');
  assert.ok(readme.includes('Phase 2: The Brain'), 'Must document Phase 2 features');
  assert.ok(readme.includes('Phase 3: The Hands'), 'Must document Phase 3 features');
  assert.ok(readme.includes('Phase 4: Memory, Safety & Packaging'), 'Must document Phase 4 features');
  assert.ok(readme.includes('Deterministic Safety Matrix'), 'Must include Deterministic Safety Matrix');

  // Setup instructions
  assert.ok(readme.includes('npm run build'), 'Must include npm run build command');
  assert.ok(readme.includes('npm run package'), 'Must include npm run package command');
  assert.ok(readme.includes('chrome://extensions'), 'Must instruct on loading unpacked extension');
  assert.ok(readme.includes('Google AI Studio'), 'Must guide setting up Gemini API key');
  assert.ok(readme.includes('Groq Console'), 'Must guide setting up Groq fallback key');

  // Practice sandbox & tests
  assert.ok(readme.includes('internship-application.html'), 'Must describe practice tasks');
  assert.ok(readme.includes('npm test'), 'Must document running the test suite');
});

test('Slice 4.4 Acceptance Criteria - Release ZIP installs cleanly via Load unpacked without build artifacts or missing assets', () => {
  const releaseZipPath = path.resolve('ASKbro-v1.0.0.zip');
  assert.ok(fs.existsSync(releaseZipPath), 'Release ZIP must be present');

  const zip = new AdmZip(releaseZipPath);
  const manifestEntry = zip.getEntry('manifest.json');
  assert.ok(manifestEntry, 'manifest.json must be present at archive root');

  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'));
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.version, '1.0.0');

  // Verify default side panel HTML entry
  const sidePanelPath = manifest.side_panel.default_path;
  assert.ok(zip.getEntry(sidePanelPath), `Side panel entry "${sidePanelPath}" must exist in ZIP`);

  // Verify background service worker entry
  const swPath = manifest.background.service_worker;
  assert.ok(zip.getEntry(swPath), `Service worker entry "${swPath}" must exist in ZIP`);

  // Verify icons
  for (const iconPath of Object.values(manifest.icons)) {
    assert.ok(zip.getEntry(iconPath as string), `Icon "${iconPath}" must exist in ZIP`);
  }
});

