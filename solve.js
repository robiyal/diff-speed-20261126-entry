// Fast exact drop-in for makefun-diff 1.0.0 (MIT).
//
// Returns make.fun's own patch of { old, new } exactly as vendor/makefun-diff
// 1.0.0 does. The Myers search itself runs in WebAssembly (myers.ts, compiled
// with AssemblyScript, embedded below as base64: 1,168 bytes): the same greedy
// search as the pure-JS V1 — same diagonals, same order, same tie-break (a
// deletion wins over an insertion when both reach the same point), same
// snakes, no edge pruning — over the same interned line ids, with all V
// arrays in one flat WASM-memory buffer instead of one Int32Array per depth,
// and with the search restricted to the diagonal band d + |K-k| <= U, where
// U is the length of a valid edit script (patienceU below, within ~1% of
// the true distance on the practice set). The band is exact: the reference
// path has total D <= U, and at depth d on diagonal k its remaining edits
// are at least |K-k|, so d + |K-k| <= D <= U on every state of the
// reference path. Anything unexpected (WASM unavailable, a trap, a failed
// memory grow, the search not reaching both ends — including a U below the
// true distance, which cannot happen for a valid script) falls back to the
// identical pure-JS search kept in this file, so exactness never depends
// on the WASM path or on the heuristic.
//
// The patch/hunk writer is a direct port of the reference's. Verified exact:
// practice set 4/4 identical to the reference, plus a differential fuzz
// against the reference (see the submission report). Anchor-splitting was
// considered and rejected: the reference itself drops a unique, same-position
// line (old A/X/B into new B/X/A keeps A, drops X), so no anchor split is safe.
//
// Lines: a text is cut after every "\n"; a last line with no "\n" is a line
// too; two lines are equal only when they are the same code units, newline
// or its absence included. That last bit is why a bare final line carries a
// BARE flag bit on its interned id: its text can never equal a line that
// ends with "\n", so the flag keeps the two apart while one shared map
// interns both texts.

// The WebAssembly Myers core (myers.ts -> AssemblyScript 0.28.20, --optimize
// --runtime stub --importMemory), base64. Decoded and instantiated once at
// import time; a failure there disables the WASM path (JS fallback below).
const WASM_B64 = "AGFzbQEAAAABDQFgCH9/f39/f39/AX8CDwEDZW52Bm1lbW9yeQIAAAMCAQAHEgIFbXllcnMAAAZtZW1vcnkCAArNCAHKCAEQfyABIANyRQRAQQAPCwNAIAMgDEogASAISnEEfyAAIAhBAnRqKAIAIAIgDEECdGooAgBGBUEACwRAIAhBAWohCCAMQQFqIQwMAQsLIAQgCEEBajYCCCAEQQA2AgAgBEEANgIEIARBADYCDCAEQQA2AhAgAyAMTCABIAhMcSEQPwBBEHQhCSABIANrIRJBASEIA0AgEEUgCCABIANqTHEEQCAEIAhBAWoiCyALbCALQQJ0akECdGoiCyAJSgRAIAsgCWtB//8DakEQdUEQakAAQQBIBEBBfw8LPwBBEHQhCQsgBCAIQQFrIgsgC2wgC0ECdGpBAnRqIRMgBCAIIAhsIAhBAnRqQQJ0aiIPQQA2AgAgD0EANgIEIA8gCEEBdCILQQNqQQJ0akEANgIAIA8gC0EEakECdGpBADYCACASIAcgCGsiDmsiDEEAIAhrIgtOBEAgDCELCyALQQFqIAsgCCALa0EBcRshDCAOIBJqIgsgCEoEQCAIIQsLIAtBAWsgCyAIIAtrQQFxGyEUA0AgDCAUTARAAkAgEyAIIAxqIgtBAnRqKAIAIRYCQCADQQFqIBMgC0ECakECdCIVaigCACIXIAxrTkEAIBcbIgsgASAWTkEAIBYbIg5yRQRAIA8gFWpBADYCAAwBCyAWIBdBAWsgDgR/IAtFIBZBAWogF05yBUEACxsiDiAMayELA0AgAyALSiABIA5KcQR/IAAgDkECdGooAgAgAiALQQJ0aigCAEYFQQALBEAgDkEBaiEOIAtBAWohCwwBCwsgDyAIIAxqQQJqQQJ0aiAOQQFqNgIAIAMgC0wgASAOTHEEQCAIIQpBASEQDAILCyAMQQJqIQwMAgsLCyAIQQFqIQgMAQsLIBBFBEBBfg8LIAEhAiADIQADQCAKQQBKBEAgBCAKQQFrIgcgB2wgB0ECdGpBAnRqIgcgAiAAayIIIApqIglBAnRqKAIAIQsgA0EBaiAHIAlBAmpBAnRqKAIAIgcgCGtOQQAgBxshCCABIAtOQQAgCxsEfyAIRSALQQFqIAdOcgVBAAsEf0EBIQwgC0EBawVBACEMIAdBAWsLIAxqIQcDQCACIAdKBEAgBiANQQJ0akEANgIAIA1BAWohDSACQQFrIQIgAEEBayEADAELCyAMBEAgBiANQQJ0akEBNgIAIAJBAWshAgUgBiANQQJ0akECNgIAIABBAWshAAsgDUEBaiENIApBAWshCgwBCwsDQCACQQBKBEAgBiANQQJ0akEANgIAIA1BAWohDSACQQFrIQIgAEEBayEADAELCyANQQFrIQMDQCADQQBOBEAgBiADQQJ0aigCACEAQQEhAiADQQFrIQMDQCADQQBOBH8gBiADQQJ0aigCACAARgVBAAsEQCACQQFqIQIgA0EBayEDDAELCyAFIBFBA3RqIgEgADYCACABIAI2AgQgEUEBaiERDAELCyARCw==";
const BARE = 1 << 30;

let wasmMyers = null;
let wasmMemory = null;
try {
  const bytes = Uint8Array.from(atob(WASM_B64), (c) => c.charCodeAt(0));
  wasmMemory = new WebAssembly.Memory({ initial: 1, maximum: 4096 });
  const mod = new WebAssembly.Module(bytes);
  const inst = new WebAssembly.Instance(mod, { env: { memory: wasmMemory } });
  if (typeof inst.exports.myers === 'function') wasmMyers = inst.exports.myers;
} catch {
  wasmMyers = null;
  wasmMemory = null;
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
  const cA = new Int32Array(maxId + 1);
  const cB = new Int32Array(maxId + 1);
  for (let i = 0; i < N; i++) cA[A[i] & ~BARE]++;
  for (let i = 0; i < M; i++) cB[B[i] & ~BARE]++;
  const posB = new Int32Array(maxId + 1).fill(-1);
  for (let j = 0; j < M; j++) {
    const id = B[j] & ~BARE;
    if (cB[id] === 1) posB[id] = j;
  }
  const ai = [];
  const aj = [];
  for (let i = 0; i < N; i++) {
    const id = A[i] & ~BARE;
    if (cA[id] !== 1 || cB[id] !== 1) continue;
    const j = posB[id];
    if (j < 0 || (A[i] & BARE) !== (B[j] & BARE)) continue;
    ai.push(i);
    aj.push(j);
  }
  const n = ai.length;
  const tails = [];
  const prev = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (aj[tails[mid]] < aj[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }
  let U = 0;
  let pi = -1;
  let pj = -1;
  let cur = tails.length ? tails[tails.length - 1] : -1;
  const anchors = [];
  while (cur >= 0) {
    anchors.push([ai[cur], aj[cur]]);
    cur = prev[cur];
  }
  anchors.reverse();
  anchors.push([N, M]);
  for (let a = 0; a < anchors.length; a++) {
    const i = anchors[a][0];
    const j = anchors[a][1];
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
  return U;
}

/**
 * The edit script of A[0..N) into B[0..M) via WebAssembly, as runs
 * [kind, count] in order, kind 0 = keep, 1 = delete, 2 = insert.
 * Returns null when the WASM path cannot answer (caller falls back).
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
  const map = new Map();
  const a = tokenize(input.old, map);
  const b = tokenize(input.new, map);
  const A = a.ids;
  const B = b.ids;
  const n = a.n;
  const m = b.n;
  // The common prefix, then the common suffix of what is left.
  let lo = 0;
  while (lo < n && lo < m && A[lo] === B[lo]) lo++;
  let hiA = n;
  let hiB = m;
  while (hiA > lo && hiB > lo && A[hiA - 1] === B[hiB - 1]) {
    hiA--;
    hiB--;
  }
  const runs = [];
  if (lo > 0) runs.push([0, lo]);
  const midN = hiA - lo;
  const midM = hiB - lo;
  const mid = myersRunsWasm(A.subarray(lo, hiA), B.subarray(lo, hiB), midN, midM)
    ?? myersRuns(A.subarray(lo, hiA), B.subarray(lo, hiB), midN, midM);
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
  const aParts = a.parts;
  const bParts = b.parts;
  const bareA = aParts[aParts.length - 1] !== '' ? n - 1 : -1;
  const bareB = bParts[bParts.length - 1] !== '' ? m - 1 : -1;
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
      for (; at < c.o; at++) out.push('=' + aParts[at] + (at === bareA ? '\n%\n' : '\n'));
      for (let j = 0; j < c.dels; j++) out.push('-' + aParts[c.o + j] + (c.o + j === bareA ? '\n%\n' : '\n'));
      for (let j = 0; j < c.ins; j++) out.push('+' + bParts[c.p + j] + (c.p + j === bareB ? '\n%\n' : '\n'));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push('=' + aParts[at] + (at === bareA ? '\n%\n' : '\n'));
  }
  return out.join('');
}
