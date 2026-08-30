/* どの語がどの問題に出るかの対応を作る。
   見るのは設問文と選択肢だけ。解説は解いた後に読むものなので、
   「英語でつまずいた原因」の候補にはならない。 */
import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('index.html', 'utf8').split('\n');
function exArr(n){const h=lines.findIndex(l=>l.startsWith('const '+n+' = ['));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='];'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const '+n+' = ',''))();}
function exObj(n){const h=lines.findIndex(l=>l.startsWith('const '+n+' = {'));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='};'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const '+n+' = ','').replace(/;\s*$/,''))();}

const all = [...exArr('QUESTIONS'), ...exArr('GH')];
const V = exObj('VOCAB');
const strip = s => String(s).replace(/<[^>]+>/g, ' ');

/* 語形が変わる（isolate → isolated / isolation）ので、語幹で当てる。
   単純な語尾落としで十分な精度が出る。 */
function stem(w) {
  return w.replace(/(ations?|ations|ing|ions?|ies|ed|es|s|ly|ment|ance|ence|ity|ive|ous|al)$/, '');
}
const index = {};                     // qid -> [語]
const byWord = {};                    // 語 -> [qid]
for (const q of all) {
  const text = strip([q.en.stem, ...Object.values(q.en.opts)].join(' '));
  const toks = new Set((text.toLowerCase().match(/[a-z][a-z\-]{2,}/g) || []));
  const stems = new Set([...toks].map(stem).filter(s => s.length >= 4));
  const hit = V.words.filter(v => toks.has(v.w.toLowerCase()) || stems.has(stem(v.w.toLowerCase())));
  index[q.id] = hit.map(v => v.w);
  hit.forEach(v => (byWord[v.w] = byWord[v.w] || []).push(q.id));
}
const per = Object.values(index).map(a => a.length).sort((a, b) => a - b);
const med = per[Math.floor(per.length / 2)];
console.log(`1問あたりの該当語  中央値 ${med}　最小 ${per[0]}　最大 ${per[per.length - 1]}`);
console.log(`該当0語の問題 ${per.filter(x => x === 0).length} / ${all.length}`);
const orphan = V.words.filter(v => !byWord[v.w]);
console.log(`どの設問文にも出ない語 ${orphan.length}: ${orphan.map(v => v.w).join(' ')}`);
console.log('');
for (const q of all.slice(0, 4)) console.log(`  Q${q.id} (${index[q.id].length}語): ${index[q.id].join(' ')}`);

writeFileSync('/tmp/vocab-link.json', JSON.stringify({ index, byWord }));
console.log('\n→ /tmp/vocab-link.json');
