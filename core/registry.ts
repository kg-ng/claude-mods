import fs from 'fs';
import path from 'path';
import { ModMetadata, ModType } from './types.js';

export class ModRegistry {
  private mods: Map<string, ModMetadata> = new Map();
  private modDirs: string[] = [
    'operator-board',
    'guard',
    'diff-cards',
    'turn-meter',
    'chimes',
    'focus',
    'persona'
  ];

  constructor() {
    // Pre-load them
    for (const dir of this.modDirs) {
      const metadataPath = path.join(process.cwd(), dir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          this.mods.set(data.id, data);
        } catch (e) {
          console.error(`Failed to load metadata for ${dir}`, e);
        }
      }
    }
  }

  register(metadata: ModMetadata) {
    this.mods.set(metadata.id, metadata);
  }

  getMod(id: string) {
    return this.mods.get(id);
  }

  listMods() {
    return Array.from(this.mods.values());
  }
}

export const registry = new ModRegistry();
