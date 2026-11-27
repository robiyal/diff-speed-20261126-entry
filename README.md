# Diff two texts faster — fast exact makefun-diff drop-in

[![make.fun](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/robiyal/diff-speed-20261126-entry/rank.svg)](https://make.fun/c/diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/robiyal/diff-speed-20261126-entry/reward.svg)](https://make.fun/c/diff-speed-01-run-20261126)

An entry for the [make.fun diff-speed-01-run-20261126 competition](https://make.fun/c/diff-speed-01-run-20261126)
— bounty page: https://make.fun/bounty/diff-speed-01-run-20261126.

## What it does

`solve.js` is a faster drop-in for makefun-diff 1.0.0: it returns make.fun's
own patch of `{ old, new }` exactly as the reference does on every case —
same lines, same Myers greedy search with make.fun's tie-break (a deletion
wins over an insertion when both reach the same point), same hunks — but
without the reference's allocation cost. The reference builds one path object
plus a linked component per `(d, k)` step of the search; this implementation
runs the identical search over interned line ids in typed arrays, keeping one
`Int32Array` of furthest-x values per depth and backtracking the edit script
from those values. `main.ts` is the kit's driver (reads `/input/cases.json`,
writes `/output/answers.json`).

## Layout

- `main.ts` — the program the harness runs.
- `solve.js` — the fast exact diff (`run(input)`).
- `LICENSE` — MIT.
