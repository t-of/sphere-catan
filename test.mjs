// node test.mjs（依存なし）
import assert from 'node:assert/strict';
import { buildBoard } from './board.js';
import { RES, newGame, makeTiles, tileNeighbors, roadLength, updateLongest, tradeRate, bankTrade, legalRoad, legalSettle, legalCity, afford, moveRobber, steal, vp } from './game.js';

const B = buildBoard(), nb = tileNeighbors(B);
const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const dot = (i, j) => B.tiles[i].center.reduce((s, x, k) => s + x * B.tiles[j].center[k], 0);

// 盤を 200 回作って 2 章の条件を毎回満たす（五角形は 2 組が土地、4 組が市場）
for (let n = 0; n < 200; n++) {
  const t = makeTiles(B), pent = t.slice(0, 12), land = t.filter((x) => x.res);
  const mk = pent.filter((x) => x.market), lp = pent.filter((x) => x.res);
  assert(mk.every((x) => !x.res && !x.num)); assert.equal(mk.length, 8); assert.equal(lp.length, 4);
  assert.equal(mk.filter((x) => x.market === 'any').length, 2);
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (dot(i, j) < -0.99) assert.equal(t[i].market, t[j].market);
  assert.equal(RES.map((r) => land.filter((x) => x.res === r).length).sort().join(), '4,5,5,5,5');
  assert.equal(land.map((x) => x.num).sort((a, b) => a - b).join(), [2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12].join());
  const red = (x) => x.num === 6 || x.num === 8;
  for (let a = 0; a < 32; a++) if (t[a].res) for (const b of nb[a]) if (t[b].res) assert(!(red(t[a]) && red(t[b])) && t[a].num !== t[b].num && t[a].res !== t[b].res);
  RES.forEach((r) => { const p = land.filter((x) => x.res === r).reduce((s, x) => s + PIPS[x.num], 0); assert(p >= 11 && p <= 19); });
}

const g0 = () => newGame(B);
const road = (g, p, es) => es.forEach((e) => { g.eOwn[e] = p; });
const other = (e, v) => (B.edges[e][0] === v ? B.edges[e][1] : B.edges[e][0]);
// 頂点 start から行きどまりまで 1 本の道をたどる（len 本）
const walk = (len, start = 0) => { const es = [], seen = new Set([start]); let v = start; for (let i = 0; i < len; i++) { const e = B.vEdges[v].find((x) => !seen.has(other(x, v))); es.push(e); v = other(e, v); seen.add(v); } return { es, end: v }; };
const ring = (t) => B.edges.map((_, i) => i).filter((i) => B.edges[i].every((v) => B.tiles[t].verts.includes(v)));

// 最長交易路
let g = g0(); road(g, 0, walk(6).es);
assert.equal(roadLength(g, 0), 6);
updateLongest(g); assert.equal(g.longest, 0); assert.equal(vp(g, 0), 2);
// 相手の建物で切れる（3 本目の手前の頂点）
const w = walk(6); g = g0(); road(g, 0, w.es);
g.vOwn[B.edges[w.es[2]].find((v) => B.edges[w.es[1]].includes(v))] = { p: 1, city: false };
assert(roadLength(g, 0) < 6);
// 輪: 五角形のまわり 5 本 = 5、六角形のまわり 6 本（輪）= 6
g = g0(); road(g, 0, ring(0)); assert.equal(roadLength(g, 0), 5);
g = g0(); road(g, 0, ring(12)); assert.equal(roadLength(g, 0), 6);
// 同点なら持っている人のまま
g = g0(); g.longest = 1; road(g, 1, ring(0)); // 五角形の輪 5 本
const far = B.tiles.findIndex((t, i) => i >= 12 && !ring(i).some((e) => ring(0).includes(e)) && !B.tiles[i].verts.some((v) => B.tiles[0].verts.includes(v)));
road(g, 0, ring(far).slice(0, 5)); assert.equal(roadLength(g, 0), 5);
updateLongest(g); assert.equal(g.longest, 1);
g.longest = null; updateLongest(g); assert.equal(g.longest, null); // 同点で持ち主なしならだれも取らない

// 駒の上限（道 15・開拓地 5・都市 4）
g = g0(); g.phase = 'main'; RES.forEach((r) => { g.players[0].hand[r] = 20; });
assert(afford(g, 'road')); road(g, 0, B.edges.map((_, i) => i).slice(0, 15));
assert(!afford(g, 'road')); assert.equal(legalRoad(g).length, 0);
g = g0(); g.phase = 'main'; RES.forEach((r) => { g.players[0].hand[r] = 20; });
[0, 2, 4, 6, 8].forEach((v) => { g.vOwn[v] = { p: 0, city: false }; });
assert(!afford(g, 'settle')); assert.equal(legalSettle(g).length, 0); assert(afford(g, 'city'));
[10, 12, 14, 16].forEach((v) => { g.vOwn[v] = { p: 0, city: true }; });
assert.equal(legalCity(g).length, 0); assert(!afford(g, 'city'));

// 交換の率
g = g0(); g.cur = 0;
const pent = B.verts[0].tiles[0];
assert.equal(tradeRate(g, 0, 'wood'), 4);
g.vOwn[0] = { p: 0, city: false };
g.tiles[pent].market = 'wood'; assert.equal(tradeRate(g, 0, 'wood'), 2); assert.equal(tradeRate(g, 0, 'ore'), 4);
g.tiles[pent].market = 'any'; assert.equal(tradeRate(g, 0, 'ore'), 3);
g.players[0].hand.ore = 3; assert(bankTrade(g, 'ore', 'wood')); assert.equal(g.players[0].hand.wood, 1); assert(!bankTrade(g, 'ore', 'wood'));
assert.equal(tradeRate(g, 1, 'ore'), 4);

// 盗賊: 最初は盤の外、五角形には置けない、相手が 2 人なら選ぶ
g = g0(); g.cur = 0; g.phase = 'robber';
assert.equal(g.robber, null); moveRobber(g, 3); assert.equal(g.robber, null);
const vs = B.tiles[12].verts;
g.vOwn[vs[0]] = { p: 1, city: false }; g.vOwn[vs[2]] = { p: 2, city: false };
g.players[1].hand.wood = 1; g.players[2].hand.ore = 1;
moveRobber(g, 12); assert.equal(g.phase, 'steal'); assert.equal(g.robber, 12);
steal(g, 0); assert.equal(g.phase, 'steal');
steal(g, 2); assert.equal(g.phase, 'main'); assert.equal(g.players[0].hand.ore, 1);

console.log('ok');
