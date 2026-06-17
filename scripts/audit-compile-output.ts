/**
 * Audits a Conchitect compile output folder and reports missing or zero-byte files.
 *
 * Usage:
 *   npx tsx scripts/audit-compile-output.ts "C:\path\to\output"
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[2m';

function ok(label: string)    { return `${GREEN}✅${RESET} ${label}`; }
function fail(label: string)  { return `${RED}❌ ${label}   MISSING${RESET}`; }
function warn(label: string)  { return `${YELLOW}⚠️  ${label}   EMPTY (0 bytes)${RESET}`; }

function checkFile(outputDir: string, rel: string): 'ok' | 'missing' | 'empty' {
  const full = path.join(outputDir, rel);
  try {
    const stat = fs.statSync(full);
    return stat.size === 0 ? 'empty' : 'ok';
  } catch {
    return 'missing';
  }
}

function checkDir(outputDir: string, rel: string): number {
  const full = path.join(outputDir, rel);
  try {
    return fs.readdirSync(full).length;
  } catch {
    return -1;
  }
}

// Given the cube URL template from tour.xml, synthesize a concrete sample path.
// Returns null if the URL is the old single-cube format (pano_%s.jpg) or unparseable.
function sampleTilePath(urlTemplate: string): string | null {
  if (urlTemplate.includes('pano_%s')) return null; // old format
  // Substitute %s=f, %v=1, %h=1
  return urlTemplate.replace(/%s/g, 'f').replace(/%v/g, '1').replace(/%h/g, '1');
}

async function main() {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error('Usage: npx tsx scripts/audit-compile-output.ts <output-folder>');
    process.exit(1);
  }

  if (!fs.existsSync(outputDir)) {
    console.error(`Folder not found: ${outputDir}`);
    process.exit(1);
  }

  const divider = '─'.repeat(60);
  console.log(`\nCompile output audit: ${outputDir}`);
  console.log(divider);

  // --- Static required files ---
  const staticFiles = [
    'index.html',
    'tour.xml',
    'skin/vtourskin.xml',
    'krpano/krpano.js',
    'krpano/plugins/webvr.xml',
    'krpano/plugins/webvr.js',
    'krpano/plugins/gyro2.js',
  ];

  let missing = 0;

  for (const rel of staticFiles) {
    const result = checkFile(outputDir, rel);
    if (result === 'ok')      console.log(ok(rel));
    else if (result === 'empty') { console.log(warn(rel)); missing++; }
    else                      { console.log(fail(rel)); missing++; }
  }

  // --- Optional but expected ---
  const licenseResult = checkFile(outputDir, 'krpano/krpanolicense.xml');
  if (licenseResult === 'ok') {
    console.log(ok('krpano/krpanolicense.xml'));
  } else {
    console.log(`${DIM}⬜ krpano/krpanolicense.xml   (optional — only if license copied)${RESET}`);
  }

  // --- Per-scene pano tiles (parsed from tour.xml) ---
  const tourXmlPath = path.join(outputDir, 'tour.xml');
  let tourXmlContent = '';
  let sceneNames: string[] = [];
  if (fs.existsSync(tourXmlPath)) {
    try {
      tourXmlContent = fs.readFileSync(tourXmlPath, 'utf8');
      const matches = [...tourXmlContent.matchAll(/<scene\s+name="([^"]+)"/g)];
      sceneNames = matches.map(m => m[1]);
    } catch {
      console.log(`${YELLOW}Could not parse tour.xml for scene names${RESET}`);
    }
  }

  for (const name of sceneNames) {
    const slug = name.replace(/^scene_/, '');
    const tileDir = `panos/${slug}.tiles`;
    const previewRel = `${tileDir}/preview.jpg`;
    const dirCount = checkDir(outputDir, tileDir);

    if (dirCount < 0) {
      console.log(fail(tileDir + '/  (tiles directory)'));
      missing++;
      continue;
    }
    if (dirCount === 0) {
      console.log(warn(tileDir + '/  (tiles directory empty)'));
      missing++;
      continue;
    }

    const previewResult = checkFile(outputDir, previewRel);
    if (previewResult === 'ok') {
      console.log(ok(`${previewRel}`));
    } else {
      console.log(warn(`${tileDir}/  (${dirCount} entries but preview.jpg missing)`));
      missing++;
    }

    // Extract cube URL for this scene from tour.xml and verify the format + a sample tile
    const sceneBlock = tourXmlContent.match(
      new RegExp(`<scene\\s+name="${name}"[\\s\\S]*?</scene>`)
    );
    const cubeUrlMatch = sceneBlock?.[0]?.match(/<cube\s+url="([^"]+)"/);
    const cubeUrl = cubeUrlMatch?.[1] ?? null;

    if (!cubeUrl) {
      console.log(`${YELLOW}⚠️  ${slug}: no <cube url> found in tour.xml${RESET}`);
    } else if (cubeUrl.includes('pano_%s')) {
      console.log(`${RED}❌ ${slug}: tour.xml still uses old single-cube format (pano_%s.jpg) — tiles won't load${RESET}`);
      missing++;
    } else {
      // New multires format — verify a concrete tile exists
      const sample = sampleTilePath(cubeUrl);
      if (sample) {
        const tileResult = checkFile(outputDir, sample);
        if (tileResult === 'ok') {
          console.log(ok(`${sample}  (sample tile)`));
        } else {
          console.log(fail(`${sample}  (sample tile from tour.xml URL)`));
          missing++;
        }
      }
    }
  }

  if (sceneNames.length === 0) {
    console.log(`${YELLOW}No scenes found in tour.xml — skipping tile checks${RESET}`);
  }

  console.log(divider);

  if (missing === 0) {
    console.log(`${GREEN}Result: all expected files present. Tour should load correctly.${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`${RED}Result: ${missing} expected file(s) missing. Tour will fail to load.${RESET}\n`);
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
