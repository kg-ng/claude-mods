import fs from 'fs';
import path from 'path';
import { ModRegistry } from '../core/registry.js';
import { ModMetadata } from '../core/types.js';

const registry = new ModRegistry();

const modDirs = [
  'operator-board',
  'guard',
  'diff-cards',
  'turn-meter',
  'chimes',
  'focus',
  'persona'
];

for (const dir of modDirs) {
  const metadataPath = path.join(__dirname, '..', dir, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    const data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    registry.register(data as ModMetadata);
    console.log(`Registered: ${data.name} (${data.version})`);
  }
}

console.log('All mods registered:', registry.listMods().map(m => m.name));
