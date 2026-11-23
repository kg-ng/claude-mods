import fs from 'fs';
import path from 'path';

const BOARD_FILE = '.claude/operator-board/board.json';

function clean() {
  if (fs.existsSync(BOARD_FILE)) {
    console.log(`Cleaning ${BOARD_FILE}...`);
    fs.unlinkSync(BOARD_FILE);
  }
}

clean();
console.log('Workspace cleaned.');
