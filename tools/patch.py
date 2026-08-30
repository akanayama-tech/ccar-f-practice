#!/usr/bin/env python3
"""問題ブロックを id 単位で差し替える。

index.html の QUESTIONS / GH は素の JS オブジェクトリテラルなので、
行単位で「{ id:"X.Y" から次の { id: の直前まで」を切り出して入れ替える。

  python3 tools/patch.py --show 6.4          いまの中身を出す
  python3 tools/patch.py --apply new.js      差し替える（--- id ---  で区切った塊）
"""
import io, re, sys, argparse

SRC = 'index.html'

LENS_JS = r"""
const fs=require('fs');
const lines=fs.readFileSync('index.html','utf8').split('\n');
function ex(n){const h=lines.findIndex(l=>l.startsWith('const '+n+' = ['));let e=-1;
 for(let i=h+1;i<lines.length;i++)if(lines[i]==='];'){e=i;break;}
 return new Function('return '+lines.slice(h,e+1).join('\n').replace('const '+n+' = ',''))();}
const all=[...ex('QUESTIONS'),...ex('GH')];
const by=new Map(all.map(q=>[q.id,q]));
const L=s=>String(s).replace(/<[^>]+>/g,'').length;
const ids=process.argv.filter(a=>!a.startsWith('/')&&a!=='--');
for(const id of ids){
  const q=by.get(id);
  if(!q){console.log(id,'が無い');continue;}
  console.log('--- '+id+'  正解 '+q.ans.join(',')+' ---');
  for(const lang of ['en','ja']){
    const o=q[lang].opts, ks=Object.keys(o);
    const corr=Math.min(...q.ans.map(k=>L(o[k])));
    const wrongKs=ks.filter(k=>!q.ans.includes(k));
    const maxW=Math.max(...wrongKs.map(k=>L(o[k])));
    const okL1 = maxW>=corr;
    const all=ks.map(k=>L(o[k]));
    const spread=(Math.max(...all)/Math.min(...all)).toFixed(2);
    console.log('  '+lang+'  正解 '+corr+'  最長誤答 '+maxW+'  '+(okL1?'L-1 PASS':'L-1 FAIL')+
      '   散らばり '+spread+(spread>2?' (L-2 超過)':''));
    console.log('     '+ks.map(k=>k+(q.ans.includes(k)?'*':' ')+':'+L(o[k])).join('  '));
    if(!okL1){
      // 目標: 誤答を2本、正解より 5〜25 長く
      const need=wrongKs.map(k=>({k,len:L(o[k]),add:corr+12-L(o[k])}))
        .filter(x=>x.add>0).sort((a,b)=>a.add-b.add).slice(0,2);
      console.log('     → '+need.map(x=>x.k+' に +'+x.add+'文字').join(' 、 ')+'（正解+12 まで伸ばす）');
    }
    console.log('     nos '+(q[lang].nos?Object.keys(q[lang].nos).length+'/'+ks.length:'なし'));
  }
}
"""

def load():
    return io.open(SRC, encoding='utf-8').read().split('\n')

def blocks(lines):
    """id -> (start, end) 行番号（0起点、end は含まない）"""
    starts = []
    for i, l in enumerate(lines):
        m = re.match(r'^\{ id:"([^"]+)"', l)
        if m:
            starts.append((m.group(1), i))
    out = {}
    for n, (qid, i) in enumerate(starts):
        if n + 1 < len(starts):
            end = starts[n + 1][1]
        else:
            # 配列の終端 "];" まで
            end = next(j for j in range(i, len(lines)) if lines[j] == '];')
        # 末尾の空行を落とす
        while end > i and lines[end - 1].strip() == '':
            end -= 1
        out[qid] = (i, end)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--show', nargs='+')
    ap.add_argument('--apply')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--lens', nargs='+', help='選択肢の文字数と、あと何文字必要かを出す')
    a = ap.parse_args()
    lines = load()
    b = blocks(lines)

    if a.list:
        print(len(b), 'blocks')
        return
    if a.lens:
        import json, subprocess
        js = subprocess.run(['node', '-e', LENS_JS, '--'] + a.lens,
                            capture_output=True, text=True, cwd='.')
        if js.returncode: print(js.stderr); sys.exit(1)
        print(js.stdout, end='')
        return
    if a.show:
        for qid in a.show:
            if qid not in b:
                print(f'!! {qid} が無い'); continue
            s, e = b[qid]
            print(f'--- {qid} (lines {s+1}..{e}) ---')
            print('\n'.join(lines[s:e]))
            print()
        return
    if a.apply:
        text = io.open(a.apply, encoding='utf-8').read()
        chunks = re.split(r'^--- ([^\s]+) ---$', text, flags=re.M)
        # chunks = ['', id1, body1, id2, body2, ...]
        pairs = [(chunks[i], chunks[i+1]) for i in range(1, len(chunks), 2)]
        if not pairs:
            print('差し替える塊が見つからない（--- id --- の区切りが要る）'); sys.exit(1)
        # 後ろから当てて行番号のずれを避ける
        pairs.sort(key=lambda p: b[p[0]][0] if p[0] in b else -1, reverse=True)
        applied = []
        for qid, body in pairs:
            if qid not in b:
                print(f'!! {qid} が無い'); sys.exit(1)
            s, e = b[qid]
            new = body.strip('\n').split('\n')
            lines[s:e] = new
            applied.append(qid)
        io.open(SRC, 'w', encoding='utf-8').write('\n'.join(lines))
        print(f'差し替え {len(applied)} 問: {" ".join(reversed(applied))}')

main()
