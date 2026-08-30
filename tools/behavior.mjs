#!/usr/bin/env node
/* 選択肢シャッフルの動作テスト
 *
 * 型チェックも構文チェックも「並びを変えても採点が変わらないこと」を保証しない。
 * ここだけは実際にブラウザで押して確かめる。
 *
 *   S-1  並びが実際に変わる（同じ問題を解き直すと順序が変わる）
 *   S-2  選択肢の集合は変わらない（中身が増減・重複していない）
 *   S-3  並びが変わっても正解を選べば正解と判定される  ← これが本丸
 *   S-4  誤答を選べば誤答と判定される（S-3 が「常に正解」で通る抜けを塞ぐ）
 *   S-5  画面の記号は上から A B C D で、飛びも重複もない
 *   S-6  キーボードの 1 が一番上の選択肢を選ぶ
 *
 * 使い方  node tools/behavior.mjs [--headed]
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PW = process.env.PLAYWRIGHT_PATH
  || '/Users/Shared/os/.claude/skills/ui-walk/node_modules/playwright/index.js';
if (!existsSync(PW)) {
  console.error(`playwright が見つからない: ${PW}\n環境変数 PLAYWRIGHT_PATH で場所を指定してください`);
  process.exit(2);
}
const pw = await import(PW);                       // CommonJS なので default 経由になることがある
const chromium = pw.chromium || (pw.default && pw.default.chromium);
if (!chromium) { console.error('playwright の chromium を取り出せない'); process.exit(2); }

const srcArg = process.argv.indexOf('--src');
const SRC = srcArg >= 0 ? process.argv[srcArg + 1] : join(ROOT, 'index.html');
const URL = 'file://' + SRC;
const HEADED = process.argv.includes('--headed');

let pass = 0, fail = 0;
function ok(code, label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ${code} ${label}  OK ${detail}`); }
  else { fail++; console.log(`  ${code} ${label}  NG ${detail}`); }
}

console.log(`対象ファイル ${SRC}`);
const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL);
await page.waitForSelector('.opt');

/* 画面から今の問題の状態を読む */
async function snap() {
  return page.evaluate(() => {
    const idText = document.querySelector('.qid')?.textContent || '';
    const id = idText.replace(/^Q\s*/, '').trim();
    const opts = [...document.querySelectorAll('.opt')].map(b => ({
      canonical: b.dataset.k,
      shown: b.querySelector('.key')?.textContent || '',
      text: (b.querySelector('.txt')?.childNodes[0]?.textContent || '').trim()
    }));
    const q = (typeof BANK !== 'undefined') ? BANK.find(x => x.id === id) : null;
    // 正解を「本文」で押さえる。data-k はアプリ側の記号なので、
    // 記号の取り違えバグを検出したいこのテストでは基準に使えない
    const strip = t => String(t).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const ansText = q ? q.ans.map(k => strip(q.en.opts[k])) : null;
    const wrongText = q ? Object.keys(q.en.opts).filter(k => !q.ans.includes(k)).map(k => strip(q.en.opts[k])) : null;
    return { id, opts, ans: q ? q.ans : null, ansText, wrongText, type: q ? q.type : null };
  });
}

/* 本文で選択肢を押す。記号を一切見ないので、記号の取り違えがそのまま点数に出る */
async function clickByText(t) {
  const norm = t.replace(/\s+/g, ' ').trim();
  const n = await page.evaluate(want => {
    const btns = [...document.querySelectorAll('.opt')];
    const hit = btns.find(b => (b.querySelector('.txt')?.childNodes[0]?.textContent || '').replace(/\s+/g, ' ').trim() === want);
    if (!hit) return -1;
    hit.click();
    return btns.indexOf(hit);
  }, norm);
  if (n < 0) throw new Error('本文で選択肢を見つけられない: ' + norm.slice(0, 50));
  return n;
}

const first = await snap();
console.log(`\n対象 Q ${first.id}  正解 ${first.ans?.join(',')}  種別 ${first.type}\n`);

/* ---- S-1 / S-2 / S-5  並びを10回引き直して見る ---- */
const orders = new Set();
const sigs = new Set();
let letterOk = true;
for (let i = 0; i < 10; i++) {
  const s = await snap();
  orders.add(s.opts.map(o => o.text.slice(0, 24)).join('|'));
  sigs.add(s.opts.map(o => o.text.slice(0, 24)).slice().sort().join('|'));
  const shown = s.opts.map(o => o.shown).join('');
  if (shown !== 'ABCDE'.slice(0, s.opts.length)) letterOk = false;
  // 解いて、もう一度解くと並びが引き直される
  for (const t of s.ansText) await clickByText(t);
  await page.click('#submit');
  await page.waitForSelector('#again');
  await page.click('#again');
  await page.waitForSelector('#submit');
}
ok('S-1', '並びが実際に変わる          ', orders.size > 1, `10回で ${orders.size} 通りの順序`);
ok('S-2', '選択肢の集合は変わらない    ', sigs.size === 1, `集合の種類 ${sigs.size}（1であるべき）`);
ok('S-5', '記号は上から A B C D        ', letterOk);

/* ---- S-3  並びが変わっても、正解を選べば正解になる ---- */
let correctRuns = 0;
for (let i = 0; i < 8; i++) {
  const s = await snap();
  for (const t of s.ansText) await clickByText(t);
  await page.click('#submit');
  const stamp = (await page.textContent('.stamp'))?.trim();
  if (stamp === 'CORRECT' || stamp === '正解') correctRuns++;
  await page.click('#again');
  await page.waitForSelector('#submit');
}
ok('S-3', '正解を選べば必ず正解        ', correctRuns === 8, `${correctRuns}/8`);

/* ---- S-4  誤答を選べば誤答になる（S-3 の抜けを塞ぐ陰性対照） ---- */
let wrongRuns = 0;
for (let i = 0; i < 8; i++) {
  const s = await snap();
  for (const t of s.wrongText.slice(0, s.ans.length)) await clickByText(t);
  await page.click('#submit');
  const stamp = (await page.textContent('.stamp'))?.trim();
  if (stamp === 'INCORRECT' || stamp === '不正解') wrongRuns++;
  await page.click('#again');
  await page.waitForSelector('#submit');
}
ok('S-4', '誤答を選べば必ず誤答        ', wrongRuns === 8, `${wrongRuns}/8`);

/* ---- S-6  キーボードの 1 が一番上を選ぶ ---- */
const before = await snap();
await page.keyboard.press('1');
const selectedText = await page.evaluate(() => {
  const b = document.querySelector('.opt[aria-pressed="true"]');
  return b ? (b.querySelector('.txt')?.childNodes[0]?.textContent || '').trim() : null;
});
ok('S-6', 'キーボード 1 が一番上を選ぶ ', selectedText === before.opts[0].text,
  `押した本文 "${(selectedText || '').slice(0, 28)}…" / 一番上 "${before.opts[0].text.slice(0, 28)}…"`);

/* ---- 画面のエラー ---- */
ok('S-0', 'JS エラーが出ていない       ', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\n合格 ${pass} / 不合格 ${fail}\n`);
process.exitCode = fail === 0 ? 0 : 1;
