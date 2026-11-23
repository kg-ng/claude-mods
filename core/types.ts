export type ModType = 'pane' | 'status-line' | 'hook' | 'tool' | 'utility';

export interface ModMetadata {
  id: string;
  name: string;
  version: string;
  type: ModType;
  description: string;
  entryPoint: string;
  dependencies?: string[];
  isDev?: boolean;
  testPath?: string;
}

export interface ModRegistry {
  mods: Map<string, ModMetadata>;
  register(metadata: ModMetadata): void;
  getMod(id: string): ModMetadata | undefined;
  listMods(): ModMetadata[];
}

export const registry: ModRegistry = {
  mods: new Map(),
  register(metadata: ModMetadata) {
    this.mods.set(metadata.id, metadata);
  },
  getMod(id: string) {
    return this.mods.get(id);
  },
  listMods() {
    return Array.from(this.mods.values());
  },
};
