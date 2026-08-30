/* 語彙モジュールの素材を出題文そのものから採る。
   例語も用例も、実在する137問の本文からしか採らない（作り話を混ぜない）。 */
import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('index.html', 'utf8').split('\n');
function ex(n){const h=lines.findIndex(l=>l.startsWith('const '+n+' = ['));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='];'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const '+n+' = ',''))();}
const all=[...ex('QUESTIONS'),...ex('GH')];
const SCEN=(()=>{const h=lines.findIndex(l=>l.startsWith('const SCENARIOS = ['));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='];'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const SCENARIOS = ',''))();})();

const strip=s=>String(s).replace(/<[^>]+>/g,' ');
/* 頻度は本文の全量から数える。用例に使う文だけを長さで絞る。
   ここを分けないと、長い文にしか出てこない語が「0回」に見える（実際に踏んだ）。 */
const sents=[];      // 用例の候補（読みやすい長さの文だけ）
const corpusText=[]; // 頻度の母集合（全文）
for(const q of all){
  const e=q.en;
  const parts=[e.stem, ...Object.values(e.opts), e.why, ...(e.nos?Object.values(e.nos):[])];
  for(const p of parts){
    corpusText.push(strip(p));
    for(const s of strip(p).split(/(?<=[.?!])\s+/)){
      const t=s.trim();
      if(t.length>=30 && t.length<=180) sents.push({id:q.id, t});
    }
  }
}
for(const s of SCEN){
  corpusText.push(strip(s.en.ctx));
  for(const t of strip(s.en.ctx).split(/(?<=[.?!])\s+/)){
    const x=t.trim(); if(x.length>=30&&x.length<=180) sents.push({id:'S'+s.n, t:x});
  }
}

const freq={};
for(const t of corpusText) for(const w of (t.toLowerCase().match(/[a-z][a-z\-]{2,}/g)||[])) freq[w]=(freq[w]||0)+1;

// 用例は「その語が入っていて、いちばん短い文」を採る（読みやすいので）
const example={};
for(const {id,t} of sents){
  const seen=new Set(t.toLowerCase().match(/[a-z][a-z\-]{2,}/g)||[]);
  for(const w of seen){
    if(!example[w] || t.length < example[w].t.length) example[w]={id,t};
  }
}

const out={};
for(const [w,c] of Object.entries(freq)) out[w]={n:c, ex:example[w]||null};
writeFileSync('/tmp/vocab-corpus.json', JSON.stringify(out));
console.log('語 '+Object.keys(out).length+' 種（本文の全量から集計）、用例候補の文 '+sents.length+' 本 → /tmp/vocab-corpus.json');
console.log('用例が取れない語: '+Object.keys(out).filter(w=>!out[w].ex).length+' 種（長い文にしか出てこない語）');

// 候補の目安を出す
const AFFIX=/^(de|dis|in|im|ir|il|un|non|re|pre|pro|sub|super|inter|intra|trans|con|com|col|cor|ex|ab|ad|per|post|anti|counter|over|under|multi|auto|semi|mis)/;
const SUF=/(tion|sion|ment|ance|ence|ity|ility|ous|ive|able|ible|ate|ify|ize|ise|ary|ory|ism|ist|ic|al)$/;
const cand=Object.entries(freq).filter(([w,c])=>c>=3&&w.length>=7&&(AFFIX.test(w)||SUF.test(w)))
  .sort((a,b)=>b[1]-a[1]);
console.log('候補（頻度3以上・7文字以上・接辞あり）: '+cand.length+' 語');
if(process.env.SHOW==='1') console.log(cand.map(([w,c])=>w+':'+c).join('  '));
