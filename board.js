// 切頂二十面体（サッカーボール）の盤のグラフ。three.js に依存しない（node でも数えられる）。
// tiles: 32（五角形 12 + 六角形 20）、verts: 60、edges: 90。
const PHI = (1 + Math.sqrt(5)) / 2;
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const lerp = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

export function buildBoard() {
  // 正二十面体: 頂点 12・辺 30・面 20
  const ico = [];
  for (const a of [1, -1]) for (const b of [PHI, -PHI]) ico.push([0, a, b], [a, b, 0], [b, 0, a]);
  let min = Infinity;
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) min = Math.min(min, ico[i].reduce((s, x, k) => s + (x - ico[j][k]) ** 2, 0));
  const adj = (i, j) => Math.abs(ico[i].reduce((s, x, k) => s + (x - ico[j][k]) ** 2, 0) - min) < 1e-6;
  const iEdges = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (adj(i, j)) iEdges.push([i, j]);
  const faces = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) if (adj(i, j) && adj(j, k) && adj(i, k)) faces.push([i, j, k]);

  // タイル: 0..11 = 五角形（二十面体の頂点）、12..31 = 六角形（面）
  const verts = []; // {pos, tiles:[3]}
  iEdges.forEach(([a, b]) => {
    const fs = faces.map((f, fi) => [f, fi]).filter(([f]) => f.includes(a) && f.includes(b)).map(([, fi]) => 12 + fi);
    verts.push({ pos: norm(lerp(ico[a], ico[b], 1 / 3)), tiles: [a, ...fs] });
    verts.push({ pos: norm(lerp(ico[b], ico[a], 1 / 3)), tiles: [b, ...fs] });
  });
  // 辺: 2 頂点が 2 枚のタイルを共有していれば隣り合う
  const edges = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    if (verts[i].tiles.filter((t) => verts[j].tiles.includes(t)).length === 2) edges.push([i, j]);
  }
  const tiles = [];
  for (let t = 0; t < 32; t++) tiles.push({ verts: [], pent: t < 12 });
  verts.forEach((v, i) => v.tiles.forEach((t) => tiles[t].verts.push(i)));
  tiles.forEach((t) => {
    const c = norm(t.verts.reduce((s, i) => s.map((x, k) => x + verts[i].pos[k]), [0, 0, 0]));
    t.center = c;
    // 中心まわりの角度で並べる
    const ref = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([c[1] * ref[2] - c[2] * ref[1], c[2] * ref[0] - c[0] * ref[2], c[0] * ref[1] - c[1] * ref[0]]);
    const w = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]];
    const ang = (i) => { const p = verts[i].pos; return Math.atan2(p[0] * w[0] + p[1] * w[1] + p[2] * w[2], p[0] * u[0] + p[1] * u[1] + p[2] * u[2]); };
    t.verts.sort((a, b) => ang(a) - ang(b));
  });
  const vEdges = verts.map(() => []);
  const vNbr = verts.map(() => []);
  edges.forEach(([a, b], e) => { vEdges[a].push(e); vEdges[b].push(e); vNbr[a].push(b); vNbr[b].push(a); });
  return { tiles, verts, edges, vEdges, vNbr };
}
