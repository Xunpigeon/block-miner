import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, 'src');
const artDir = join(here, 'art');

const order = ['00-art', '01-config', '02-core', '03-grid', '04-tools', '05-drops', '06-fx', '06-juice', '07-audio', '08-ui', '09-main'];

const files = readdirSync(srcDir).filter(f => f.endsWith('.js'));
const known = files.filter(f => order.some(o => f.startsWith(o))).sort((a, b) => order.findIndex(o => a.startsWith(o)) - order.findIndex(o => b.startsWith(o)));
const unknown = files.filter(f => !known.includes(f));
if (unknown.length) console.warn('WARN: 未纳入拼接顺序（已忽略）: ' + unknown.join(', '));
const missing = order.filter(o => !files.some(f => f.startsWith(o)));
if (missing.length) { console.error('ERROR: 缺少模块: ' + missing.join(', ')); process.exit(1); }

// ---- 资产内联：art/manifest.json -> window.BM_ART_SRC + CSS 变量 ----
function dataUrl(rel) {
  const p = join(here, rel);
  if (!existsSync(p)) { console.warn('WARN: manifest 文件不存在: ' + rel); return null; }
  return 'data:image/png;base64,' + readFileSync(p).toString('base64');
}
const artSrc = {};
const cssVars = [];
let artBytes = 0;
const manifestPath = join(artDir, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const [key, val] of Object.entries(manifest)) {
    const list = Array.isArray(val) ? val : [val];
    const urls = list.map(dataUrl).filter(Boolean);
    if (!urls.length) continue;
    artBytes += urls.reduce((s, u) => s + u.length, 0);
    artSrc[key] = urls.length === 1 ? urls[0] : urls;
    if (key.startsWith('ui.') || key.startsWith('logo.')) {
      cssVars.push('  --art-' + key.replace(/\./g, '-') + ': url("' + urls[0] + '");');
    }
  }
}
console.log('内联资产: ' + Object.keys(artSrc).length + ' 键 / base64 ' + (artBytes / 1024).toFixed(0) + 'KB');

let js = 'window.BM_ART_SRC = ' + JSON.stringify(artSrc) + ';\n';
for (const f of known) {
  const body = readFileSync(join(srcDir, f), 'utf8');
  js += '\n/* ===== ' + f + ' ===== */\n' + body.replace(/^export\s+/gm, '').replace(/\bexport\s+(default\s+)?/g, '') + '\n';
}
const cssPath = join(srcDir, 'style.css');
const css = (existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : '') + '\n\n:root {\n' + cssVars.join('\n') + '\n}\n';

if (/<link[^>]+href=["']https?:/.test(js + css)) {
  console.error('ERROR: 检测到外部资源引用，单文件交付被破坏');
  process.exit(1);
}

const tpl = readFileSync(join(here, 'index.template.html'), 'utf8');
const out = tpl.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
writeFileSync(join(here, 'index.html'), out, 'utf8');
console.log('built index.html ' + (out.length / 1024).toFixed(0) + 'KB, ' + known.length + ' modules');
