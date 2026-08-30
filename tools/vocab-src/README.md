# 語彙データの元

`index.html` の `const VOCAB` はここから生成する。**index.html 側を手で直さない。**

```
node tools/vocab_extract.mjs                 # 問題文から頻度と用例を採る → /tmp/vocab-corpus.json
node tools/vocab_build.mjs tools/vocab-src/system.js tools/vocab-src/words-*.tsv
                                             # 日本語と合わせて焼く → /tmp/vocab.js
```

焼いた `/tmp/vocab.js` を `index.html` の `const VOCAB = {` ... `};` と差し替える。

**照合**（`index.html` が手で直されていないかを見る。不一致なら終了コード 1）

```
node tools/vocab_build.mjs --verify tools/vocab-src/system.js tools/vocab-src/words-a.tsv tools/vocab-src/words-b.tsv
```

## ファイル

| | 中身 |
|---|---|
| `system.js` | 接頭辞・接尾辞・語根の体系。例語は名前だけ書く（出現回数は生成時に付く） |
| `words-a.tsv` `words-b.tsv` | 単語帳。`語 \t 日本語 \t 分解 \t 覚え方` の4列 |

## 決め事

- **例語も用例も、137問の本文に実在するものだけ**を使う。作った例文は混ぜない
- 本文に無い語は生成時に落ちる。ただし語根の理解に要る語（submit / inspect など）は
  体系側に残し、`n:0` になって画面では「参考」と破線表示になる
- **頻度は本文の全量から数える。用例に使う文だけを長さ 30〜180 字で絞る。**
  ここを分けないと、長い文にしか出てこない語が「0回」に見える（一度踏んだ）
- 問題文を編集したら頻度がずれる。`node tools/check.mjs` の V-1..4 が検出する
