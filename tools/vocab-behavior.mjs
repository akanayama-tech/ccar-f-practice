#!/usr/bin/env node
/* 語彙モジュールの動作テスト
 *   W-1  3つのモードすべてで4択が出る
 *   W-2  正解を選べば正解になる（選択肢は data-w でなく「表示テキスト」で掴む）
 *   W-3  誤答を選べば誤答になる（W-2 が常に正解で通る抜けを塞ぐ陰性対照）
 *   W-4  習得が記録され、書き出し・読み込みで往復する
 *   W-5  単語帳の絞り込みが効く
 *   W-6  体系の例語のうち、参考（本文に出ない語）が破線で区別されている
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
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + SRC);
await page.waitForSelector('.opt');
await page.click('#t-vocab');
await page.waitForSelector('.vnav');
console.log(`対象 ${SRC}\n`);

/* いま出ている設問の「正解の表示テキスト」を、data-w を見ずに求める */
async function drillState() {
  return page.evaluate(() => {
    const d = state.vdrill;
    const byW = w => VOCAB.words.find(x => x.w === w);
    const t = byW(d.w);
    const label = w => (d.mode === 'e2j' ? byW(w).ja : byW(w).w);
    return {
      mode: d.mode, n: d.opts.length,
      correctText: label(d.w),
      wrongTexts: d.opts.filter(w => w !== d.w).map(label),
      shown: [...document.querySelectorAll('.dopt span:last-child')].map(e => e.textContent.trim())
    };
  });
}
async function clickByText(t) {
  const n = await page.evaluate(want => {
    const bs = [...document.querySelectorAll('.dopt')];
    const hit = bs.find(b => b.querySelector('span:last-child').textContent.trim() === want);
    if (!hit) return -1;
    hit.click(); return bs.indexOf(hit);
  }, t);
  if (n < 0) throw new Error('表示テキストで選択肢が見つからない: ' + t);
}

await junkAt('語彙・体系');
await page.click('.vnav button[data-v="drill"]');
await page.waitForSelector('.dcard');
await junkAt('語彙・ドリル');

/* ---- W-1  3モードで4択 ---- */
const modeInfo = [];
for (const m of ['e2j', 'j2e', 'cloze']) {
  await page.click(`.dmode button[data-m="${m}"]`);
  await page.waitForSelector('.dopt');
  const s = await drillState();
  modeInfo.push(`${m}:${s.n}`);
}
ok('W-1', '3モードとも4択が出る    ', modeInfo.every(x => x.endsWith(':4')), modeInfo.join(' '));

/* ---- W-2  正解を選べば正解 ---- */
let good = 0;
for (const m of ['e2j', 'j2e', 'cloze']) {
  await page.click(`.dmode button[data-m="${m}"]`);
  await page.waitForSelector('.dopt');
  for (let i = 0; i < 4; i++) {
    const s = await drillState();
    await clickByText(s.correctText);
    await page.waitForSelector('.stamp');
    if ((await page.textContent('.stamp')).trim() === '正解') good++;
    await page.click('#vnext');
    await page.waitForSelector('.dopt:not([disabled])');
  }
}
ok('W-2', '正解を選べば必ず正解    ', good === 12, `${good}/12`);

/* ---- W-3  誤答を選べば誤答。
       画面の表示だけでなく履歴も見る。表示と記録を別々に計算していると、
       画面は正しいのに記録だけ壊れる状態が通ってしまう（実際に踏んだ）。 ---- */
let bad = 0, histBad = 0;
for (let i = 0; i < 8; i++) {
  const s = await drillState();
  const w = await page.evaluate(() => state.vdrill.w);
  const prev = await page.evaluate(k => (state.vhist[k] || { ng: 0 }).ng, w);
  await clickByText(s.wrongTexts[0]);
  await page.waitForSelector('.stamp');
  if ((await page.textContent('.stamp')).trim() === '不正解') bad++;
  const now = await page.evaluate(k => state.vhist[k], w);
  if (now.ng === prev + 1 && now.streak === 0) histBad++;
  await page.click('#vnext');
  await page.waitForSelector('.dopt:not([disabled])');
}
ok('W-3', '誤答を選べば必ず誤答    ', bad === 8, `画面 ${bad}/8`);
ok('W-3b', '誤答が履歴にも記録される', histBad === 8, `履歴 ${histBad}/8（誤答数+1 かつ連続0）`);

/* ---- W-4  習得の記録と、書き出し・読み込みの往復 ---- */
const before = await page.evaluate(() => Object.keys(state.vhist).length);
const json = await page.evaluate(() => JSON.stringify(snapshot()));
const restored = await page.evaluate(j => {
  state.vhist = {}; loadInto(JSON.parse(j)); return Object.keys(state.vhist).length;
}, json);
ok('W-4', '習得が保存され往復する  ', before > 0 && restored === before, `記録 ${before} 語 → 復元 ${restored} 語`);

/* ---- W-5  単語帳の絞り込み ---- */
await page.click('.vnav button[data-v="dict"]');
await page.waitForSelector('.wcard');
await junkAt('語彙・単語帳');
const all = await page.evaluate(() => document.querySelectorAll('.wcard').length);
await page.fill('#vq', 'deterministic');
await page.waitForTimeout(120);
const filtered = await page.evaluate(() => document.querySelectorAll('.wcard').length);
ok('W-5', '単語帳の絞り込みが効く  ', all > 50 && filtered >= 1 && filtered < 5, `全 ${all} → 絞込 ${filtered}`);

/* ---- W-6  参考語が区別されている ---- */
await page.click('.vnav button[data-v="sys"]');
await page.waitForSelector('.afx');
const chips = await page.evaluate(() => ({
  total: document.querySelectorAll('.chip').length,
  ref: document.querySelectorAll('.chip.ref').length
}));
ok('W-6', '参考語が破線で分かれる  ', chips.ref > 0 && chips.ref < chips.total, `参考 ${chips.ref} / 全 ${chips.total}`);


ok('W-U', '画面に undefined 等が無い', junkSeen.length === 0, junkSeen.slice(0, 2).join(' | '));
ok('W-0', 'JS エラーが出ていない   ', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close();
console.log(`\n合格 ${pass} / 不合格 ${fail}\n`);
process.exitCode = fail === 0 ? 0 : 1;
