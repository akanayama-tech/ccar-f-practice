/* L-1 / L-2 を同時に満たすための作業票。
   1問につき「正解と同じ粒度に届いていない誤答」を全部並べる。
   1本だけ伸ばすと L-1 は通っても散らばりが開き、短い選択肢が捨て札に見える。 */
import { readFileSync } from 'node:fs';
const lines=readFileSync('index.html','utf8').split('\n');
function ex(n){const h=lines.findIndex(l=>l.startsWith('const '+n+' = ['));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='];'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const '+n+' = ',''))();}
const all=[...ex('QUESTIONS'),...ex('GH')];
const L=s=>String(s).replace(/<[^>]+>/g,'').length;
const from=Number(process.env.FROM||0), n=Number(process.env.N||12);
const SPREAD=2.0;

const rows=[];
for(const q of all){
  const need={};
  for(const lang of ['en','ja']){
    const o=q[lang].opts, ks=Object.keys(o);
    const corr=Math.min(...q.ans.map(k=>L(o[k])));
    const wrongKs=ks.filter(k=>!q.ans.includes(k));
    const maxW=Math.max(...wrongKs.map(k=>L(o[k])));
    const lens=ks.map(k=>L(o[k]));
    const spreadBad=(Math.max(...lens)/Math.min(...lens))>SPREAD;
    if(maxW>=corr && !spreadBad) continue;
    // 目標: 誤答は正解の 0.85〜1.15 倍に収める。最長は正解を必ず超える
    const floor=Math.round(corr*0.85), top=Math.round(corr*1.12);
    const items=wrongKs.map(k=>({k,len:L(o[k]),text:o[k],
      add: L(o[k])<floor ? floor-L(o[k]) : 0})).filter(x=>x.add>0);
    if(maxW<corr){ // いちばん長い誤答は正解を超えさせる
      const best=wrongKs.sort((a,b)=>L(o[b])-L(o[a]))[0];
      const cur=items.find(x=>x.k===best);
      const want=top-L(o[best]);
      if(cur) cur.add=Math.max(cur.add,want); else items.push({k:best,len:L(o[best]),text:o[best],add:want});
    }
    if(items.length) need[lang]={corr,items:items.sort((a,b)=>a.k.localeCompare(b.k)),l1:maxW<corr,gap:corr-maxW};
  }
  if(Object.keys(need).length) rows.push({q,need});
}
// 利用者が報告した欠陥は L-1（正解が最長）。そちらを先に片づける
const l1score=r=>Math.max(...['en','ja'].map(l=>r.need[l]&&r.need[l].l1?r.need[l].gap:-1));
rows.sort((a,b)=>l1score(b)-l1score(a));
console.log(`要修正 ${rows.length}問。${from+1}〜${Math.min(from+n,rows.length)}問目\n`);
for(const {q,need} of rows.slice(from,from+n)){
  console.log(`### ${q.id}  正解 ${q.ans.join(',')}`);
  console.log(`Q: ${q.en.stem.slice(0,90)}`);
  console.log(`正: ${String(q.en.opts[q.ans[0]]).slice(0,95)}`);
  for(const lang of ['en','ja']){
    if(!need[lang]){ console.log(`  ${lang} 済`); continue; }
    console.log(`  ${lang} 正解${need[lang].corr}字${need[lang].l1?'  ← L-1 未修正':'  (散らばりのみ)'}`);
    for(const it of need[lang].items) console.log(`   ${it.k} +${it.add} (${it.len}字): ${it.text}`);
  }
  console.log('');
}
