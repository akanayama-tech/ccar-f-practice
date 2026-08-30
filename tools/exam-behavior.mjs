#!/usr/bin/env node
/* 模擬試験モードの動作テスト
 *   X-1  模試A を選ぶと 60問になる
 *   X-2  模試B も 60問で、A と1問も重ならない
 *   X-3  模試C も 60問で、シナリオがちょうど4つ
 *   X-4  3本ともドメイン本数がブループリントどおり
 *   X-5  全問正解なら 1000点 PASS
 *   X-6  全問誤答なら 0点 FAIL（X-5 が「常に合格」で通る抜けを塞ぐ陰性対照）
 *   X-7  タイマーが 120:00 になる
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PLAYWRIGHT_PATH || '/Users/Shared/os/.claude/skills/ui-walk/node_modules/playwright/index.js';
if (!existsSync(PW)) { console.error('playwright が無い: ' + PW); process.exit(2); }
const pw = await import(PW);
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const srcArg = process.argv.indexOf('--src');
const SRC = srcArg >= 0 ? process.argv[srcArg + 1] : join(ROOT, 'index.html');

let pass = 0, fail = 0;
const ok = (c, l, cond, d = '') => { if (cond) { pass++; console.log(`  ${c} ${l}  OK ${d}`); } else { fail++; console.log(`  ${c} ${l}  NG ${d}`); } };


/* 画面に undefined / NaN / [object Object] が出ていないか。
   1つの状態でしか見ないと、その状態でしか出ない欠陥を捉えられない（実際に踏んだ）。
   場面ごとに呼んで貯め、最後にまとめて判定する。 */
const junkSeen = [];
async function junkAt(where) {
  const hit = await page.evaluate(() => {
    const t = document.body.innerText;
    return ['undefined', 'NaN', '[object Object]'].filter(k => t.includes(k));
  });
  if (hit.length) junkSeen.push(where + ': ' + hit.join(' '));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto('file://' + SRC);
await page.waitForSelector('.opt');
console.log(`対象 ${SRC}\n`);

async function pickExam(v) {
  await page.selectOption('#examsel', v);
  await page.waitForTimeout(120);
  return page.evaluate(() => {
    const qs = pool();
    const dd = {}, ss = {};
    qs.forEach(q => { dd[q.d] = (dd[q.d] || 0) + 1; ss[q.s] = (ss[q.s] || 0) + 1; });
    return { n: qs.length, ids: qs.map(q => q.id), dd, ss,
      clockText: document.getElementById('g-clock').textContent,
      clockSec: state.timer.left };
  });
}

const A = await pickExam('exam:A');
const B = await pickExam('exam:B');
const C = await pickExam('exam:C');

ok('X-1', '模試A が60問            ', A.n === 60, `${A.n}問`);
ok('X-2', '模試B が60問・Aと重複なし', B.n === 60 && A.ids.filter(i => B.ids.includes(i)).length === 0,
  `${B.n}問 重複 ${A.ids.filter(i => B.ids.includes(i)).length}`);
ok('X-3', '模試C が60問・シナリオ4つ', C.n === 60 && Object.keys(C.ss).length === 4,
  `${C.n}問 シナリオ ${Object.keys(C.ss).length}種`);
const want = { 1: 16, 2: 11, 3: 12, 4: 12, 5: 9 };
const bp = d => [1, 2, 3, 4, 5].every(k => d[k] === want[k]);
ok('X-4', 'ドメイン本数が比率どおり', bp(A.dd) && bp(B.dd) && bp(C.dd),
  `A ${JSON.stringify(A.dd)}`);
// 表示は 2:00:00 と h:mm:ss で出る。見るのは秒数の方（7200秒 = 120分）
ok('X-7', '持ち時間が120分         ', A.clockSec === 7200, `${A.clockSec}秒 表示 "${A.clockText}"`);

/* 全問正解 → 1000点 PASS */
async function answerAll(correct) {
  await page.selectOption('#examsel', 'exam:A');
  await page.waitForTimeout(120);
  await page.evaluate(kind => {
    // 実際の submit() を通す。state を直接書かない
    const qs = pool();
    for (const q of qs) {
      const wrong = q.keys.filter(k => q.ans.indexOf(k) < 0);
      const picks = kind === 'correct' ? q.ans.slice() : wrong.slice(0, q.ans.length);
      state.picked[q.id] = picks;
      submit(q);
    }
  }, correct ? 'correct' : 'wrong');
  await page.click('#t-result');
  await page.waitForSelector('.examcard');
  await junkAt('模試の結果カード');
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('.examcard .cell')];
    const score = cells.find(c => c.querySelector('.cl').textContent === 'Score');
    return {
      score: score ? score.querySelector('.cv').textContent.replace(/\/1000.*/, '').trim() : null,
      badge: document.querySelector('.examcard .verdict-badge')?.textContent.trim() || null
    };
  });
}
const good = await answerAll(true);
ok('X-5', '全問正解で 1000点 PASS  ', good.score === '1000' && good.badge === 'PASS', `${good.score} / ${good.badge}`);

await page.click('#t-reset');
await page.waitForTimeout(100);
const yes = await page.$('#cok'); if (yes) { await yes.click(); await page.waitForTimeout(200); }
const bad = await answerAll(false);
ok('X-6', '全問誤答で 0点 FAIL     ', bad.score === '0' && bad.badge === 'FAIL', `${bad.score} / ${bad.badge}`);


ok('X-U', '画面に undefined 等が無い', junkSeen.length === 0, junkSeen.slice(0, 2).join(' | '));
ok('X-0', 'JS エラーが出ていない   ', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\n合格 ${pass} / 不合格 ${fail}\n`);
process.exitCode = fail === 0 ? 0 : 1;
