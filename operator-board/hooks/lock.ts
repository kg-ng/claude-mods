import fs from 'fs';
import path from 'path';

const BOARD_FILE = '.claude/operator-board/board.json';
const LOCK_FILE = `${BOARD_FILE}.lock`;

export async function acquireLock() {
  const startTime = Date.now();
  while (fs.existsSync(LOCK_FILE)) {
    // Simple check: if lock is too old (e.g., > 30s), assume crash and delete
    const stats = fs.statSync(LOCK_FILE);
    if (Date.now() - stats.mtimeMs > 30000) {
      fs.unlinkSync(LOCK_FILE);
    } else {
      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  fs.writeFileSync(LOCK_FILE, Date.now().toString());
}

export async function releaseLock() {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}
