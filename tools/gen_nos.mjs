/* 全問の nos 下書きを作り、要手当てに印を付けて JSON で出す。
   下書きであって完成品ではない。印の付いたものは人が書き直す。 */
import { readFileSync, writeFileSync } from 'node:fs';
const lines = readFileSync('index.html', 'utf8').split('\n');
function ex(n){const h=lines.findIndex(l=>l.startsWith('const '+n+' = ['));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='];'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const '+n+' = ',''))();}
const all=[...ex('QUESTIONS'),...ex('GH')];

function splitEn(text){
  const marks=[]; const re=/(?:^|\.\s+)([A-E])(\s+and\s+([A-E]))?\s+(?=[a-z])/g; let m;
  while((m=re.exec(text))) marks.push({at:m.index===0?0:m.index+2, ks:[m[1],m[3]].filter(Boolean)});
  if(!marks.length) return {map:null,shared:[]};
  const out={}, shared=[];
  marks.forEach((mk,i)=>{
    const end=i+1<marks.length?marks[i+1].at:text.length;
    let f=text.slice(mk.at,end).trim().replace(/^([A-E])(\s+and\s+[A-E])?\s+/,'');
    f=f.charAt(0).toUpperCase()+f.slice(1);
    if(mk.ks.length>1) shared.push(mk.ks.join('+'));
    mk.ks.forEach(k=>out[k]=f);
  });
  return {map:out,shared};
}
function splitJa(text){
  const marks=[]; const re=/(?:^|。)\s*([A-E])(?:\s*[とやおよび・]\s*([A-E]))?[はがも]/g; let m;
  while((m=re.exec(text))) marks.push({at:m.index===0?0:m.index+1, ks:[m[1],m[2]].filter(Boolean)});
  if(!marks.length) return {map:null,shared:[]};
  const out={}, shared=[];
  marks.forEach((mk,i)=>{
    const end=i+1<marks.length?marks[i+1].at:text.length;
    let f=text.slice(mk.at,end).trim().replace(/^([A-E])(\s*[とやおよび・]\s*[A-E])?[はがも]/,'');
    if(mk.ks.length>1) shared.push(mk.ks.join('+'));
    mk.ks.forEach(k=>out[k]=f);
  });
  return {map:out,shared};
}
/* 記号を主語にした文から記号だけを抜くと英語が崩れる。
   be動詞で始まるものは主語を補い、共有ケース（複数形の動詞）は単数に直す。 */
const PLURAL2SG={describe:'describes',improve:'improves',do:'does',add:'adds',look:'looks',
  swap:'swaps',invert:'inverts',route:'routes',rely:'relies',reference:'references',rest:'rests',
  misstate:'misstates',apply:'applies',make:'makes',remove:'removes',treat:'treats',assume:'assumes',
  keep:'keeps',ignore:'ignores',require:'requires',discard:'discards',ask:'asks',change:'changes',
  abandon:'abandons',pay:'pays',spend:'spends',duplicate:'duplicates',address:'addresses',
  substitute:'substitutes',postpone:'postpones',escalate:'escalates',bloat:'bloats',use:'uses',
  act:'acts',conflate:'conflates',confuse:'confuses',misapply:'misapplies',replace:'replaces',
  turn:'turns',shift:'shifts',fail:'fails',hide:'hides',leave:'leaves',send:'sends',run:'runs'};
function tidyEn(f, wasShared){
  if(!f) return f;
  f = f.trim();
  if(/^(Is|Are)\s/.test(f)) return 'This is ' + f.replace(/^(Is|Are)\s/, '');
  if(wasShared){
    const m = f.match(/^([A-Za-z]+)(\s|$)/);
    if(m){
      const lower = m[1].toLowerCase();
      if(PLURAL2SG[lower]) f = PLURAL2SG[lower].charAt(0).toUpperCase()+PLURAL2SG[lower].slice(1)+f.slice(m[1].length);
    }
  }
  return f;
}
const firstSentEn = t => (String(t).match(/^[\s\S]*?[.?!](?=\s|$)/)||[String(t)])[0].trim();
const firstSentJa = t => (String(t).match(/^[\s\S]*?。/)||[String(t)])[0].trim();

const out=[], flags=[];
let skipped=0;
for(const q of all){
  if(q.en.nos){ skipped++; continue; }        // すでに手で書いたものは触らない
  const ks=Object.keys(q.en.opts);
  const wrong=ks.filter(k=>!q.ans.includes(k));
  const en=splitEn(q.en.no||''), ja=splitJa(q.ja.no||'');
  const rec={id:q.id, ans:q.ans, keys:ks, en:{}, ja:{}, flag:[]};
  for(const k of ks){
    if(q.ans.includes(k)){
      rec.en[k]='Correct. '+firstSentEn(q.en.why);
      rec.ja[k]='正解。'+firstSentJa(q.ja.why);
    } else {
      const sharedEn = en.shared.some(p=>p.split('+').includes(k));
      rec.en[k]=tidyEn((en.map&&en.map[k])||'', sharedEn);
      rec.ja[k]=(((ja.map&&ja.map[k])||'')).trim();
    }
  }
  const missEn=wrong.filter(k=>!rec.en[k]), missJa=wrong.filter(k=>!rec.ja[k]);
  if(missEn.length||missJa.length) rec.flag.push('欠け en:'+missEn.join('')+' ja:'+missJa.join(''));
  // 共有そのものは印にしない（単数化で直る）。直らなかった複数形だけ残す
  for(const k of wrong){
    const w=(rec.en[k]||'').match(/^([A-Za-z]+)\s/);
    if(w && en.shared.some(p=>p.split('+').includes(k)) && !/(s|ed|ing)$/.test(w[1]) && w[1]!=='This')
      rec.flag.push('動詞が複数形のまま en'+k+' ('+w[1]+')');
  }
  for(const k of wrong){
    if(rec.en[k]&&rec.en[k].length<40) rec.flag.push('短い en'+k+'('+rec.en[k].length+')');
    if(rec.ja[k]&&rec.ja[k].length<18) rec.flag.push('短い ja'+k+'('+rec.ja[k].length+')');
  }
  if(/(?:^|[^A-Za-z])[B-E](?:\s+(?:and|or|is|are)\b|[,.)])/.test(Object.values(rec.en).join(' ')))
    rec.flag.push('記号の残留 en');
  if(/(?:^|[^A-Za-z])[A-E][はとがも]/.test(Object.values(rec.ja).join(' ')))
    rec.flag.push('記号の残留 ja');
  out.push(rec);
  if(rec.flag.length) flags.push(rec.id+'  '+rec.flag.join(' / '));
}
writeFileSync('/tmp/nos-draft.json', JSON.stringify(out,null,1));
console.log('下書き '+out.length+'問（手書き済み '+skipped+'問は除外） → /tmp/nos-draft.json');
const clean=out.filter(r=>!r.flag.length);
const byKind={};
out.filter(r=>r.flag.length).forEach(r=>{
  const kinds=[...new Set(r.flag.map(f=>f.split(' ')[0]))].sort().join('+');
  (byKind[kinds]=byKind[kinds]||[]).push(r.id);
});
console.log('印なし '+clean.length+'問');
Object.entries(byKind).sort((a,b)=>b[1].length-a[1].length).forEach(([k,v])=>
  console.log('  '+k+'  '+v.length+'問  '+v.slice(0,12).join(' ')+(v.length>12?' …':'')));
console.log('要手当て '+flags.length+'問');
flags.slice(0,40).forEach(f=>console.log('  '+f));
if(flags.length>40) console.log('  … 他 '+(flags.length-40)+'問');
