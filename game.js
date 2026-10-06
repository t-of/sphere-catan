// ルール本体（DOM なし）。発展カード・最大騎士力・プレイヤー間交換はまだ無い。五角形は 8 枚が市場（生産しない）、4 枚が土地。
export const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
export const COST = { road: { wood: 1, brick: 1 }, settle: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, city: { wheat: 2, ore: 3 } };
const ORDER = [0, 1, 2, 2, 1, 0]; // 初期配置の順（往路・復路）
export const MAX = { road: 15, settle: 5, city: 4 }; // 1 人の駒の上限
const NUMS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12, 5, 9, 3, 4, 10, 11]; // 土地 24 枚（点の合計 76）
const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sum = (r) => RES.reduce((s, k) => s + r[k], 0);

// タイルどうしの隣り合い: 2 頂点を共有していれば隣（五角形どうしは隣り合わない）
export function tileNeighbors(B) {
  const nb = B.tiles.map(() => []);
  for (let i = 0; i < 32; i++) for (let j = i + 1; j < 32; j++) {
    if (B.tiles[i].verts.filter((v) => B.tiles[j].verts.includes(v)).length === 2) { nb[i].push(j); nb[j].push(i); }
  }
  return nb;
}
// 盤の中身（市場・資源・数字）を作る。2 章 案 A の条件 1〜4 を満たすまでまぜ直す。
// 真裏の五角形 6 組のうち 2 組は土地（資源と数字あり）、4 組は市場（3:1 と 2:1 の 3 種）
export function makeTiles(B) {
  const nb = tileNeighbors(B);
  const pairs = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (B.tiles[i].center.reduce((s, x, k) => s + x * B.tiles[j].center[k], 0) < -0.99) pairs.push([i, j]);
  const tiles = B.tiles.map(() => null);
  const kinds = ['any', ...shuffle([...RES]).slice(0, 3)];
  shuffle(pairs);
  pairs.slice(0, 4).forEach(([i, j], k) => { tiles[i] = { res: null, num: 0, market: kinds[k] }; tiles[j] = { res: null, num: 0, market: kinds[k] }; });
  const land = [...pairs.slice(4).flat(), ...[...Array(20).keys()].map((i) => i + 12)];
  const at = new Map(land.map((t, i) => [t, i]));
  const extra = shuffle([...RES]).slice(0, 4); // 土地は 1 種が 4 枚、ほかの 4 種が 5 枚
  let res;
  do { res = shuffle([...extra, ...RES.flatMap((r) => Array(4).fill(r))]); } while (land.some((t, i) => nb[t].some((u) => res[at.get(u)] === res[i])));
  let nums;
  do {
    nums = shuffle([...NUMS]);
    const red = (i) => nums[i] === 6 || nums[i] === 8;
    var ok = land.every((t, i) => nb[t].every((u) => nums[at.get(u)] !== nums[i] && !(red(i) && red(at.get(u)))));
    for (const r of RES) { const p = land.reduce((s, t, i) => s + (res[i] === r ? PIPS[nums[i]] : 0), 0); if (p < 11 || p > 19) ok = false; }
  } while (!ok);
  land.forEach((t, i) => { tiles[t] = { res: res[i], num: nums[i] }; });
  return tiles;
}

export function newGame(B) {
  return {
    B, tiles: makeTiles(B), robber: null, cur: 0, step: 0, phase: 'setupS', dice: null, last: null, discard: null, msg: '',
    longest: null, victims: null, winner: null,
    players: [0, 1, 2].map(() => ({ hand: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 } })),
    vOwn: Array(B.verts.length).fill(null), // {p, city}
    eOwn: Array(B.edges.length).fill(null),
  };
}

const count = (g, p, kind) => (kind === 'road' ? g.eOwn.filter((o) => o === p).length : g.vOwn.filter((v) => v && v.p === p && v.city === (kind === 'city')).length);

// 最長交易路: 辺を 2 度通らない道のりの最長（相手の建物で切れる。輪もそのまま数える）
export function roadLength(g, p) {
  const B = g.B, mine = [];
  B.edges.forEach((e, i) => { if (g.eOwn[i] === p) mine.push(i); });
  const blocked = (v) => g.vOwn[v] && g.vOwn[v].p !== p;
  const used = new Set();
  const go = (v, from) => {
    if (blocked(v)) return 0;
    let best = 0;
    for (const e of B.vEdges[v]) {
      if (g.eOwn[e] !== p || used.has(e)) continue;
      used.add(e);
      const o = B.edges[e][0] === v ? B.edges[e][1] : B.edges[e][0];
      best = Math.max(best, 1 + go(o, e));
      used.delete(e);
    }
    return best;
  };
  let max = 0;
  mine.forEach((e) => B.edges[e].forEach((v) => { used.clear(); used.add(e); max = Math.max(max, 1 + go(B.edges[e][0] === v ? B.edges[e][1] : B.edges[e][0], e)); }));
  return max;
}
// 5 本以上で最長なら 2 点。同点なら持っている人のまま
export function updateLongest(g) {
  const lens = g.players.map((_, p) => roadLength(g, p)), max = Math.max(...lens);
  const top = lens.map((l, p) => (l === max ? p : -1)).filter((p) => p >= 0);
  if (max < 5) g.longest = null;
  else if (top.length === 1) g.longest = top[0];
  else if (!top.includes(g.longest)) g.longest = null;
}

// 銀行との交換の率: 接する市場が自分の資源なら 2、3:1 の市場なら 3、なければ 4
export function tradeRate(g, p, give) {
  let rate = 4;
  g.vOwn.forEach((o, v) => {
    if (!o || o.p !== p) return;
    const m = g.tiles[g.B.verts[v].tiles[0]].market;
    if (m === give) rate = Math.min(rate, 2); else if (m === 'any') rate = Math.min(rate, 3);
  });
  return rate;
}

export const vp = (g, p) => g.vOwn.reduce((s, v) => s + (v && v.p === p ? (v.city ? 2 : 1) : 0), 0) + (g.longest === p ? 2 : 0);
const room = (g, kind) => count(g, g.cur, kind) < MAX[kind];
export const afford = (g, kind) => room(g, kind) && RES.every((r) => g.players[g.cur].hand[r] >= (COST[kind][r] || 0));
const pay = (g, kind) => RES.forEach((r) => { g.players[g.cur].hand[r] -= COST[kind][r] || 0; });

// 開拓地を置ける頂点（距離ルール。本番は自分の道につながること）
export function legalSettle(g) {
  const B = g.B, out = [];
  if (!room(g, 'settle')) return out;
  B.verts.forEach((_, v) => {
    if (g.vOwn[v] || B.vNbr[v].some((n) => g.vOwn[n])) return;
    if (g.phase === 'main' && !B.vEdges[v].some((e) => g.eOwn[e] === g.cur)) return;
    out.push(v);
  });
  return out;
}
export const legalCity = (g) => !room(g, 'city') ? [] : g.vOwn.map((v, i) => (v && v.p === g.cur && !v.city ? i : -1)).filter((i) => i >= 0);
export function legalRoad(g) {
  const B = g.B, out = [];
  if (!room(g, 'road')) return out;
  B.edges.forEach(([a, b], e) => {
    if (g.eOwn[e] != null) return;
    if (g.phase === 'setupR') { if (a === g.last || b === g.last) out.push(e); return; }
    // 端の頂点が自分の建物、または相手の建物でなく自分の道が来ている
    const ok = (v) => (g.vOwn[v] ? g.vOwn[v].p === g.cur : B.vEdges[v].some((x) => g.eOwn[x] === g.cur));
    if (ok(a) || ok(b)) out.push(e);
  });
  return out;
}

export function roll(g) {
  const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
  g.dice = d;
  const n = d[0] + d[1];
  if (n === 7) {
    g.discard = g.players.map((p, i) => (sum(p.hand) >= 8 ? { p: i, n: Math.floor(sum(p.hand) / 2) } : null)).filter(Boolean);
    g.phase = 'discard';
    nextDiscard(g);
    return;
  }
  g.tiles.forEach((t, i) => {
    if (t.num !== n || g.robber === i) return;
    g.B.tiles[i].verts.forEach((v) => { const o = g.vOwn[v]; if (o) g.players[o.p].hand[t.res] += o.city ? 2 : 1; });
  });
  g.phase = 'main';
}
function nextDiscard(g) { // 捨てる人がいなければ盗賊へ
  g.discard = g.discard.filter((d) => d.n > 0);
  g.phase = g.discard.length ? 'discard' : 'robber';
}
export function discard(g, r) {
  const d = g.discard[0], h = g.players[d.p].hand;
  if (!h[r]) return;
  h[r]--; d.n--;
  nextDiscard(g);
}
// 盗賊を土地に動かす。奪える相手が 2 人以上なら 'steal' で手番の人が選ぶ
export function moveRobber(g, t) {
  if (t === g.robber || !g.tiles[t].res) return;
  g.robber = t;
  g.victims = [...new Set(g.B.tiles[t].verts.map((v) => g.vOwn[v]).filter((o) => o && o.p !== g.cur && sum(g.players[o.p].hand) > 0).map((o) => o.p))];
  if (g.victims.length > 1) { g.phase = 'steal'; return; }
  g.phase = 'main';
  if (g.victims.length) steal(g, g.victims[0]);
}
export function steal(g, victim) {
  if (g.phase !== 'steal' && g.phase !== 'main') return;
  if (!g.victims || !g.victims.includes(victim)) return;
  const h = g.players[victim].hand, cards = RES.flatMap((r) => Array(h[r]).fill(r));
  const r = cards[Math.floor(Math.random() * cards.length)];
  h[r]--; g.players[g.cur].hand[r]++;
  g.msg = `プレイヤー${victim + 1}から 1 枚奪った`;
  g.victims = null; g.phase = 'main';
}

export function build(g, kind, i) {
  const me = g.players[g.cur];
  if (g.phase === 'setupS' && kind === 'settle') {
    g.vOwn[i] = { p: g.cur, city: false }; g.last = i; g.phase = 'setupR';
    if (g.step >= 3) g.B.verts[i].tiles.forEach((t) => { const r = g.tiles[t].res; if (r) me.hand[r]++; });
  } else if (g.phase === 'setupR' && kind === 'road') {
    g.eOwn[i] = g.cur; g.step++;
    if (g.step >= ORDER.length) { g.cur = 0; g.phase = 'roll'; g.dice = null; } else { g.cur = ORDER[g.step]; g.phase = 'setupS'; }
  } else {
    pay(g, kind);
    if (kind === 'road') g.eOwn[i] = g.cur;
    else g.vOwn[i] = { p: g.cur, city: kind === 'city' };
  }
  updateLongest(g);
  const w = [g.cur, 0, 1, 2].find((p) => vp(g, p) >= 10);
  if (w != null) { g.cur = w; g.winner = w; g.phase = 'over'; }
}
export function bankTrade(g, give, get) {
  const h = g.players[g.cur].hand;
  const rate = tradeRate(g, g.cur, give);
  if (give === get || h[give] < rate) return false;
  h[give] -= rate; h[get]++;
  return true;
}
export function endTurn(g) { g.cur = (g.cur + 1) % 3; g.phase = 'roll'; g.dice = null; g.msg = ''; }

// 局面図: 局面をまるごと整数の配列 1 本にする（B と msg は入れない）。decode(B, encode(g)) で同じ局面に戻る。
// 長さ 337。並び: 頭 9 [段階, 手番, 初期配置の何手目, サイコロ 2, 直前の開拓地+1, 盗賊+1, 最長交易路+1, 勝者+1]
//   + CPU 交換済み 1 + 捨てる枚数 3 + 奪える相手 3（+1、0 埋め）+ 手札 3×5
//   + タイル 32×3 [資源+1, 数字, 市場（0 なし・1 any・2.. 資源+2）] + 頂点 60×2 [持ち主+1, 0/1 開拓地/2 都市] + 辺 90 [持ち主+1]
export const PHASES = ['setupS', 'setupR', 'roll', 'discard', 'robber', 'steal', 'main', 'over'];
const inc = (x) => (x == null ? 0 : x + 1), dec = (x) => (x ? x - 1 : null);
export function encode(g) {
  const v = g.victims || [];
  return [
    PHASES.indexOf(g.phase), g.cur, g.step, ...(g.dice || [0, 0]), inc(g.last), inc(g.robber), inc(g.longest), inc(g.winner),
    g.cpuTraded ? 1 : 0,
    ...[0, 1, 2].map((p) => (g.phase === 'discard' && g.discard.find((d) => d.p === p)?.n) || 0),
    ...[0, 1, 2].map((i) => inc(v[i])),
    ...g.players.flatMap((p) => RES.map((r) => p.hand[r])),
    ...g.tiles.flatMap((t) => [RES.indexOf(t.res) + 1, t.num, t.market ? (t.market === 'any' ? 1 : RES.indexOf(t.market) + 2) : 0]),
    ...g.vOwn.flatMap((o) => (o ? [o.p + 1, o.city ? 2 : 1] : [0, 0])),
    ...g.eOwn.map(inc),
  ];
}
export function decode(B, a) {
  let i = 0;
  const take = (n) => a.slice(i, (i += n));
  const [ph, cur, step, d1, d2, last, robber, longest, winner, traded] = take(10);
  const disc = take(3), vic = take(3), hands = take(15), tiles = take(96), vs = take(120), es = take(90);
  const phase = PHASES[ph];
  return {
    B, phase, cur, step, dice: d1 ? [d1, d2] : null, last: dec(last), robber: dec(robber), longest: dec(longest), winner: dec(winner), msg: '',
    cpuTraded: !!traded,
    discard: phase === 'discard' ? disc.map((n, p) => ({ p, n })).filter((d) => d.n > 0) : null,
    victims: phase === 'steal' ? vic.filter(Boolean).map(dec) : null,
    players: [0, 1, 2].map((p) => ({ hand: Object.fromEntries(RES.map((r, k) => [r, hands[p * 5 + k]])) })),
    tiles: B.tiles.map((_, t) => {
      const [res, num, mk] = tiles.slice(t * 3, t * 3 + 3);
      return mk ? { res: null, num: 0, market: mk === 1 ? 'any' : RES[mk - 2] } : { res: RES[res - 1], num };
    }),
    vOwn: B.verts.map((_, v) => (vs[v * 2] ? { p: vs[v * 2] - 1, city: vs[v * 2 + 1] === 2 } : null)),
    eOwn: es.map(dec),
  };
}
