import { readFileSync, writeFileSync } from 'node:fs';
let c = readFileSync('src/01-config.js', 'utf8');
let n = 0;
// 1) desc 只留功能：去掉「链上第 i/N 个：」前缀与「（本节点 …）」括注
const old = "          desc: '链上第 ' + i + '/' + ch.count + ' 个：' + ch.harm +\n            (ch.steps ? '（本节点 ' + ch.steps[i - 1] + '）' : '')";
const neu = "          desc: ch.harm";
if (c.indexOf(old) >= 0) { c = c.replace(old, neu); n++; } else console.log('WARN desc 块未匹配');
// 2) 文案里的「白给」等口语化黑话清理
c = c.split('白给').join('自动掉落');
c = c.split('白掉').join('掉落');
c = c.split('链上第 ').join('第 ');
writeFileSync('src/01-config.js', c, 'utf8');
console.log('patched', n);