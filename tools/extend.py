#!/usr/bin/env python3
"""選択肢の末尾に節を足して、長さを本番の粒度に寄せる。

正解だけが長い状態を消すのが目的なので、伸ばすのは誤答だけ。
正解を縮めると本番の形式から離れるので触らない。

  python3 tools/extend.py adds.tsv
  adds.tsv は  id <TAB> lang <TAB> opt <TAB> 足す文（先頭の区切りも含めて書く）
"""
import io, re, sys

SRC = 'index.html'

def main(path):
    rows = []
    for ln in io.open(path, encoding='utf-8'):
        ln = ln.rstrip('\n')
        if not ln.strip() or ln.startswith('#'): continue
        parts = ln.split('\t')
        if len(parts) < 4:
            print('列が足りない:', ln[:60]); sys.exit(1)
        rows.append((parts[0], parts[1], parts[2], '\t'.join(parts[3:])))

    lines = io.open(SRC, encoding='utf-8').read().split('\n')

    # 正解を伸ばすと本末転倒になるので、道具の側で拒む。
    # 実際に一度やらかしたので、注意ではなくガードにしてある。
    def answers_of(qid, s, e):
        for i in range(s, min(s + 2, e)):
            m = re.search(r'ans:\[([^\]]*)\]', lines[i])
            if m: return re.findall(r'"([A-E])"', m.group(1))
        return []

    # id -> 行範囲
    starts = [(m.group(1), i) for i, l in enumerate(lines)
              for m in [re.match(r'^\{ id:"([^"]+)"', l)] if m]
    span = {}
    for n, (qid, i) in enumerate(starts):
        end = starts[n+1][1] if n+1 < len(starts) else next(j for j in range(i, len(lines)) if lines[j] == '];')
        span[qid] = (i, end)

    done = 0
    forced = []
    for qid, lang, opt, add in rows:
        if qid not in span:
            print(f'!! {qid} が無い'); sys.exit(1)
        s, e = span[qid]
        # その問題の中の lang ブロックの開始行
        lang_at = None
        for i in range(s, e):
            if re.match(r'^\s*' + lang + r':\{', lines[i]): lang_at = i; break
        if lang_at is None:
            print(f'!! {qid} に {lang} が無い'); sys.exit(1)
        # lang ブロック内の opt 行（次の言語ブロックか why の手前まで）
        stop = e
        for i in range(lang_at + 1, e):
            if re.match(r'^\s*(en|ja):\{', lines[i]): stop = i; break
        hit = None
        for i in range(lang_at, stop):
            if re.match(r'^\s*' + opt + r':"', lines[i]): hit = i; break
        if hit is None:
            print(f'!! {qid} {lang} に選択肢 {opt} が無い'); sys.exit(1)
        ans = answers_of(qid, s, e)
        if opt in ans and '--force' in sys.argv:
            forced.append(f'{qid} {lang} {opt}')
        if opt in ans and '--force' not in sys.argv:
            print(f'!! {qid} {lang} {opt} は正解。正解を伸ばすと正解が最長のままになる。'
                  f'誤答を伸ばすこと（どうしても必要なら --force）'); sys.exit(1)
        m = re.match(r'^(\s*' + opt + r':")(.*)("[},]*)$', lines[hit])
        if not m:
            print(f'!! {qid} {lang} {opt} の行を解釈できない: {lines[hit][:70]}'); sys.exit(1)
        if '"' in add:
            print(f'!! 足す文に二重引用符は使えない（{qid} {lang} {opt}）'); sys.exit(1)
        lines[hit] = m.group(1) + m.group(2) + add + m.group(3)
        done += 1

    io.open(SRC, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'追記 {done} 件')
    # --force で正解を伸ばしたら必ず言う。黙って通すとガードが無いのと同じになる
    if forced:
        print(f'  うち正解を伸ばしたもの {len(forced)} 件: ' + ' / '.join(forced))
    if '--force' in sys.argv and not forced:
        print('  --force を付けたが、正解は1つも伸ばしていない（記号を取り違えている可能性）')

    # 当てた問題が実際に通ったかをその場で出す。書いた長さの校正のため。
    import subprocess, re as _re
    ids = sorted({r[0] for r in rows})
    out = subprocess.run(['python3', 'tools/patch.py', '--lens'] + ids,
                         capture_output=True, text=True)
    cur = None; still = []
    for ln in out.stdout.split('\n'):
        m = _re.match(r'^--- (\S+)', ln)
        if m: cur = m.group(1)
        if 'L-1 FAIL' in ln:
            lang = ln.strip().split()[0]
            gap = _re.search(r'正解 (\d+)\s+最長誤答 (\d+)', ln)
            still.append(f'{cur} {lang} あと{int(gap.group(1))-int(gap.group(2))+12}字' if gap else f'{cur} {lang}')
    if still:
        print(f'まだ届かない {len(still)} 件: ' + ' / '.join(still))
    else:
        print('当てた問題はすべて L-1 を通過')

main(sys.argv[1])
