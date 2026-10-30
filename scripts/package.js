import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const distDir = path.resolve('dist');
const outputFile = path.resolve('release.zip');

if (!fs.existsSync(distDir)) {
  console.error('Error: dist/ directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
}

const zip = new AdmZip();
zip.addLocalFolder(distDir);
zip.writeZip(outputFile);

console.log(`Successfully packaged extension to: ${outputFile}`);
