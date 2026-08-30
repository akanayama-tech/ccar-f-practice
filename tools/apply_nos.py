#!/usr/bin/env python3
"""nos 下書きを index.html に流し込む。no: の行を nos:{...} に置き換える。

安全側の作り。
  - 二重引用符を含む文があれば、その場で止める（JS の文字列を壊すため）
  - 対象の問題に既に nos があれば飛ばす（手書きを上書きしない）
  - 全選択肢ぶんそろっていない問題は飛ばす（欠けたまま入れない）
"""
import io, json, re, sys

SRC='index.html'
draft=json.load(open(sys.argv[1] if len(sys.argv)>1 else '/tmp/nos-draft.json'))
only=set(sys.argv[2:]) if len(sys.argv)>2 else None

lines=io.open(SRC,encoding='utf-8').read().split('\n')
starts=[(m.group(1),i) for i,l in enumerate(lines) for m in [re.match(r'^\{ id:"([^"]+)"',l)] if m]
span={}
for n,(qid,i) in enumerate(starts):
    end=starts[n+1][1] if n+1<len(starts) else next(j for j in range(i,len(lines)) if lines[j]=='];')
    span[qid]=(i,end)

applied=skipped=0
# 後ろから当てて行番号のずれを避ける
for rec in sorted(draft,key=lambda r: span.get(r['id'],(-1,))[0],reverse=True):
    qid=rec['id']
    if only and qid not in only: continue
    if qid not in span: print('!!',qid,'が無い'); sys.exit(1)
    miss=[k for k in rec['keys'] if not rec['en'].get(k) or not rec['ja'].get(k)]
    if miss:
        skipped+=1; continue
    bad=[t for t in list(rec['en'].values())+list(rec['ja'].values()) if '"' in t]
    if bad: print('!!',qid,'に二重引用符:',bad[0][:50]); sys.exit(1)
    s,e=span[qid]
    touched=False
    # ja は en より後ろにあるので、ja から先に当てる。
    # en を先に当てると行が増えて ja の位置がずれ、静かに飛ばされる（実際に踏んだ）。
    for lang in ('ja','en'):
        lang_at=next((i for i in range(s,e) if re.match(r'^\s*'+lang+r':\{',lines[i])),None)
        if lang_at is None: continue
        # 挿入で後ろにずれるので、終端は問題ブロックの末尾を動的に取り直す
        blk_end=next((i for i in range(lang_at+1,len(lines)) if re.match(r'^\{ id:"',lines[i])), len(lines))
        stop=next((i for i in range(lang_at+1,blk_end) if re.match(r'^\s*(en|ja):\{',lines[i])),blk_end)
        if any('nos:{' in lines[i] for i in range(lang_at,stop)):
            continue                                  # その言語はもう入っている
        no_at=next((i for i in range(lang_at,stop) if re.match(r'^\s*no:"',lines[i])),None)
        if no_at is None: continue
        touched=True
        # 閉じ括弧は空白を挟むことがある（ja は  " } },  の形）。
        # 正規表現で括弧の並びを当てにいくと空白入りを取り落とすので、
        # 最後の二重引用符より後ろを丸ごとそのまま持ち越す。
        q=lines[no_at].rfind('"')
        if q < 0: print('!!',qid,lang,'の no 行に引用符が無い'); sys.exit(1)
        closing=lines[no_at][q+1:]
        body=['    nos:{']
        for n,k in enumerate(rec['keys']):
            comma='' if n==len(rec['keys'])-1 else ','
            body.append('      %s:"%s"%s' % (k, rec[lang][k], comma))
        body[-1]=body[-1]+'} '+closing
        lines[no_at:no_at+1]=body
    if touched: applied+=1
    else: skipped+=1

io.open(SRC,'w',encoding='utf-8').write('\n'.join(lines))
print(f'流し込み {applied}問  飛ばし {skipped}問')
