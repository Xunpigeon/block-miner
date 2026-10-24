import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = join(root, 'shots');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cases = [
  { name: 'camp', hash: '', budget: 2500, w: 430, h: 932 },
  { name: 'mine', hash: '#auto', budget: 4000, w: 430, h: 932 },
  { name: 'mine-desktop', hash: '#auto', budget: 4000, w: 900, h: 1000 }
];

for (const c of cases) {
  const out = join(outDir, c.name + '.png');
  const url = pathToFileURL(join(root, 'index.html')).href + c.hash;
  try {
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--window-size=' + c.w + ',' + c.h,
      '--screenshot=' + out,
      '--virtual-time-budget=' + c.budget,
      '--allow-file-access-from-files',
      '--user-data-dir=' + join(outDir, '_profile'),
      url
    ], { stdio: 'ignore', timeout: 60000 });
    console.log('shot ' + c.name + ' -> ' + out);
  } catch (e) {
    console.error('shot ' + c.name + ' FAILED: ' + e.message);
  }
}
