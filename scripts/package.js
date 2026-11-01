import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

/**
 * @typedef {Object} PackageVerificationResult
 * @property {boolean} valid
 * @property {string[]} errors
 * @property {string[]} warnings
 * @property {number} filesCount
 * @property {number} uncompressedSizeBytes
 * @property {string} [manifestVersion]
 * @property {string} [extensionVersion]
 * @property {string} [extensionName]
 */

/**
 * Validates the dist/ directory to ensure all essential Chrome MV3
 * extension artifacts exist and are free from unwanted development files.
 *
 * @param {string} [distPath]
 * @returns {PackageVerificationResult}
 */
export function verifyDistDirectory(distPath = path.resolve('dist')) {
  const result = {
    valid: true,
    errors: [],
    warnings: [],
    filesCount: 0,
    uncompressedSizeBytes: 0
  };

  if (!fs.existsSync(distPath)) {
    result.valid = false;
    result.errors.push(`Directory does not exist: ${distPath}`);
    return result;
  }

  // 1. Verify manifest.json exists and is valid
  const manifestPath = path.join(distPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    result.valid = false;
    result.errors.push('Missing required file: manifest.json in dist root');
  } else {
    try {
      const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw);

      result.manifestVersion = String(manifest.manifest_version || '');
      result.extensionVersion = manifest.version;
      result.extensionName = manifest.name;

      if (manifest.manifest_version !== 3) {
        result.valid = false;
        result.errors.push(`Expected manifest_version 3, got: ${manifest.manifest_version}`);
      }

      // Check required permissions
      const requiredPermissions = ['sidePanel', 'activeTab', 'storage'];
      for (const perm of requiredPermissions) {
        if (!manifest.permissions?.includes(perm)) {
          result.warnings.push(`Recommended permission missing: ${perm}`);
        }
      }

      // Check side panel entry
      const sidePanelPath = manifest.side_panel?.default_path;
      if (!sidePanelPath || !fs.existsSync(path.join(distPath, sidePanelPath))) {
        result.valid = false;
        result.errors.push(`Side panel HTML missing or not found at: ${sidePanelPath}`);
      }

      // Check background service worker
      const serviceWorkerPath = manifest.background?.service_worker;
      if (!serviceWorkerPath || !fs.existsSync(path.join(distPath, serviceWorkerPath))) {
        result.valid = false;
        result.errors.push(`Background service worker missing or not found at: ${serviceWorkerPath}`);
      }

      // Check icons
      if (manifest.icons) {
        for (const [size, iconRelPath] of Object.entries(manifest.icons)) {
          const iconFullPath = path.join(distPath, iconRelPath);
          if (!fs.existsSync(iconFullPath)) {
            result.warnings.push(`Icon size ${size} referenced at "${iconRelPath}" but file does not exist.`);
          }
        }
      }
    } catch (err) {
      result.valid = false;
      result.errors.push(`Invalid manifest.json: ${err.message}`);
    }
  }

  // 2. Scan dist directory for unwanted development artifacts and compute sizes
  const scanDir = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(distPath, fullPath);

      // Check for forbidden artifacts
      if (entry.name === '.git' || entry.name === '.env' || entry.name === 'node_modules') {
        result.valid = false;
        result.errors.push(`Unwanted development directory in dist: ${relPath}`);
      }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        result.warnings.push(`Uncompiled TypeScript source file found in dist: ${relPath}`);
      }

      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        result.filesCount++;
        const stat = fs.statSync(fullPath);
        result.uncompressedSizeBytes += stat.size;
      }
    }
  };

  scanDir(distPath);

  if (result.errors.length > 0) {
    result.valid = false;
  }

  return result;
}

/**
 * Packages the dist/ directory into clean installable ZIP archives:
 * 1. ASKbro-v<version>.zip (e.g. ASKbro-v1.0.0.zip)
 * 2. release.zip (convenience alias)
 *
 * @param {Object} [options]
 * @param {string} [options.distDir]
 * @param {string} [options.outputDir]
 * @param {string} [options.version]
 */
export function packageExtension(options = {}) {
  const rootDir = process.cwd();
  const distDir = options.distDir ? path.resolve(options.distDir) : path.resolve(rootDir, 'dist');
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : rootDir;

  // Determine version
  let version = options.version;
  if (!version) {
    try {
      const pkgPath = path.resolve(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      version = pkg.version || '1.0.0';
    } catch {
      version = '1.0.0';
    }
  }

  // Verify dist directory first
  const verification = verifyDistDirectory(distDir);
  if (!verification.valid) {
    throw new Error(`Package verification failed:\n- ${verification.errors.join('\n- ')}`);
  }

  const versionedZipName = `ASKbro-v${version}.zip`;
  const versionedZipPath = path.join(outputDir, versionedZipName);
  const releaseZipPath = path.join(outputDir, 'release.zip');

  // Remove existing output files if present
  if (fs.existsSync(versionedZipPath)) {
    fs.unlinkSync(versionedZipPath);
  }
  if (fs.existsSync(releaseZipPath)) {
    fs.unlinkSync(releaseZipPath);
  }

  // Create Zip
  const zip = new AdmZip();
  zip.addLocalFolder(distDir);

  // Write versioned archive
  zip.writeZip(versionedZipPath);

  // Write release.zip alias
  zip.writeZip(releaseZipPath);

  const zipStat = fs.statSync(versionedZipPath);

  return {
    versionedZipName,
    versionedZipPath,
    releaseZipPath,
    version,
    filesCount: verification.filesCount,
    uncompressedSize: verification.uncompressedSizeBytes,
    compressedSize: zipStat.size,
    verification
  };
}

/**
 * Format bytes into human-readable string
 * @param {number} bytes
 * @param {number} [decimals]
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * CLI runner
 */
export function runPackaging() {
  console.log('=====================================================');
  console.log('📦 ASKbro - AI Browser Agent: Release Packager');
  console.log('=====================================================');

  const distDir = path.resolve('dist');

  if (!fs.existsSync(distDir)) {
    console.error('❌ Error: dist/ directory does not exist.');
    console.error('👉 Please run "npm run build" first to compile the extension.');
    process.exit(1);
  }

  try {
    const result = packageExtension({ distDir });

    console.log(`\n✅ Extension verification passed: Manifest V3 compliant!`);
    console.log(`   - Name:             ${result.verification.extensionName || 'ASKbro'}`);
    console.log(`   - Version:          v${result.version}`);
    console.log(`   - Total Files:      ${result.filesCount}`);
    console.log(`   - Uncompressed:     ${formatBytes(result.uncompressedSize)}`);
    console.log(`   - Compressed ZIP:   ${formatBytes(result.compressedSize)}`);

    if (result.verification.warnings.length > 0) {
      console.log(`\n⚠️  Warnings (${result.verification.warnings.length}):`);
      for (const warning of result.verification.warnings) {
        console.log(`   - ${warning}`);
      }
    }

    console.log(`\n🎉 Packaging Complete:`);
    console.log(`   📁 Standalone Release: ${result.versionedZipPath}`);
    console.log(`   📁 Standard Release:   ${result.releaseZipPath}`);
    console.log(`\n🚀 Installation:`);
    console.log(`   1. Open Google Chrome and navigate to chrome://extensions`);
    console.log(`   2. Enable "Developer mode" in the top-right toggle`);
    console.log(`   3. Click "Load unpacked" and select your "dist" folder`);
    console.log(`      (or unzip ${result.versionedZipName} and select the unzipped folder)`);
    console.log('=====================================================\n');
  } catch (err) {
    console.error('\n❌ Packaging failed:', err.message);
    process.exit(1);
  }
}

// Auto-run if executed directly as main script
const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  runPackaging();
}
