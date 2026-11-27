# Diff two texts faster — WASM tokenize + WASM Myers exact makefun-diff drop-in

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/robiyal/diff-speed-20261126-entry/rank.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/robiyal/diff-speed-20261126-entry/reward.svg)](https://make.fun/c/diff-speed-01-run-20261126)

An entry for the [make.fun diff-speed-01-run-20261126 competition](https://make.fun/bounty/diff-speed-01-run-20261126)
— bounty page: [https://make.fun/bounty/diff-speed-01-run-20261126](https://make.fun/bounty/diff-speed-01-run-20261126).

## What it does

`solve.js` is a faster drop-in for makefun-diff 1.0.0: it returns make.fun's
own patch of `{ old, new }` exactly as the reference does on every case —
same lines, same Myers greedy search with make.fun's tie-break (a deletion
wins over an insertion when both reach the same point), same hunks — but
two steps run in WebAssembly (a 1,968-byte module, embedded in `solve.js`
as base64, compiled from `myers.ts` with AssemblyScript):

- **Tokenize in WASM:** the raw UTF-8 bytes of both texts are scanned in
  WASM and interned in one shared open-addressing table (FNV-1a hash,
  memcmp-confirmed probes), so no JS string per line and no Map lookup;
  the ids are written straight into the WASM memory the search reads, and
  the patch writer slices line texts from the original strings by the
  UTF-16 spans the scan records. Texts with lone surrogates fall back to
  the JS tokenizer (TextEncoder would corrupt them).
- **Myers search in WASM:** the same search over the same interned line
  ids, with all V arrays in one flat WASM-memory buffer instead of one
  `Int32Array` per depth, and restricted to the diagonal band
  `d + |K-k| <= U`, where `U` is the length of a valid edit script found
  by a patience alignment (unique-line anchors + LIS + resync gaps,
  within ~1% of the true distance on the practice set; its scratch
  buffers are reused across cases). The band is exact: the reference path
  has total `D <= U`, and at depth `d` on diagonal `k` its remaining edits
  are at least `|K-k|`, so the band keeps every state of the reference
  path. Anything unexpected — WASM unavailable, a trap, a failed memory
  grow, the search not reaching both ends — falls back to the identical
  pure-JS search kept in the same file, so exactness never depends on
  the WASM path or on the heuristic.

## Verification

- Practice set: 4/4 identical to the reference.
- Differential fuzz against makefun-diff 1.0.0: 3,533 cases (3,000
  tie-break-heavy small cases, 500 non-ASCII cases incl. astral
  characters, 23 edge cases incl. lone surrogates, 10 cases from the
  kit's own generator) with 0 mismatches; the WASM banded search's edit
  scripts match the pure-JS search's on every case, with 0 fallbacks.
- Local speed on the build VM: `solve()` 169 ms/set vs 199 ms/set for
  V2 and 481 ms/set for the pure-JS V1 in the same run (V2's own report:
  196 ms/set; V1: 412 ms/set) — 7.7x faster than the reference
  (1,304 ms/set).
- Two runs on the practice set write byte-identical `answers.json`.

Anchor-splitting was considered and rejected: the reference itself drops
a unique, same-position line (old A/X/B into new B/X/A keeps A, drops X),
so no anchor split is safe; the patience anchors are used only to bound
`U` for the band, never to split the search.

## Layout

- `main.ts` — the program the harness runs (the kit's driver, verbatim).
- `solve.js` — the fast exact diff (`run(input)`).
- `LICENSE` — MIT.
