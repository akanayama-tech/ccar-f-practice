/* 語彙データを1本に焼く。
   - 単語帳は TSV の日本語 + コーパスの頻度・用例
   - 体系（接辞・語根）の例語にもコーパスの頻度を付ける
   本文に出ない語は n:0 にして、画面側で「参考」と分かるようにする。
   消さずに残すのは、語根の理解に要る語があるため（submit / inspect など）。
   ただし黙って混ぜると「この問題集に出る語」と誤読されるので、必ず印で分ける。 */
import { readFileSync, writeFileSync } from 'node:fs';
const corpus = JSON.parse(readFileSync('/tmp/vocab-corpus.json', 'utf8'));
const args = process.argv.slice(2);
const sysFile = args.find(a => a.endsWith('.js'));
const tsvFiles = args.filter(a => a.endsWith('.tsv'));

const freq = w => {
  const base = String(w).replace(/\(.*\)/, '').trim().toLowerCase();
  return corpus[base] ? corpus[base].n : 0;
};

/* ---- 体系 ---- */
const sysSrc = readFileSync(sysFile, 'utf8');
const SYS = new Function('return {' + sysSrc.replace(/^\/\*[\s\S]*?\*\/\s*const VOCAB = \{/, '') + '}')();
let sysWords = 0, sysAbsent = 0;
for (const g of ['prefix', 'suffix']) for (const it of SYS[g]) {
  it.ex = it.ex.map(w => { const n = freq(w); sysWords++; if (!n) sysAbsent++; return { w, n }; });
}
for (const r of SYS.roots) for (const f of r.fam) { const n = freq(f.w); sysWords++; if (!n) sysAbsent++; f.n = n; }

/* ---- 単語帳 ---- */
const seen = new Set(), words = [], missing = [], dup = [], noEx = [];
for (const f of tsvFiles) for (const ln of readFileSync(f, 'utf8').split('\n')) {
  if (!ln.trim()) continue;
  const [w, ja, p, m] = ln.split('\t');
  if (!w || !ja || !p || !m) { console.log('列不足:', ln.slice(0, 40)); process.exit(1); }
  if (seen.has(w)) { dup.push(w); continue; }
  const c = corpus[w];
  if (!c) { missing.push(w); continue; }
  seen.add(w);
  if (!c.ex) noEx.push(w);
  words.push({ w, ja, n: c.n, p, m, e: c.ex ? c.ex.t.replace(/\s+/g, ' ') : '', q: c.ex ? c.ex.id : '' });
}
words.sort((a, b) => b.n - a.n);

const J = o => JSON.stringify(o);
const out = [
  '/* ---- 語彙 ----',
  '   本番は英語受験なので、読めないと知識があっても落ちる。',
  '   例語・用例は上の137問の本文から採り、出現回数を n に持つ。',
  '   n:0 は本文に出ない語で、語根の理解のためだけに並べている（画面では参考と表示する）。',
  '   このデータは tools/vocab_build.mjs が生成する。手で直さない。 */',
  'const VOCAB = {',
  'prefix: ' + J(SYS.prefix) + ',',
  'suffix: ' + J(SYS.suffix) + ',',
  'roots: ' + J(SYS.roots) + ',',
  'words: [',
  words.map(x => '  ' + J(x)).join(',\n'),
  ']',
  '};',
  ''
].join('\n');
/* --verify: 焼いた結果と index.html に埋まっているものを突き合わせる。
   「index.html を手で直さない」を文章で書くだけでは守られないので、機械で見る。 */
if (process.argv.includes('--verify')) {
  const lines = readFileSync('index.html', 'utf8').split('\n');
  const h = lines.findIndex(l => l.startsWith('const VOCAB = {'));
  if (h < 0) { console.log('index.html に VOCAB が無い'); process.exit(1); }
  let e = -1;
  for (let i = h + 1; i < lines.length; i++) if (lines[i] === '};') { e = i; break; }
  const embedded = new Function('return ' + lines.slice(h, e + 1).join('\n').replace('const VOCAB = ', '').replace(/;\s*$/, ''))();
  const fresh = new Function('return ' + out.replace(/^[\s\S]*?const VOCAB = /, '').replace(/;\s*$/, ''))();
  const same = JSON.stringify(embedded) === JSON.stringify(fresh);
  console.log(same
    ? '照合 一致。index.html の VOCAB は tools/vocab-src/ から再生成できる'
    : '照合 不一致。index.html の VOCAB が手で直されているか、元データが古い');
  if (!same) {
    for (const k of ['prefix', 'suffix', 'roots', 'words']) {
      const x = JSON.stringify(embedded[k]), y = JSON.stringify(fresh[k]);
      if (x !== y) console.log(`  ${k}: 埋め込み ${embedded[k].length} 件 / 再生成 ${fresh[k].length} 件`);
    }
  }
  process.exitCode = same ? 0 : 1;
}

writeFileSync('/tmp/vocab.js', out);

console.log(`単語帳 ${words.length} 語　体系 接頭辞${SYS.prefix.length} 接尾辞${SYS.suffix.length} 語根${SYS.roots.length}`);
console.log(`体系の例語 ${sysWords} 個のうち、本文に出ない参考語 ${sysAbsent} 個`);
if (dup.length) console.log(`重複で落とした ${dup.length}: ${dup.join(' ')}`);
if (missing.length) console.log(`本文に無いので落とした ${missing.length}: ${missing.join(' ')}`);
if (noEx.length) console.log(`用例が取れなかった ${noEx.length}: ${noEx.join(' ')}`);
console.log(`→ /tmp/vocab.js (${Math.round(out.length / 1024)}KB)`);
