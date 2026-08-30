#!/usr/bin/env node
/* CCAR-F 練習問題の検査器
 *
 * 見るのは5つ。どれも「分母つき」で出す。
 *   L-1  選択肢の長さ   正解が全誤答より長い問題を落とす（本番は全選択肢が同程度の長さ）
 *   L-2  長さの散らばり 最長と最短の比が閾値を超える問題を拾う
 *   N-1  解説の分解     選択肢ごとの解説 nos がそろっているか
 *   X-1  記号の残留     分解済みの解説に選択肢の記号が残っていないか
 *   E-1  模試           ブループリント本数どおりか、模試どうしが重ならないか
 *
 * 使い方
 *   node tools/check.mjs              検査する
 *   node tools/check.mjs --verbose    落ちた問題を全部並べる
 *   node tools/check.mjs --derive     非重複の模試2本を導出して出す（Phase 1 用）
 *   node tools/check.mjs --selftest   検査器をわざと壊して赤が出ることを確かめる
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'index.html');

const ARGV = process.argv.slice(2);
const VERBOSE = ARGV.includes('--verbose');
const DERIVE = ARGV.includes('--derive');
const SELFTEST = ARGV.includes('--selftest');

/* ---------- 閾値 ---------- */
const SPREAD_MAX = 2.0;          // 1問の中で 最長 / 最短 がこれを超えたら拾う
/* 長さの手がかりは「目で見て分かる差」があって初めて成立する。
   150字の選択肢で13字の差は誰も気づかない。一方、188字 対 104字（元の欠陥）は一目で分かる。
   なので L-1 / L-3 は 15% の余裕を持たせて判定し、厳密値（余裕ゼロ）も併記する。
   余裕を入れたのは判定を甘くするためではなく、知覚できない差で赤を出して
   検知器がオオカミ少年になるのを避けるため。両方の数字を出すので隠れない。 */
const MARGIN = 1.15;
const BLUEPRINT = { 1: 27, 2: 18, 3: 20, 4: 20, 5: 15 };
const EXAM_N = { 1: 16, 2: 11, 3: 12, 4: 12, 5: 9 };   // 合計 60

/* ---------- index.html から実データを取り出す ---------- */
function extractArray(lines, name) {
  const head = lines.findIndex(l => l.startsWith(`const ${name} = [`));
  if (head < 0) return null;
  let end = -1;
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i] === '];') { end = i; break; }
  }
  if (end < 0) throw new Error(`${name} の終端 "];" が見つからない`);
  const body = lines.slice(head, end + 1).join('\n').replace(`const ${name} = `, '');
  return new Function(`return ${body}`)();
}

function loadBank(htmlText) {
  const lines = htmlText.split('\n');
  const purcell = extractArray(lines, 'QUESTIONS');
  const gh = extractArray(lines, 'GH');
  if (!purcell || !gh) throw new Error('QUESTIONS / GH を index.html から取り出せない');
  const exams = extractArray(lines, 'EXAMS');   // Phase 1 で入る。無ければ null
  const combosLine = lines.find(l => l.startsWith('const EXAM_COMBOS = '));
  globalThis.__EXAM_COMBOS = combosLine
    ? new Function('return ' + combosLine.replace('const EXAM_COMBOS = ', '').replace(/;\s*$/, ''))()
    : null;
  return {
    bank: [
      ...purcell.map(q => ({ ...q, set: 'purcell' })),
      ...gh.map(q => ({ ...q, set: 'gh' }))
    ],
    exams
  };
}

const plain = s => String(s).replace(/<[^>]+>/g, '');
const len = s => plain(s).length;

/* ---------- L-1 / L-2  選択肢の長さ ---------- */
const maxC = (q, opts) => Math.max(...q.ans.map(k => len(opts[k])));
function checkLength(bank) {
  const out = { code: 'L-1', pass: {}, fail: [], spread: [], tooShort: [], tooShortStrict: 0 };
  for (const lang of ['en', 'ja']) {
    let ok = 0, okMargin = 0, strictBad = 0;
    for (const q of bank) {
      const opts = q[lang].opts;
      const keys = Object.keys(opts);
      const correct = q.ans.map(k => len(opts[k]));
      const wrong = keys.filter(k => !q.ans.includes(k)).map(k => len(opts[k]));
      if (!wrong.length) continue;
      const minC = Math.min(...correct);
      const maxW = Math.max(...wrong);
      // 肯定形。誤答のどれかが正解と同じかそれ以上の長さであること
      if (maxW >= minC) ok++; else strictBad++;
      // 判定は余裕つき。知覚できる差だけを赤にする
      if (maxW * MARGIN >= minC) okMargin++;
      else out.fail.push({ id: q.id, set: q.set, lang, correct: minC, longestWrong: maxW, gap: minC - maxW });

      const all = keys.map(k => len(opts[k]));
      const ratio = Math.max(...all) / Math.min(...all);
      if (ratio > SPREAD_MAX) out.spread.push({ id: q.id, lang, ratio: Number(ratio.toFixed(2)), min: Math.min(...all), max: Math.max(...all) });

      // L-3  逆向きの手がかり。正解だけが飛び抜けて短いと、それも読まずに当てられる。
      // L-1 は「正解が最長」しか見ないので、片側だけの検査になっていた。
      const minW = Math.min(...wrong), mc = maxC(q, opts);
      if (minW > mc) out.tooShortStrict++;
      if (minW > mc * MARGIN) out.tooShort.push({ id: q.id, lang, correct: mc, shortestWrong: minW, gap: minW - mc });
    }
    out.pass[lang] = { ok, okMargin, strictBad, total: bank.length };
  }
  out.fail.sort((a, b) => b.gap - a.gap);
  out.tooShort.sort((a, b) => b.gap - a.gap);
  return out;
}

/* ---------- N-1  選択肢ごとの解説がそろっているか ---------- */
function checkPerOption(bank) {
  const out = { code: 'N-1', done: {}, partial: [] };
  for (const lang of ['en', 'ja']) {
    let complete = 0, started = 0;
    for (const q of bank) {
      const nos = q[lang].nos;
      if (!nos) continue;
      started++;
      const keys = Object.keys(q[lang].opts);
      const missing = keys.filter(k => !nos[k] || !String(nos[k]).trim());
      if (missing.length === 0) complete++;
      else out.partial.push({ id: q.id, lang, missing });
    }
    out.done[lang] = { complete, started, total: bank.length };
  }
  return out;
}

/* ---------- X-1  分解済みの解説に選択肢の記号が残っていないか ---------- */
const LETTER_JA = /(?:^|[^A-Za-z])([A-E])[はとがも、]/;
const LETTER_EN = /(?:^|[^A-Za-z])([B-E])(?:\s+(?:and|or|is|are|fails|makes|describes|confuses|treats|misapplies|relies|assumes|adds|improves?)\b|[,.)])/;
function checkLetterRefs(bank) {
  const out = { code: 'X-1', hits: [], scanned: 0 };
  for (const lang of ['en', 'ja']) {
    const re = lang === 'ja' ? LETTER_JA : LETTER_EN;
    for (const q of bank) {
      const nos = q[lang].nos;
      if (!nos) continue;                       // 未分解は対象外（N-1 が数える）
      for (const [k, text] of Object.entries(nos)) {
        out.scanned++;
        const m = re.exec(plain(text));
        if (m) out.hits.push({ id: q.id, lang, opt: k, letter: m[1], snippet: plain(text).slice(Math.max(0, m.index - 12), m.index + 28) });
      }
    }
  }
  return out;
}

/* ---------- E-1  模試 ---------- */
function scenarioDomainMatrix(bank) {
  const M = {};
  for (const q of bank) { (M[q.s] ??= {})[q.d] = (M[q.s]?.[q.d] || 0) + 1; }
  return M;
}
function cap(M, s, d) { return M[s]?.[d] || 0; }

function combos4() {
  const r = [];
  for (let a = 1; a <= 6; a++) for (let b = a + 1; b <= 6; b++) for (let c = b + 1; c <= 6; c++) for (let d = c + 1; d <= 6; d++) r.push([a, b, c, d]);
  return r;
}
// Hall 条件。exam の集合すべてについて、使えるシナリオの容量が needs の合計以上か
function feasible(M, list) {
  const k = list.length;
  for (let d = 1; d <= 5; d++) {
    for (let mask = 1; mask < (1 << k); mask++) {
      let cnt = 0; const un = new Set();
      for (let i = 0; i < k; i++) if (mask & (1 << i)) { cnt++; list[i].forEach(s => un.add(s)); }
      let tot = 0; un.forEach(s => tot += cap(M, s, d));
      if (tot < cnt * EXAM_N[d]) return false;
    }
  }
  return true;
}

function deriveExams(bank) {
  const M = scenarioDomainMatrix(bank);
  const cbs = combos4().filter(c => feasible(M, [c]));
  const pairs = [];
  for (let i = 0; i < cbs.length; i++) for (let j = i + 1; j < cbs.length; j++) {
    if (feasible(M, [cbs[i], cbs[j]])) pairs.push([cbs[i], cbs[j]]);
  }
  return { validSingles: cbs, pairs, matrix: M };
}

// 与えられた2つのシナリオ組から、実際に重ならない60問ずつを割り当てる。
// ドメイン本数はブループリント固定。そのうえでシナリオが15問前後に散るよう均す。
// 制約のきついドメイン（引けるシナリオが少ない）から先に配らないと後半で詰む。
const SCEN_TARGET = 15;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function allocateOnce(bank, cbA, cbB, seed) {
  const rnd = mulberry32(seed);
  const takenA = new Set(), takenB = new Set();
  const countA = {}, countB = {};
  cbA.forEach(s => countA[s] = 0);
  cbB.forEach(s => countB[s] = 0);

  // ドメインごとの「引けるシナリオ数」が少ない順に処理する
  const tightness = d => {
    const inA = cbA.filter(s => bank.some(q => q.s === s && q.d === d)).length;
    const inB = cbB.filter(s => bank.some(q => q.s === s && q.d === d)).length;
    return Math.min(inA, inB);
  };
  const domains = [1, 2, 3, 4, 5].sort((x, y) => tightness(x) - tightness(y));

  for (const d of domains) {
    const need = EXAM_N[d];
    let gotA = 0, gotB = 0;
    // A と B を1問ずつ交互に。片方が共有分を食い尽くさないようにする
    while (gotA < need || gotB < need) {
      for (const side of ['A', 'B']) {
        const isA = side === 'A';
        if ((isA ? gotA : gotB) >= need) continue;
        const cb = isA ? cbA : cbB, otherCb = isA ? cbB : cbA;
        const taken = isA ? takenA : takenB, other = isA ? takenB : takenA;
        const count = isA ? countA : countB;
        const cand = bank.filter(q => q.d === d && cb.includes(q.s) && !taken.has(q.id) && !other.has(q.id));
        if (!cand.length) return null;
        cand.sort((x, y) =>
          // 自分にしか使えない問題を先に確保する（これを外すと共有分が枯れて詰む）
          (otherCb.includes(x.s) ? 1 : 0) - (otherCb.includes(y.s) ? 1 : 0) ||
          // そのうえで一番少ないシナリオから取る
          count[x.s] - count[y.s] ||
          // 複数選択を落とさない
          (x.type === 'multi' ? 0 : 1) - (y.type === 'multi' ? 0 : 1) ||
          (rnd() - 0.5)
        );
        const q = cand[0];
        taken.add(q.id); count[q.s]++;
        if (isA) gotA++; else gotB++;
      }
    }
  }
  const A = bank.filter(q => takenA.has(q.id));
  const B = bank.filter(q => takenB.has(q.id));
  if (A.length !== 60 || B.length !== 60) return null;
  const skew = c => Object.values(c).reduce((t, v) => t + Math.abs(v - SCEN_TARGET), 0);
  return { A, B, score: skew(countA) + skew(countB), countA, countB };
}

// 実行可能な割り当てを起点に、不変条件を壊さない交換だけで偏りを削る。
// 交換するのは必ず同じドメインどうしなので、ブループリント本数は動かない。
// 交換相手はA↔未使用 と A↔B の2種類。どちらも重複ゼロを保つ。
function polish(bank, cbA, cbB, alloc) {
  const idsA = new Set(alloc.A.map(q => q.id));
  const idsB = new Set(alloc.B.map(q => q.id));
  const unused = bank.filter(q => !idsA.has(q.id) && !idsB.has(q.id));
  const tally = ids => { const c = {}; bank.filter(q => ids.has(q.id)).forEach(q => c[q.s] = (c[q.s] || 0) + 1); return c; };
  const skew = c => Object.values(c).reduce((t, v) => t + Math.abs(v - SCEN_TARGET), 0);
  const score = () => skew(tally(idsA)) + skew(tally(idsB));

  let cur = score(), moved = true, guard = 0;
  while (moved && guard++ < 500) {
    moved = false;

    // A（またはB）の1問を、未使用の同ドメイン問題と入れ替える
    for (const [ids, cb] of [[idsA, cbA], [idsB, cbB]]) {
      for (const inside of bank.filter(q => ids.has(q.id))) {
        for (const out of unused) {
          if (out.d !== inside.d || !cb.includes(out.s)) continue;
          if (idsA.has(out.id) || idsB.has(out.id)) continue;
          ids.delete(inside.id); ids.add(out.id);
          const next = score();
          if (next < cur) {
            cur = next; moved = true;
            unused.splice(unused.indexOf(out), 1); unused.push(inside);
          } else { ids.add(inside.id); ids.delete(out.id); }
          if (moved) break;
        }
        if (moved) break;
      }
      if (moved) break;
    }
    if (moved) continue;

    // A と B のあいだで同ドメインの1問ずつを交換する（互いの4シナリオに入るものだけ）
    for (const a of bank.filter(q => idsA.has(q.id) && cbB.includes(q.s))) {
      for (const b of bank.filter(q => idsB.has(q.id) && cbA.includes(q.s) && q.d === a.d)) {
        idsA.delete(a.id); idsA.add(b.id);
        idsB.delete(b.id); idsB.add(a.id);
        const next = score();
        if (next < cur) { cur = next; moved = true; break; }
        idsA.add(a.id); idsA.delete(b.id);
        idsB.add(b.id); idsB.delete(a.id);
      }
      if (moved) break;
    }
  }

  const A = bank.filter(q => idsA.has(q.id));
  const B = bank.filter(q => idsB.has(q.id));
  return { A, B, score: cur, countA: tally(idsA), countB: tally(idsB) };
}

function allocate(bank, cbA, cbB) {
  let best = null;
  for (let seed = 1; seed <= 60; seed++) {
    const r = allocateOnce(bank, cbA, cbB, seed);
    if (!r) continue;
    const p = polish(bank, cbA, cbB, r);
    if (!best || p.score < best.score) best = p;
  }
  return best;
}

function checkExams(bank, exams) {
  const out = { code: 'E-1', implemented: !!exams, problems: [] };
  if (!exams) return out;                       // まだ入れていない。N-1 と同じく正直に未実装と出す
  const byId = new Map(bank.map(q => [q.id, q]));
  const seen = [];
  const M = scenarioDomainMatrix(bank);
  for (const ex of exams) {
    if (ex.draw) {
      // 抽選型。固定の ids は持たないので、代わりに抽選候補が全て比率を満たすかを見る
      const bad = (globalThis.__EXAM_COMBOS || []).filter(cb => !feasible(M, [cb]));
      if (bad.length) out.problems.push(`${ex.key}: 抽選候補に比率を満たせない組 ${bad.map(c => 'S' + c.join('+S')).join(' ')}`);
      continue;
    }
    if (!ex.ids) { out.problems.push(`${ex.key}: ids が無い`); continue; }
    const qs = ex.ids.map(id => byId.get(id));
    const missing = ex.ids.filter(id => !byId.has(id));
    if (missing.length) out.problems.push(`${ex.key}: バンクに無い ID ${missing.join(',')}`);
    if (ex.ids.length !== 60) out.problems.push(`${ex.key}: ${ex.ids.length}問（60であるべき）`);
    const dd = {};
    qs.filter(Boolean).forEach(q => dd[q.d] = (dd[q.d] || 0) + 1);
    for (let d = 1; d <= 5; d++) if ((dd[d] || 0) !== EXAM_N[d]) out.problems.push(`${ex.key}: ドメイン${d} が ${dd[d] || 0}問（${EXAM_N[d]}であるべき）`);
    const scen = new Set(qs.filter(Boolean).map(q => q.s));
    if (scen.size !== 4) out.problems.push(`${ex.key}: シナリオが ${scen.size} 種（4であるべき）`);
    seen.push({ key: ex.key, ids: new Set(ex.ids) });
  }
  for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
    if (seen[i].key === 'C' || seen[j].key === 'C') continue;   // C は抽選なので重複可
    const overlap = [...seen[i].ids].filter(id => seen[j].ids.has(id));
    if (overlap.length) out.problems.push(`${seen[i].key} と ${seen[j].key} が ${overlap.length}問 重複`);
  }
  return out;
}

/* ---------- 実行 ---------- */
function run(htmlText) {
  const { bank, exams } = loadBank(htmlText);
  const L = checkLength(bank);
  const N = checkPerOption(bank);
  const X = checkLetterRefs(bank);
  const E = checkExams(bank, exams);
  return { bank, exams, L, N, X, E };
}

function report(r) {
  const { bank, L, N, X, E } = r;
  const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
  let red = 0;

  console.log(`\n母集合  ${bank.length}問 (purcell ${bank.filter(q => q.set === 'purcell').length} / gh ${bank.filter(q => q.set === 'gh').length})`);

  console.log(`\n[L-1] 選択肢の長さ  正解が全誤答より長い問題を落とす`);
  for (const lang of ['en', 'ja']) {
    const p = L.pass[lang];
    const bad = p.total - p.okMargin;
    console.log(`  ${lang}  合格 ${p.okMargin}/${p.total} (${pct(p.okMargin, p.total)})   未修正 ${bad}` +
      `　　余裕なしの厳密値だと ${p.ok}/${p.total}（差が15%以内の ${p.strictBad} 件は知覚できないので通している）`);
    if (bad) red++;
  }
  if (L.fail.length) {
    const show = VERBOSE ? L.fail : L.fail.slice(0, 8);
    console.log(`  差の大きい順${VERBOSE ? '（全件）' : '（上位8件、--verbose で全件）'}`);
    for (const f of show) console.log(`    ${f.set.padEnd(7)} ${f.id.padEnd(5)} ${f.lang}  正解 ${String(f.correct).padStart(3)} / 最長誤答 ${String(f.longestWrong).padStart(3)}  差 +${f.gap}`);
  }

  console.log(`\n[L-2] 長さの散らばり  1問の中で 最長/最短 が ${SPREAD_MAX} を超える`);
  console.log(`  該当 ${L.spread.length} 件`);
  if (VERBOSE && L.spread.length) for (const s of L.spread.slice(0, 20)) console.log(`    ${s.id.padEnd(5)} ${s.lang}  ${s.min}〜${s.max}  比 ${s.ratio}`);

  console.log(`\n[L-3] 逆向きの手がかり  正解が全誤答より短い問題を落とす`);
  console.log(`  該当 ${L.tooShort.length} 件　　余裕なしの厳密値だと ${L.tooShortStrict} 件`);
  if (L.tooShort.length) {
    red++;
    for (const t of (VERBOSE ? L.tooShort : L.tooShort.slice(0, 8)))
      console.log(`    ${t.id.padEnd(5)} ${t.lang}  正解 ${t.correct} / 最短誤答 ${t.shortestWrong}  差 -${t.gap}`);
  }

  console.log(`\n[N-1] 選択肢ごとの解説`);
  for (const lang of ['en', 'ja']) {
    const d = N.done[lang];
    console.log(`  ${lang}  分解済み ${d.complete}/${d.total} (${pct(d.complete, d.total)})   着手のみ ${d.started - d.complete}`);
  }
  if (N.partial.length) { console.log(`  欠けあり ${N.partial.length} 件`); red++; }

  console.log(`\n[X-1] 分解済み解説に残った選択肢の記号`);
  console.log(`  走査 ${X.scanned} 本  検出 ${X.hits.length} 件`);
  if (X.hits.length) {
    red++;
    for (const h of (VERBOSE ? X.hits : X.hits.slice(0, 8))) console.log(`    ${h.id} ${h.lang} ${h.opt}  "${h.letter}"  …${h.snippet}…`);
  }

  console.log(`\n[E-1] 模擬試験`);
  if (!E.implemented) console.log(`  EXAMS 未実装。index.html に定義が無い（Phase 1 で入れる）`);
  else if (E.problems.length) { red++; E.problems.forEach(p => console.log(`  ✗ ${p}`)); }
  else {
    const fixed = (r.exams || []).filter(e => !e.draw);
    const drawn = (r.exams || []).filter(e => e.draw);
    console.log(`  固定 ${fixed.length}本（${fixed.map(e => e.label).join(' / ')}）本数・シナリオ数・重複なし をすべて満たす`);
    if (drawn.length) console.log(`  抽選 ${drawn.length}本（${drawn.map(e => e.label).join(' / ')}）候補 ${(globalThis.__EXAM_COMBOS || []).length} 通りがすべて比率を満たす`);
  }

  console.log(`\n判定  ${red === 0 ? 'すべて緑' : `赤 ${red} 項目`}\n`);
  return red;
}

/* ---------- 検査器そのものの確認 ---------- */
function selftest(htmlText) {
  console.log('\n=== selftest  正しいものをわざと壊して、赤が出るかを見る ===');
  const base = run(htmlText);
  let fails = 0;

  // L-1  合格している問題の誤答を短くしたら、合格数が1減るか
  const okQ = base.bank.find(q => {
    const o = q.en.opts, ks = Object.keys(o);
    const minC = Math.min(...q.ans.map(k => len(o[k])));
    const maxW = Math.max(...ks.filter(k => !q.ans.includes(k)).map(k => len(o[k])));
    return maxW >= minC;
  });
  if (!okQ) { console.log('  L-1 変異用の合格問題が無い'); fails++; }
  else {
    const mutated = htmlText.replace(
      okQ.en.opts[Object.keys(okQ.en.opts).find(k => !okQ.ans.includes(k) && len(okQ.en.opts[k]) === Math.max(...Object.keys(okQ.en.opts).filter(x => !okQ.ans.includes(x)).map(x => len(okQ.en.opts[x]))))],
      'short'
    );
    if (mutated === htmlText) { console.log('  L-1 変異が当たらなかった（置換が空振り）'); fails++; }
    else {
      const after = run(mutated);
      const dropped = base.L.pass.en.ok - after.L.pass.en.ok;
      console.log(`  L-1 ${okQ.id} の最長誤答を潰した → 合格 ${base.L.pass.en.ok} → ${after.L.pass.en.ok} (${dropped >= 1 ? '赤くなった OK' : '変化なし NG'})`);
      if (dropped < 1) fails++;
    }
  }

  // X-1  既にある日本語の解説へ記号を差し込んで、検出されるか。
  //      前は ja:{ の直後に nos を「足して」いたが、後ろにある本物の nos が
  //      同じキーを上書きするので、変異が一度も効かないまま緑を返していた。
  //      壊すなら、実在する行そのものを書き換える。
  const jaLine = htmlText.match(/^ {6}[A-E]:"正解。.*$/m);
  if (!jaLine) { console.log('  X-1 変異の対象行が見つからない'); fails++; }
  else {
    const mutated = htmlText.replace(jaLine[0], jaLine[0].replace('"正解。', '"正解。Aは'));
    if (mutated === htmlText) { console.log('  X-1 変異が当たらなかった'); fails++; }
    else {
      const after = run(mutated);
      const grew = after.X.hits.length > base.X.hits.length;
      console.log(`  X-1 実在する解説に記号を差し込む → 検出 ${base.X.hits.length} → ${after.X.hits.length} (${grew ? '赤くなった OK' : '素通り NG'})`);
      if (!grew) fails++;
    }
  }

  // N-1  実在する nos から1項目を落として、欠けとして拾えるか
  const nosAt = htmlText.indexOf('    nos:{\n');
  const firstEntry = nosAt >= 0 ? htmlText.slice(nosAt).match(/^ {6}[A-E]:".*",$/m) : null;
  if (!firstEntry) { console.log('  N-1 変異の対象行が見つからない'); fails++; }
  else {
    const mutated = htmlText.replace(firstEntry[0] + '\n', '');
    if (mutated === htmlText) { console.log('  N-1 変異が当たらなかった'); fails++; }
    else {
      const after = run(mutated);
      const grew = after.N.partial.length > base.N.partial.length;
      console.log(`  N-1 実在する解説から1項目を落とす → 欠けあり ${base.N.partial.length} → ${after.N.partial.length} (${grew ? '赤くなった OK' : '素通り NG'})`);
      if (!grew) fails++;
    }
  }

  // E-1  模試A の1問を模試B の1問に差し替えたら、重複とドメイン本数の両方で赤くなるか
  if (base.exams) {
    const exA = base.exams.find(e => e.key === 'A');
    const exB = base.exams.find(e => e.key === 'B');
    if (exA && exB) {
      const victim = exA.ids[0], intruder = exB.ids[0];
      const mutated = htmlText.replace(`'${victim}',`, `'${intruder}',`);
      if (mutated === htmlText) { console.log('  E-1 変異が当たらなかった（置換が空振り）'); fails++; }
      else {
        const after = run(mutated);
        const grew = after.E.problems.length > base.E.problems.length;
        console.log(`  E-1 模試Aの ${victim} を模試Bの ${intruder} に差し替え → 指摘 ${base.E.problems.length} → ${after.E.problems.length} (${grew ? '赤くなった OK' : '素通り NG'})`);
        if (!grew) fails++;
      }
    }
  } else { console.log('  E-1 EXAMS 未実装のため検査せず'); }

  console.log(`\nselftest  ${fails === 0 ? '検査器は壊すと赤くなる（信用してよい）' : `${fails} 項目が反応しなかった（この検査器は信用できない）`}\n`);
  return fails;
}

/* ---------- main ---------- */
const html = readFileSync(SRC, 'utf8');

if (SELFTEST) {
  // process.exit() はパイプ越しの stdout を切り落とすので exitCode で終える
  process.exitCode = selftest(html) === 0 ? 0 : 1;
}

else if (DERIVE) {
  const { bank } = loadBank(html);
  const { validSingles, pairs, matrix } = deriveExams(bank);
  console.log(`\nシナリオ × ドメインの在庫`);
  console.log(`        D1  D2  D3  D4  D5   計`);
  for (let s = 1; s <= 6; s++) {
    let line = `  S${s}  `, t = 0;
    for (let d = 1; d <= 5; d++) { const v = cap(matrix, s, d); t += v; line += String(v).padStart(4); }
    console.log(line + String(t).padStart(5));
  }
  console.log(`\n必要本数  D1 ${EXAM_N[1]}  D2 ${EXAM_N[2]}  D3 ${EXAM_N[3]}  D4 ${EXAM_N[4]}  D5 ${EXAM_N[5]}  = 60`);
  console.log(`ブループリントを満たせる4シナリオの組  ${validSingles.length} / 15`);
  validSingles.forEach(c => console.log(`  S${c.join(' S')}`));
  console.log(`\n完全非重複の2本が組めるペア  ${pairs.length} 組`);
  if (pairs.length) {
    const [cbA, cbB] = pairs[0];
    console.log(`  採用  模試A S${cbA.join(' S')}  /  模試B S${cbB.join(' S')}`);
    const al = allocate(bank, cbA, cbB);
    if (!al) console.log('  割り当てに失敗');
    else {
      const overlap = al.A.filter(q => al.B.some(x => x.id === q.id));
      console.log(`  模試A ${al.A.length}問  模試B ${al.B.length}問  重複 ${overlap.length}問  偏り指標 ${al.score}`);
      console.log(`  Aのシナリオ内訳 ${JSON.stringify(al.countA)}   Bのシナリオ内訳 ${JSON.stringify(al.countB)}`);
      const dcnt = qs => qs.reduce((o, q) => (o[q.d] = (o[q.d] || 0) + 1, o), {});
      console.log(`  Aのドメイン ${JSON.stringify(dcnt(al.A))}   Bのドメイン ${JSON.stringify(dcnt(al.B))}`);
      console.log(`  複数選択 A ${al.A.filter(q => q.type === 'multi').length}問 / B ${al.B.filter(q => q.type === 'multi').length}問`);
      console.log(`  A: ${al.A.map(q => q.id).join(' ')}`);
      console.log(`  B: ${al.B.map(q => q.id).join(' ')}`);
    }
  }
  console.log('');
}

else if (!SELFTEST) {
  process.exitCode = report(run(html)) === 0 ? 0 : 1;
}
