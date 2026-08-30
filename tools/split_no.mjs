/* 一括の no 文を選択肢ごとに割る「下書き」を作る。
   これは下書き専用。割れ方が怪しいものは印を付けて出し、人が見てから採用する。 */
import { readFileSync } from 'node:fs';
const lines = readFileSync('index.html', 'utf8').split('\n');
function ex(n){const h=lines.findIndex(l=>l.startsWith('const '+n+' = ['));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='];'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const '+n+' = ',''))();}
const all=[...ex('QUESTIONS'),...ex('GH')];
const ids=process.argv.filter(a=>/^(G?\d)/.test(a));
const target = ids.length ? all.filter(q=>ids.includes(q.id)) : all;

// 「A は…」「A and C …」で始まる断片に割る
function splitEn(text, keys){
  const marks=[];
  const re=/(?:^|\.\s+)([A-E])(\s+and\s+([A-E]))?\s+(?=[a-z])/g;
  let m; while((m=re.exec(text))) marks.push({at:m.index===0?0:m.index+2, ks:[m[1],m[3]].filter(Boolean), head:m[0].replace(/^\.\s+/,'')});
  if(!marks.length) return null;
  const out={};
  marks.forEach((mk,i)=>{
    const end = i+1<marks.length ? marks[i+1].at : text.length;
    let frag = text.slice(mk.at, end).trim();
    frag = frag.replace(/^([A-E])(\s+and\s+[A-E])?\s+/, '');       // 先頭の記号を落とす
    frag = frag.charAt(0).toUpperCase()+frag.slice(1);
    mk.ks.forEach(k=>out[k]=frag.replace(/\s+$/,''));
  });
  return out;
}
function splitJa(text, keys){
  const marks=[];
  const re=/(?:^|。)\s*([A-E])(?:\s*[とやおよび・]\s*([A-E]))?[はがも]/g;
  let m; while((m=re.exec(text))) marks.push({at:m.index===0?0:m.index+1, ks:[m[1],m[2]].filter(Boolean)});
  if(!marks.length) return null;
  const out={};
  marks.forEach((mk,i)=>{
    const end = i+1<marks.length ? marks[i+1].at : text.length;
    let frag = text.slice(mk.at, end).trim();
    frag = frag.replace(/^([A-E])(\s*[とやおよび・]\s*[A-E])?[はがも]/, '');
    mk.ks.forEach(k=>out[k]=frag);
  });
  return out;
}

let full=0, partial=0, none=0;
for(const q of target){
  const ks=Object.keys(q.en.opts);
  const wrong=ks.filter(k=>!q.ans.includes(k));
  const en=splitEn(q.en.no||'', ks), ja=splitJa(q.ja.no||'', ks);
  const covEn=en?wrong.filter(k=>en[k]).length:0;
  const covJa=ja?wrong.filter(k=>ja[k]).length:0;
  const ok = covEn===wrong.length && covJa===wrong.length;
  if(ok) full++; else if(covEn||covJa) partial++; else none++;
  if(process.env.SHOW==='1'){
    console.log(`--- ${q.id}  誤答 ${wrong.join('')}  英 ${covEn}/${wrong.length}  和 ${covJa}/${wrong.length} ${ok?'':'  ← 要手当て'}`);
    for(const k of wrong) console.log(`   ${k} en: ${(en&&en[k])||'(取れず)'}\n   ${k} ja: ${(ja&&ja[k])||'(取れず)'}`);
  }
}
console.log(`\n対象 ${target.length}問   完全に割れた ${full}   一部 ${partial}   割れず ${none}`);
