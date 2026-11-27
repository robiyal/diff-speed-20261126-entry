// Fast exact drop-in for makefun-diff 1.0.0 (MIT). V3.
//
// Returns make.fun's own patch of { old, new } exactly as vendor/makefun-diff
// 1.0.0 does. One variable vs V2: the tokenize step and the patienceU scratch
// (everything else — the WASM banded Myers search, the patch writer, the
// main.ts driver — is V2 verbatim).
//
// V2's phase profile (per set, this VM) was: tokenize 68 ms, patienceU 22,
// WASM banded Myers 129 (incl. copies), patch 6. The tokenize cost was the
// JS split (one string per line, ~40k per text) plus a Map lookup per line.
// V3 moves it into WebAssembly (myers.ts -> AssemblyScript, tokenize()
// export, embedded below as base64): the raw UTF-8 bytes of both texts are
// scanned in WASM, lines interned in one shared open-addressing table
// (FNV-1a hash, memcmp-confirmed probes, so a hash collision can never
// merge two different lines), and the line ids are written straight into
// the WASM memory the Myers search then reads — no JS string per line, no
// Map, no copy of the ids back to JS. The patch writer slices line texts
// out of the original strings by the UTF-16 spans the scan records (a
// lead byte contributes 1 UTF-16 unit, 2 for a 4-byte lead; continuation
// bytes 0; the '\n' terminator excluded). TextEncoder.encode is the only
// JS-side pass over the bytes, and it is native.
//
// Safety: TextEncoder replaces lone surrogates with U+FFFD, which would
// corrupt equality, so any text containing a surrogate code unit falls
// back to the JS tokenizer (valid astral characters encode losslessly and
// stay on the WASM path). A full intern table likewise falls back to JS.
// Anything unexpected in the WASM Myers search falls back to the identical
// pure-JS search kept in this file, so exactness never depends on WASM.
//
// patienceU reuses its scratch buffers across cases (count arrays sized to
// the largest id seen, LIS/anchor arrays cleared, never reallocated while
// they fit) instead of allocating fresh Int32Arrays per call.
//
// Lines: a text is cut after every "\n"; a last line with no "\n" is a line
// too; two lines are equal only when they are the same code units, newline
// or its absence included. That last bit is why a bare final line carries a
// BARE flag bit on its interned id: its text can never equal a line that
// ends with "\n", so the flag keeps the two apart while one shared map
// interns both texts.

// The WebAssembly core (myers.ts -> AssemblyScript 0.28.20, --optimize
// --runtime stub --importMemory), base64. Spliced from disk by script and
// verified byte-identical to myers.wasm; never hand-copied (V2 incident:
// a hand-transcribed blob was corrupt and silently disabled WASM).
// Decoded and instantiated once at import time; a failure there disables
// the WASM path (JS fallback below).
const WASM_B64 = "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";
const BARE = 1 << 30;
const TABLE_CAP = 262144; // intern-table entries (power of two), 16 bytes each

let wasmMyers = null;
let wasmTokenize = null;
let wasmMemory = null;
try {
  const bytes = Uint8Array.from(atob(WASM_B64), (c) => c.charCodeAt(0));
  wasmMemory = new WebAssembly.Memory({ initial: 1, maximum: 4096 });
  const mod = new WebAssembly.Module(bytes);
  const inst = new WebAssembly.Instance(mod, { env: { memory: wasmMemory } });
  if (typeof inst.exports.myers === 'function') wasmMyers = inst.exports.myers;
  if (typeof inst.exports.tokenize === 'function') wasmTokenize = inst.exports.tokenize;
} catch {
  wasmMyers = null;
  wasmTokenize = null;
  wasmMemory = null;
}

// Layout of the WASM memory for the current case's WASM-tokenize path,
// set by tokenizeWasm (all byte offsets, 4-aligned): ids at aPtr/bPtr,
// line UTF-16 lengths after the table, Myers scratch/runs/V after those.
const LAYOUT = { aPtr: 0, bPtr: 0, scrPtr: 0, outPtr: 0, vPtr: 0 };

const encoder = new TextEncoder();
const SURROGATE_RE = /[\uD800-\uDFFF]/;

/**
 * Tokenize both texts in WASM. Returns { n, m, startA, lenA, startB, lenB }
 * (line counts plus per-line UTF-16 start/length spans into the original
 * strings), with the ids left in WASM memory at LAYOUT.aPtr / LAYOUT.bPtr
 * for the Myers search to read in place. Returns null when the WASM path
 * cannot answer (caller falls back to the JS tokenizer): no WASM, a lone
 * surrogate in either text (TextEncoder would corrupt it), a full intern
 * table, a failed memory grow, or a trap. The span arrays are JS copies,
 * made before the Myers search can grow (and detach) the memory views.
 */
function tokenizeWasm(oldText, newText) {
  if (wasmTokenize === null || wasmMemory === null) return null;
  if (SURROGATE_RE.test(oldText) || SURROGATE_RE.test(newText)) return null;
  const bytesOld = encoder.encode(oldText);
  const bytesNew = encoder.encode(newText);
  const oldPtr = 0;
  const newPtr = (bytesOld.length + 3) & ~3;
  const tablePtr = (newPtr + bytesNew.length + 3) & ~3;
  const lenAPtr = tablePtr + TABLE_CAP * 16;
  const lenBPtr = lenAPtr + 4 * (bytesOld.length + 1);
  const aPtr = lenBPtr + 4 * (bytesNew.length + 1);
  const bPtr = aPtr + 4 * (bytesOld.length + 1);
  const scrPtr = bPtr + 4 * (bytesNew.length + 1);
  const outPtr = scrPtr + 4 * (bytesOld.length + bytesNew.length + 2 + 8);
  const vPtr = outPtr + 8 * (bytesOld.length + bytesNew.length + 2 + 8);
  LAYOUT.aPtr = aPtr;
  LAYOUT.bPtr = bPtr;
  LAYOUT.scrPtr = scrPtr;
  LAYOUT.outPtr = outPtr;
  LAYOUT.vPtr = vPtr;
  try {
    const need = vPtr + 64;
    if (wasmMemory.buffer.byteLength < need) {
      const grow = Math.ceil((need - wasmMemory.buffer.byteLength) / 65536);
      if (wasmMemory.grow(grow) < 0) return null;
    }
    const u8 = new Uint8Array(wasmMemory.buffer);
    u8.set(bytesOld, oldPtr);
    u8.set(bytesNew, newPtr);
    // scrPtr doubles as the tokenize result slot (n, m, distinct) — the
    // Myers scratch does not need it until after tokenize returns.
    const st = wasmTokenize(
      oldPtr, bytesOld.length, newPtr, bytesNew.length,
      tablePtr, TABLE_CAP, aPtr, bPtr, lenAPtr, lenBPtr, scrPtr
    );
    if (st !== 0) return null;
    const i32 = new Int32Array(wasmMemory.buffer);
    const n = i32[scrPtr >> 2];
    const m = i32[(scrPtr + 4) >> 2];
    const lenA = new Int32Array(wasmMemory.buffer, lenAPtr, n).slice();
    const lenB = new Int32Array(wasmMemory.buffer, lenBPtr, m).slice();
    const startA = new Int32Array(n);
    const startB = new Int32Array(m);
    let s = 0;
    for (let i = 0; i < n; i++) {
      startA[i] = s;
      s += lenA[i] + 1;
    }
    s = 0;
    for (let i = 0; i < m; i++) {
      startB[i] = s;
      s += lenB[i] + 1;
    }
    return { n, m, startA, lenA, startB, lenB };
  } catch {
    return null;
  }
}

/** Split a text into lines (parts without "\n") and interned line ids. */
function tokenize(text, map) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const n = last + (parts[last] !== '' ? 1 : 0);
  const ids = new Int32Array(n);
  for (let i = 0; i < last; i++) {
    const s = parts[i];
    let id = map.get(s);
    if (id === undefined) {
      id = map.size;
      map.set(s, id);
    }
    ids[i] = id;
  }
  if (n > last) {
    const s = parts[last];
    let id = map.get(s);
    if (id === undefined) {
      id = map.size;
      map.set(s, id);
    }
    ids[last] = id | BARE;
  }
  return { ids, parts, n };
}

/** UTF-16 start/length spans of a JS-tokenized text's lines. */
function spansFromParts(parts, n) {
  const lens = new Int32Array(n);
  const starts = new Int32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    lens[i] = parts[i].length;
    starts[i] = s;
    s += lens[i] + 1;
  }
  return { starts, lens };
}

/**
 * Length of a valid edit script for A[0..N) into B[0..M), by a resync
 * walk: snake while equal, else jump to the next resync found by indexOf
 * within W lines (insert the lines before it, or delete up to it), else
 * delete one line and retry. Every step is a legal edit, so the total is
 * a valid script length and therefore >= the true distance D. Only used
 * for short gaps between patience anchors, where it tracks D closely.
 */
function resyncU(A, B, N, M, W) {
  let x = 0;
  let y = 0;
  let u = 0;
  while (x < N || y < M) {
    while (x < N && y < M && A[x] === B[y]) {
      x++;
      y++;
    }
    if (x >= N) return u + (M - y);
    if (y >= M) return u + (N - x);
    const pB = B.subarray(y, Math.min(M, y + W)).indexOf(A[x]);
    const pA = A.subarray(x, Math.min(N, x + W)).indexOf(B[y]);
    if (pB >= 0 && (pA < 0 || pB <= pA)) {
      u += pB;
      y += pB;
    } else if (pA >= 0) {
      u += pA;
      x += pA;
    } else {
      x++;
      u++;
    }
  }
  return u;
}

// patienceU scratch, reused across cases (V3): the count arrays are grown
// only when a larger id range appears and zeroed over the used range;
// the LIS/anchor arrays are cleared by length, never reallocated while
// they fit. Nothing here may retain a per-case view into WASM memory.
let patCA = null;
let patCB = null;
let patPosB = null;
let patPrev = null;
const patAi = [];
const patAj = [];
const patTails = [];
const patAnc = []; // flat [i, j] anchor pairs, in reverse (LIS-walk) order

/**
 * Length of a valid edit script for A[0..N) into B[0..M) (patience
 * alignment): lines occurring exactly once in each text are anchors; the
 * longest increasing subsequence of their B positions (in A order) is a
 * monotone alignment, and every gap between consecutive anchors — plus
 * the head and tail gaps — is scored by resyncU, which is itself a valid
 * script. The sum is therefore a valid script length, >= D. On the
 * practice set it lands within ~1% of D (U/D 1.001-1.008), which is what
 * makes the WASM diagonal band cut the search roughly in half. A bare
 * final line (BARE flag) only anchors to a bare line with the same text.
 */
function patienceU(A, B, N, M) {
  let maxId = 0;
  for (let i = 0; i < N; i++) {
    const id = A[i] & ~BARE;
    if (id > maxId) maxId = id;
  }
  for (let i = 0; i < M; i++) {
    const id = B[i] & ~BARE;
    if (id > maxId) maxId = id;
  }
  if (patCA === null || patCA.length < maxId + 1) {
    patCA = new Int32Array(maxId + 1);
    patCB = new Int32Array(maxId + 1);
    patPosB = new Int32Array(maxId + 1);
  }
  // Fill always: fresh allocations are zeros, but posB needs -1.
  patCA.fill(0, 0, maxId + 1);
  patCB.fill(0, 0, maxId + 1);
  patPosB.fill(-1, 0, maxId + 1);
  const cA = patCA;
  const cB = patCB;
  const posB = patPosB;
  for (let i = 0; i < N; i++) cA[A[i] & ~BARE]++;
  for (let i = 0; i < M; i++) cB[B[i] & ~BARE]++;
  for (let j = 0; j < M; j++) {
    const id = B[j] & ~BARE;
    if (cB[id] === 1) posB[id] = j;
  }
  patAi.length = 0;
  patAj.length = 0;
  for (let i = 0; i < N; i++) {
    const id = A[i] & ~BARE;
    if (cA[id] !== 1 || cB[id] !== 1) continue;
    const j = posB[id];
    if (j < 0 || (A[i] & BARE) !== (B[j] & BARE)) continue;
    patAi.push(i);
    patAj.push(j);
  }
  const n = patAi.length;
  if (patPrev === null || patPrev.length < n) patPrev = new Int32Array(n);
  patPrev.fill(-1, 0, n); // fresh allocations are zeros, not -1: fill always
  const prev = patPrev;
  const tails = patTails;
  tails.length = 0;
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (patAj[tails[mid]] < patAj[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  patAnc.length = 0;
  let cur = tails.length ? tails[tails.length - 1] : -1;
  while (cur >= 0) {
    patAnc.push(patAi[cur], patAj[cur]);
    cur = prev[cur];
  }
  let U = 0;
  let pi = -1;
  let pj = -1;
  // patAnc holds the anchors last-first; walking it backwards is forward.
  for (let a = patAnc.length - 2; a >= 0; a -= 2) {
    const i = patAnc[a];
    const j = patAnc[a + 1];
    const ga = i - pi - 1;
    const gb = j - pj - 1;
    if (ga > 0 || gb > 0) {
      if (ga === 0) U += gb;
      else if (gb === 0) U += ga;
      else U += resyncU(A.subarray(pi + 1, i), B.subarray(pj + 1, j), ga, gb, 64);
    }
    pi = i;
    pj = j;
  }
  const ga = N - pi - 1;
  const gb = M - pj - 1;
  if (ga > 0 || gb > 0) {
    if (ga === 0) U += gb;
    else if (gb === 0) U += ga;
    else U += resyncU(A.subarray(pi + 1, N), B.subarray(pj + 1, M), ga, gb, 64);
  }
  return U;
}

/**
 * The edit script of A[0..N) into B[0..M) via WebAssembly, as runs
 * [kind, count] in order, kind 0 = keep, 1 = delete, 2 = insert.
 * WASM-tokenize path: the ids already live in WASM memory at aPtr/bPtr
 * (A/B are JS views of them, used only for patienceU, which runs before
 * the search can grow the memory). Returns null when the WASM path cannot
 * answer (caller falls back — see run(), which then re-runs the whole case
 * through the JS tokenizer, since the views may have detached on grow).
 */
function myersRunsWasmPtr(aPtr, bPtr, A, B, N, M) {
  if (wasmMyers === null || wasmMemory === null) return null;
  if (N === 0 && M === 0) return [];
  const U = patienceU(A, B, N, M);
  const scrPtr = LAYOUT.scrPtr;
  const outPtr = LAYOUT.outPtr;
  const vPtr = LAYOUT.vPtr;
  try {
    const need = vPtr + 64;
    if (wasmMemory.buffer.byteLength < need) {
      const grow = Math.ceil((need - wasmMemory.buffer.byteLength) / 65536);
      if (wasmMemory.grow(grow) < 0) return null;
    }
    const count = wasmMyers(aPtr, N, bPtr, M, vPtr, outPtr, scrPtr, U);
    if (typeof count !== 'number' || count < 0) return null;
    const out = new Int32Array(wasmMemory.buffer, outPtr, count * 2);
    const runs = new Array(count);
    for (let i = 0; i < count; i++) runs[i] = [out[i * 2], out[i * 2 + 1]];
    return runs;
  } catch {
    return null;
  }
}

/**
 * The edit script of A[0..N) into B[0..M) via WebAssembly, as runs
 * [kind, count] in order, kind 0 = keep, 1 = delete, 2 = insert.
 * JS-tokenize path: the ids are JS arrays, copied into WASM memory first
 * (V2's path, kept for the fallback tokenizer). Returns null when the
 * WASM path cannot answer (caller falls back to myersRuns below).
 */
function myersRunsWasm(A, B, N, M) {
  if (wasmMyers === null || wasmMemory === null) return null;
  if (N === 0 && M === 0) return [];
  const U = patienceU(A, B, N, M);
  // Layout (bytes, all 4-aligned): A | B | scratch | runs | V storage.
  const aPtr = 0;
  const bPtr = 4 * N;
  const scrPtr = bPtr + 4 * M;
  const outPtr = scrPtr + 4 * (N + M + 8);
  const vPtr = outPtr + 8 * (N + M + 8);
  try {
    const need = vPtr + 64;
    if (wasmMemory.buffer.byteLength < need) {
      const grow = Math.ceil((need - wasmMemory.buffer.byteLength) / 65536);
      if (wasmMemory.grow(grow) < 0) return null;
    }
    const mem = new Int32Array(wasmMemory.buffer);
    mem.set(A, aPtr >> 2);
    mem.set(B, bPtr >> 2);
    const count = wasmMyers(aPtr, N, bPtr, M, vPtr, outPtr, scrPtr, U);
    if (typeof count !== 'number' || count < 0) return null;
    const out = new Int32Array(wasmMemory.buffer, outPtr, count * 2);
    const runs = new Array(count);
    for (let i = 0; i < count; i++) runs[i] = [out[i * 2], out[i * 2 + 1]];
    return runs;
  } catch {
    return null;
  }
}

/**
 * The edit script of A[0..N) into B[0..M) as runs [kind, count] in order,
 * kind 0 = keep, 1 = delete, 2 = insert. Exact Myers greedy search per the
 * reference: for d = 0, 1, ... and k = -d..d step 2, the furthest x on k is
 * the deletion from k-1 (x = V[k-1] + 1) or the insertion from k+1
 * (x = V[k+1]), whichever reaches further into the old text, deletion on a
 * tie; a move past either text's end is no candidate; then the snake follows
 * every equal line as far as it goes. V[d] is stored as the furthest x + 1
 * per diagonal (0 = that diagonal has no path), indexed k + d + 2 in an
 * array of length 2d + 5 so the two neighbours are always in bounds.
 */
function myersRuns(A, B, N, M) {
  if (N === 0 && M === 0) return [];
  const Vs = [];
  const v0 = new Int32Array(5);
  let x = 0;
  let y = 0;
  while (x < N && y < M && A[x] === B[y]) {
    x++;
    y++;
  }
  v0[2] = x + 1;
  Vs.push(v0);
  let D = 0;
  if (x < N || y < M) {
    let done = false;
    for (let d = 1; d <= N + M && !done; d++) {
      const v = new Int32Array(2 * d + 5);
      const vp = Vs[d - 1];
      Vs.push(v);
      for (let k = -d; k <= d; k += 2) {
        const sRem = vp[k + d];
        const sAdd = vp[k + d + 2];
        const canRem = sRem !== 0 && sRem <= N;
        const canAdd = sAdd !== 0 && sAdd - k <= M + 1;
        if (!canRem && !canAdd) continue;
        let xx;
        if (canRem && (!canAdd || sRem + 1 >= sAdd)) xx = sRem;
        else xx = sAdd - 1;
        let yy = xx - k;
        while (xx < N && yy < M && A[xx] === B[yy]) {
          xx++;
          yy++;
        }
        v[k + d + 2] = xx + 1;
        if (xx >= N && yy >= M) {
          D = d;
          done = true;
          break;
        }
      }
    }
    if (!done) throw new Error('makefun-diff: the search ended without reaching both ends');
  }
  // Backtrack from (N, M): at each depth the move is re-decided from V[d-1]
  // with the same comparison the forward search used, then the snake is
  // walked back to the move's start point.
  const rev = [];
  let cx = N;
  let cy = M;
  for (let d = D; d >= 1; d--) {
    const k = cx - cy;
    const vp = Vs[d - 1];
    const sRem = vp[k + d];
    const sAdd = vp[k + d + 2];
    const canRem = sRem !== 0 && sRem <= N;
    const canAdd = sAdd !== 0 && sAdd - k <= M + 1;
    let prevX;
    let prevY;
    let isDel;
    if (canRem && (!canAdd || sRem + 1 >= sAdd)) {
      isDel = true;
      prevX = sRem - 1;
      prevY = prevX - (k - 1);
    } else {
      isDel = false;
      prevX = sAdd - 1;
      prevY = prevX - (k + 1);
    }
    const sx = prevX + (isDel ? 1 : 0);
    while (cx > sx) {
      rev.push(0);
      cx--;
      cy--;
    }
    if (isDel) {
      rev.push(1);
      cx--;
    } else {
      rev.push(2);
      cy--;
    }
  }
  while (cx > 0) {
    rev.push(0);
    cx--;
    cy--;
  }
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const kind = rev[i];
    const lastRun = runs[runs.length - 1];
    if (lastRun !== undefined && lastRun[0] === kind) lastRun[1]++;
    else runs.push([kind, 1]);
  }
  return runs;
}

/** makefun-diff 1.0.0's answer for one case's input. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const oldText = input.old;
  const newText = input.new;
  // Two attempts at most: the WASM-tokenize path first; if its Myers search
  // cannot answer, the whole case is re-run through the JS tokenizer (the
  // WASM-memory views may have detached when the search grew the memory).
  // The JS-tokenize attempt always resolves (its own fallback is myersRuns).
  let A;
  let B;
  let n;
  let m;
  let startA;
  let lenA;
  let startB;
  let lenB;
  let lo = 0;
  let hiA = 0;
  let hiB = 0;
  let mid = null;
  let useWasmTok = true;
  for (let attempt = 0; attempt < 2 && mid === null; attempt++) {
    let wasmTok = false;
    if (useWasmTok) {
      const tok = tokenizeWasm(oldText, newText);
      if (tok !== null) {
        wasmTok = true;
        n = tok.n;
        m = tok.m;
        startA = tok.startA;
        lenA = tok.lenA;
        startB = tok.startB;
        lenB = tok.lenB;
        A = new Int32Array(wasmMemory.buffer, LAYOUT.aPtr, n);
        B = new Int32Array(wasmMemory.buffer, LAYOUT.bPtr, m);
      }
    }
    if (!wasmTok) {
      const map = new Map();
      const a = tokenize(oldText, map);
      const b = tokenize(newText, map);
      A = a.ids;
      B = b.ids;
      n = a.n;
      m = b.n;
      const sa = spansFromParts(a.parts, n);
      const sb = spansFromParts(b.parts, m);
      startA = sa.starts;
      lenA = sa.lens;
      startB = sb.starts;
      lenB = sb.lens;
    }
    // The common prefix, then the common suffix of what is left.
    lo = 0;
    while (lo < n && lo < m && A[lo] === B[lo]) lo++;
    hiA = n;
    hiB = m;
    while (hiA > lo && hiB > lo && A[hiA - 1] === B[hiB - 1]) {
      hiA--;
      hiB--;
    }
    const midN = hiA - lo;
    const midM = hiB - lo;
    if (wasmTok) {
      mid = myersRunsWasmPtr(
        LAYOUT.aPtr + 4 * lo, LAYOUT.bPtr + 4 * lo,
        A.subarray(lo, hiA), B.subarray(lo, hiB), midN, midM
      );
      if (mid === null) {
        useWasmTok = false;
        continue;
      }
    } else {
      mid = myersRunsWasm(A.subarray(lo, hiA), B.subarray(lo, hiB), midN, midM)
        ?? myersRuns(A.subarray(lo, hiA), B.subarray(lo, hiB), midN, midM);
    }
  }
  const runs = [];
  if (lo > 0) runs.push([0, lo]);
  for (let i = 0; i < mid.length; i++) runs.push(mid[i]);
  if (n - hiA > 0) runs.push([0, n - hiA]);

  // The change runs: each a stretch of deletions and insertions between two kept lines.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (let i = 0; i < runs.length; i++) {
    const kind = runs[i][0];
    const count = runs[i][1];
    if (kind === 0) {
      o += count;
      p += count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === 1) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * 3 kept lines apart share one.
  const hunks = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 6) h.push(c);
    else hunks.push([c]);
  }
  const bareA = n > 0 && !oldText.endsWith('\n') ? n - 1 : -1;
  const bareB = m > 0 && !newText.endsWith('\n') ? m - 1 : -1;
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (let hi = 0; hi < hunks.length; hi++) {
    const h = hunks[hi];
    const first = h[0];
    const lastC = h[h.length - 1];
    const oldStart = Math.max(0, first.o - 3);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(3, n - (lastC.o + lastC.dels));
    const oldEnd = lastC.o + lastC.dels + after;
    const newEnd = lastC.p + lastC.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (let ci = 0; ci < h.length; ci++) {
      const c = h[ci];
      for (; at < c.o; at++) out.push('=' + oldText.slice(startA[at], startA[at] + lenA[at]) + (at === bareA ? '\n%\n' : '\n'));
      for (let j = 0; j < c.dels; j++) out.push('-' + oldText.slice(startA[c.o + j], startA[c.o + j] + lenA[c.o + j]) + (c.o + j === bareA ? '\n%\n' : '\n'));
      for (let j = 0; j < c.ins; j++) out.push('+' + newText.slice(startB[c.p + j], startB[c.p + j] + lenB[c.p + j]) + (c.p + j === bareB ? '\n%\n' : '\n'));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push('=' + oldText.slice(startA[at], startA[at] + lenA[at]) + (at === bareA ? '\n%\n' : '\n'));
  }
  return out.join('');
}
