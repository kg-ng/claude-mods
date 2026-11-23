import { registry } from '../core/registry';
import assert from 'assert';

const mods = registry.listMods();
console.log(`Total mods registered: ${mods.length}`);
mods.forEach(m => {
  console.log(`- ${m.id}: ${m.name} (${m.version})`);
});

assert.strictEqual(mods.length, 7, 'Should have 7 mods registered');
