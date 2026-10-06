// ルール本体（DOM なし）。標準カタンから発展カード・港・最長交易路・最大騎士力・プレイヤー間交換を省いた版。
export const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
export const COST = { road: { wood: 1, brick: 1 }, settle: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, city: { wheat: 2, ore: 3 } };
const ORDER = [0, 1, 2, 2, 1, 0]; // 初期配置の順（往路・復路）
const NUMS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12, 3, 4, 5, 6, 8, 9, 10, 11, 4, 5, 9, 10, 6];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sum = (r) => RES.reduce((s, k) => s + r[k], 0);

export function newGame(B) {
  const kinds = shuffle([...Array(7).fill('wood'), ...Array(6).fill('brick'), ...Array(6).fill('sheep'), ...Array(6).fill('wheat'), ...Array(6).fill('ore')]);
  const desert = Math.floor(Math.random() * 12);
  const nums = shuffle([...NUMS]);
  const tiles = B.tiles.map((_, t) => (t === desert ? { res: null, num: 0 } : { res: kinds.pop(), num: nums.pop() }));
  return {
    B, tiles, robber: desert, cur: 0, step: 0, phase: 'setupS', dice: null, last: null, discard: null, msg: '',
    players: [0, 1, 2].map(() => ({ hand: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 } })),
    vOwn: Array(B.verts.length).fill(null), // {p, city}
    eOwn: Array(B.edges.length).fill(null),
  };
}

export const vp = (g, p) => g.vOwn.reduce((s, v) => s + (v && v.p === p ? (v.city ? 2 : 1) : 0), 0);
export const afford = (g, kind) => RES.every((r) => g.players[g.cur].hand[r] >= (COST[kind][r] || 0));
const pay = (g, kind) => RES.forEach((r) => { g.players[g.cur].hand[r] -= COST[kind][r] || 0; });

// 開拓地を置ける頂点（距離ルール。本番は自分の道につながること）
export function legalSettle(g) {
  const B = g.B, out = [];
  B.verts.forEach((_, v) => {
    if (g.vOwn[v] || B.vNbr[v].some((n) => g.vOwn[n])) return;
    if (g.phase === 'main' && !B.vEdges[v].some((e) => g.eOwn[e] === g.cur)) return;
    out.push(v);
  });
  return out;
}
export const legalCity = (g) => g.vOwn.map((v, i) => (v && v.p === g.cur && !v.city ? i : -1)).filter((i) => i >= 0);
export function legalRoad(g) {
  const B = g.B, out = [];
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
// 盗賊を動かし、隣接プレイヤーの 1 人（ランダム）から 1 枚（ランダム）奪う
export function moveRobber(g, t) {
  if (t === g.robber) return;
  g.robber = t;
  const vs = [...new Set(g.B.tiles[t].verts.map((v) => g.vOwn[v]).filter((o) => o && o.p !== g.cur && sum(g.players[o.p].hand) > 0).map((o) => o.p))];
  if (vs.length) {
    const victim = vs[Math.floor(Math.random() * vs.length)], h = g.players[victim].hand;
    const cards = RES.flatMap((r) => Array(h[r]).fill(r));
    const r = cards[Math.floor(Math.random() * cards.length)];
    h[r]--; g.players[g.cur].hand[r]++;
    g.msg = `プレイヤー${victim + 1}から 1 枚奪った`;
  }
  g.phase = 'main';
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
  if (vp(g, g.cur) >= 10) g.phase = 'over';
}
export function bankTrade(g, give, get) {
  const h = g.players[g.cur].hand;
  if (give === get || h[give] < 4) return false;
  h[give] -= 4; h[get]++;
  return true;
}
export function endTurn(g) { g.cur = (g.cur + 1) % 3; g.phase = 'roll'; g.dice = null; g.msg = ''; }
