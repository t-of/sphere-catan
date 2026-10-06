// CPU の手（DOM なし）。game.js の公開関数だけで 1 手ずつ打つ。賢さは「そこそこ」。
// cpuStep(g) は今動く人（捨て札なら捨てる人、それ以外は手番の人）の手を 1 つ打つ。
import { RES, afford, bankTrade, build, discard, endTurn, legalCity, legalRoad, legalSettle, moveRobber, roll, steal, tradeRate, vp } from './game.js';

const pip = (n) => (n ? 6 - Math.abs(7 - n) : 0);
const best = (a, f) => a.reduce((b, x) => (f(x) > f(b) ? x : b), a[0]);
const pips = (g, v) => g.B.verts[v].tiles.reduce((s, t) => s + (g.tiles[t].res ? pip(g.tiles[t].num) : 0), 0);

export function cpuStep(g) {
  const me = g.cur, h = g.players[me].hand;
  switch (g.phase) {
    case 'setupS': build(g, 'settle', best(legalSettle(g), (v) => pips(g, v) + Math.random() * 0.1)); return;
    case 'setupR': { const e = legalRoad(g); build(g, 'road', e[Math.floor(Math.random() * e.length)]); return; }
    case 'roll': g.cpuTraded = false; roll(g); return;
    case 'discard': { const hd = g.players[g.discard[0].p].hand; discard(g, best(RES.filter((r) => hd[r]), (r) => hd[r])); return; }
    case 'robber': {
      // 自分のいない・相手の点が高いタイルへ（数字の確率も少し見る）
      const score = (t) => g.B.tiles[t].verts.reduce((s, v) => { const o = g.vOwn[v]; return o ? s + (o.p === me ? -6 : vp(g, o.p)) * (o.city ? 2 : 1) : s; }, pip(g.tiles[t].num) * 0.3);
      moveRobber(g, best(g.tiles.map((_, t) => t).filter((t) => g.tiles[t].res && t !== g.robber), score));
      return;
    }
    case 'steal': steal(g, best(g.victims, (p) => vp(g, p))); return;
    case 'main': break;
    default: return;
  }
  // 手番: 都市 > 開拓地 > 道
  const c = legalCity(g), s = legalSettle(g);
  if (afford(g, 'city') && c.length) { build(g, 'city', best(c, (v) => pips(g, v))); return; }
  if (afford(g, 'settle') && s.length) { build(g, 'settle', best(s, (v) => pips(g, v))); return; }
  if (afford(g, 'road')) {
    const e = legalRoad(g), far = (i) => g.B.edges[i].map((v) => (g.vOwn[v] || g.B.vNbr[v].some((n) => g.vOwn[n]) ? 0 : pips(g, v)));
    if (e.length) { build(g, 'road', best(e, (i) => Math.max(...far(i)) + Math.random() * 0.1)); return; }
  }
  // 足りなければ銀行交換を 1 回だけ（いちばん多い資源 → いちばん少ない資源）
  if (!g.cpuTraded) {
    g.cpuTraded = true;
    const give = best(RES, (r) => h[r]), get = best(RES, (r) => -h[r]);
    if (h[give] >= tradeRate(g, me, give) + 1 && h[give] - tradeRate(g, me, give) >= h[get] && bankTrade(g, give, get)) return;
  }
  endTurn(g);
}
