import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import * as I from './illust.js';
import { buildBoard } from './board.js';
import { COST, RES, afford, bankTrade, build, discard, endTurn, legalCity, legalRoad, legalSettle, moveRobber, newGame, roll, steal, tradeRate, vp } from './game.js';

WebAppKit.init({ title: 'sphere-catan', text: 'サッカーボールの上のカタン' });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const NAME = { wood: '木', brick: 'レンガ', sheep: '羊', wheat: '麦', ore: '鉄' };
const PCOL = [0xe0553f, 0x3f7ee0, 0xf0c43c]; // catan の PLAYER_COLORS の先頭 3 色
const PNAME = ['赤', '青', '黄'];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const DIE = '⚀⚁⚂⚃⚄⚅';
const BNAME = { road: '道', settle: '開拓地', city: '都市' };
let actx = null; // 効果音（最小限。仕様 10 章の音の作り込みは次の段階）
function beep(f = 440, d = 0.08) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume();
    const o = actx.createOscillator(), a = actx.createGain();
    o.frequency.value = f; a.gain.value = 0.05; o.connect(a); a.connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
  } catch { /* 鳴らせなくても遊べる */ }
}
// 資源アイコン（catan の resIcon と同じ。40x40 の SVG）
const NS = 'http://www.w3.org/2000/svg';
function resIcon(kind) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40'); svg.setAttribute('class', 'res-icon');
  const shapes = []; I.resourceIcon(shapes, kind);
  shapes.forEach((s) => {
    const n = document.createElementNS(NS, 'path');
    n.setAttribute('d', s.d); n.setAttribute('fill', s.f);
    n.setAttribute('style', `opacity:${s.o};stroke:${s.sk};stroke-width:${s.sw}px;stroke-linejoin:round;stroke-linecap:round`);
    svg.appendChild(n);
  });
  return svg;
}
const $ = (id) => document.getElementById(id);

const B = buildBoard();
const g = newGame(B);
let mode = null; // 本番の建設モード: 'road' | 'settle' | 'city'

// ---- three.js（盤の見た目は 2D 版 catan に合わせる: 資源色のタイル・イラスト・数字チップ・港・駒の形と色）----
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); // 色をそのまま出すため、トーンマッピングはしない
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
camera.position.set(0, 1.2, 3.6);
const controls = new OrbitControls(camera, cv);
controls.enablePan = false; controls.minDistance = 2.2; controls.maxDistance = 6;
{ // 球の外の背景（海のグラデーション）
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2d6ca0'); gr.addColorStop(1, '#bfe3f2'); x.fillStyle = gr; x.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 2.2)); // 駒の陰影だけに使う（タイルと数字は照明を受けない）
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
camera.add(sun); sun.position.set(-2, 3, 4); scene.add(camera);

const v3 = (a, k = 1) => new THREE.Vector3(a[0] * k, a[1] * k, a[2] * k);
const up = new THREE.Vector3(0, 1, 0), zAxis = new THREE.Vector3(0, 0, 1);
const tileMeshes = [];
const K = 0.0055; // catan の座標（六角形の外接円 66）を球に縮める倍率
const ACCENT = 0xe6b85c; // catan の --accent
const basic = (color, extra) => new THREE.MeshBasicMaterial({ color, ...extra });
const lambert = (color) => new THREE.MeshLambertMaterial({ color });
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.02, depthWrite: false }); // タップ判定用（ほぼ透明）
// 向きをそろえる: 局所の y を球の外向き法線 n に、spin は法線まわりの回転
const stand = (o, p, spin = 0) => {
  o.position.copy(p); o.quaternion.setFromUnitVectors(up, p.clone().normalize());
  o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(up, spin)); return o;
};
// 面の向き: t = 北（画面の上）、r = 右、n = 外向き法線。外から見て絵が鏡像にならない
function frame(n) {
  const t = up.clone().sub(n.clone().multiplyScalar(up.dot(n)));
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
  t.normalize(); return { t, r: new THREE.Vector3().crossVectors(t, n) };
}
const toTex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

// 海（タイルのすき間に見える）
scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.965, 48, 32), basic(0x1d4a5c)));

// ---- タイルのテクスチャ（catan の illust.js の図形を canvas に描く。資源ごとに 1 枚、256px）----
const RES_COLOR = { wood: '#3f8a4a', brick: '#c0643a', sheep: '#8cc063', wheat: '#e0b440', ore: '#8a92a3' };
const RES_LABEL = { wood: '木', brick: '土', sheep: '羊', wheat: '麦', ore: '鉄' };
const TERRAIN = { wood: 'forest', brick: 'hills', sheep: 'pasture', wheat: 'field', ore: 'mountains', none: 'desert' };
const GRAD = { // illust.js の defsMarkup と同じ色
  forest: ['#56a35f', '#2a6837'], pasture: ['#c2e58a', '#7fb454'], field: ['#f6d872', '#d3a43a'], hill: ['#e4935f', '#ae5631'],
  mountain: ['#bcc2ce', '#767e90'], desert: ['#f4e6bb', '#d5bc80'], water: ['#2a8aa0', '#114f62'],
};
const FONT = '"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
function drawShapes(x, shapes) { // illust.js の {d, f, o, sk, sw} を描く
  shapes.forEach((s) => {
    const p = new Path2D(s.d); x.globalAlpha = s.o;
    if (s.f !== 'none') { x.fillStyle = s.f; x.fill(p); }
    if (s.sk !== 'none') { x.strokeStyle = s.sk; x.lineWidth = s.sw; x.lineJoin = x.lineCap = 'round'; x.stroke(p); }
  });
  x.globalAlpha = 1;
}
const TEX = 256, TSC = TEX / (66 * 2 * 1.05); // 絵の座標 R=66 が球面の外接円に当たる
const tileTex = {};
function tileTexture(res, mk) {
  const key = mk ? 'mk' + mk : res;
  if (tileTex[key]) return tileTex[key];
  const c = document.createElement('canvas'); c.width = c.height = TEX;
  const x = c.getContext('2d'); x.translate(TEX / 2, TEX / 2); x.scale(TSC, TSC);
  const [g0, g1] = GRAD[mk ? 'water' : I.TERRAIN_STYLE[TERRAIN[res]].grad];
  const gr = x.createLinearGradient(-66, -57, 66, 57); gr.addColorStop(0, g0); gr.addColorStop(1, g1);
  x.fillStyle = gr; x.fillRect(-TEX, -TEX, TEX * 2, TEX * 2);
  const S = [];
  if (!mk) I.terrainDecor(S, TERRAIN[res], 0, 0);
  else { // 市場（catan の港の札）: 海に 3:1 または 2:1 と資源の名前の札
    const isAny = mk === 'any', bg = isAny ? '#b9a980' : RES_COLOR[mk];
    I.add(S, 'M-36,-6 q18,-10 36,0 t34,0', 'none', 0.3, '#bfe6ee', 2);
    I.add(S, 'M-30,26 q15,-9 30,0 t28,0', 'none', 0.22, '#bfe6ee', 2);
    I.add(S, I.ell(0, 3, 30, 30), '#000', 0.25);
    I.add(S, I.ell(0, 0, 30, 30), '#f6eedb', 1, bg, 5);
  }
  drawShapes(x, S);
  if (mk) {
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#2a211b'; x.font = `700 22px ${FONT}`;
    x.fillText(mk === 'any' ? '3:1' : '2:1', 0, mk === 'any' ? 0 : -8);
    if (mk !== 'any') { x.fillStyle = RES_COLOR[mk]; x.font = `700 17px ${FONT}`; x.fillText(RES_LABEL[mk], 0, 12); }
  }
  return (tileTex[key] = toTex(c));
}
const tileMat = {};
const matFor = (res, mk) => { const k = mk ? 'mk' + mk : res; return tileMat[k] || (tileMat[k] = basic(0xffffff, { map: tileTexture(res, mk), side: THREE.DoubleSide })); };
const rimMat = {};
const rimFor = (color) => rimMat[color] || (rimMat[color] = basic(color, { side: THREE.DoubleSide }));

// 数字チップ（catan と同じ。影・クリーム色・6 と 8 の赤・確率の点）。数字ごとに 1 枚
const chipTex = {};
function chipTexture(n) {
  if (chipTex[n]) return chipTex[n];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), s = 128 / 40; x.scale(s, s); x.translate(20, 20);
  const hot = n === 6 || n === 8, ink = hot ? '#b8321f' : '#2a211b';
  x.fillStyle = 'rgba(0,0,0,0.28)'; x.beginPath(); x.arc(1, 3, 19, 0, 7); x.fill();
  const gr = x.createRadialGradient(-2, -3, 0, -2, -3, 13.5); gr.addColorStop(0, '#fffcf4'); gr.addColorStop(1, '#e6d8b8');
  x.fillStyle = gr; x.beginPath(); x.arc(0, 0, 18, 0, 7); x.fill();
  x.strokeStyle = '#c7b58b'; x.lineWidth = 1.2; x.stroke();
  x.fillStyle = ink; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = `700 ${hot ? 21 : 19}px Georgia, serif`;
  x.fillText(String(n), 0, -3);
  const dots = 6 - Math.abs(7 - n);
  for (let d = 0; d < dots; d++) { x.beginPath(); x.arc(-(dots - 1) * 2.4 + d * 4.8, 10, 1.3, 0, 7); x.fill(); }
  return (chipTex[n] = toTex(c));
}
const chipGeo = new THREE.CircleGeometry(19 * K, 28);
function chip(n, c) {
  const m = new THREE.Mesh(chipGeo, basic(0xffffff, { map: chipTexture(n), transparent: true, depthWrite: false }));
  const { t, r } = frame(c);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, t, c));
  m.position.copy(c).multiplyScalar(1.003); return m;
}

// タイル: 中心から放射状に UV を張る。縁取り（catan のタイルの縁の色）は 1 まわり大きい板で出す
function fanGeo(c, q, uv) {
  const pos = [], tc = [];
  const push = (p) => { pos.push(p.x, p.y, p.z); if (uv) tc.push(...uv(p)); };
  q.forEach((p, k) => { push(c); push(p); push(q[(k + 1) % q.length]); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(tc, 2));
  return geo;
}
B.tiles.forEach((t, i) => {
  const c = v3(t.center), pv = t.verts.map((v) => v3(B.verts[v].pos));
  const ring = (k, rad) => pv.map((p) => p.clone().sub(c).multiplyScalar(k).add(c).normalize().multiplyScalar(rad));
  const { t: nt, r: nr } = frame(c), rho = pv[0].distanceTo(c), kk = 1 / (rho * 2 * 1.05);
  const uv = (p) => { const d = p.clone().sub(c); return [d.dot(nr) * kk + 0.5, d.dot(nt) * kk + 0.5]; };
  const mk = g.tiles[i].market, res = g.tiles[i].res;
  scene.add(new THREE.Mesh(fanGeo(c.clone().multiplyScalar(0.9975), ring(0.975, 0.9975)), rimFor(mk ? 0x0e5265 : parseInt(I.TERRAIN_STYLE[TERRAIN[res]].edge.slice(1), 16))));
  const m = new THREE.Mesh(fanGeo(c, ring(0.93, 1), uv), matFor(res, mk));
  m.userData.tile = i; scene.add(m); tileMeshes.push(m);
  if (!mk && g.tiles[i].num) scene.add(chip(g.tiles[i].num, c));
});

// ---- 駒（catan の形を押し出したもの。色は catan のプレイヤー色）----
const ink = basic(0x1b1612);
const solid = new Map(); // 色ごとの材質
const solidOf = (c) => solid.get(c) || (solid.set(c, lambert(c)), solid.get(c));
const lineMat = new THREE.LineBasicMaterial({ color: 0x1b1612 });
function prism(pts, depth, mat) { // 輪郭（x 右, y 上の絵の座標）を奥行き方向に押し出し、黒い縁を付ける
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false }).translate(0, 0, -depth / 2);
  const o = new THREE.Mesh(geo, mat); o.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat)); return o;
}
// catan の illust.js の house・city と同じ輪郭（y は上向きに直し、底を 0 にした）
const HOUSE = [[-11, 0], [-11, 10], [0, 20], [11, 10], [11, 0]];
const CITY = [[-16, 0], [-16, 19], [-8, 27], [0, 19], [0, 12], [8, 19], [16, 12], [16, 0]];
function building(city, color) {
  const o = prism(city ? CITY : HOUSE, city ? 16 : 14, solidOf(color)); o.scale.setScalar(K);
  const out = new THREE.Group(); out.add(o); return out;
}

// 盗賊（catan の robber と同じ: 黒い外套の本体・丸い頭・足もとの台）
const robberMesh = new THREE.Group();
{
  const cloak = lambert(0x2d2c36), foot = lambert(0x1c1b22), s = 1.15 * K;
  const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y * s; robberMesh.add(o); };
  add(new THREE.CylinderGeometry(10 * s, 10 * s, 3 * s, 16), foot, 0);
  add(new THREE.LatheGeometry([[0, 0], [8, 0], [8, 4], [7, 10], [5.5, 15], [4, 18], [0, 18]].map(([r, y]) => new THREE.Vector2(r * s, y * s)), 12), cloak, 1);
  add(new THREE.SphereGeometry(6 * s, 12, 8), cloak, 23);
}
scene.add(robberMesh);

// ---- 置ける場所（catan と同じ: 頂点は金色の丸、辺は黒縁の金の線、盗賊の行き先はタイルの輪）。当たり判定はほぼ透明の塊 ----
const halo = (r, op, rin) => new THREE.Mesh(rin ? new THREE.RingGeometry(rin, r, 28) : new THREE.CircleGeometry(r, 28), basic(0xf0cf85, { transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide }));
const vMeshes = B.verts.map((v, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), hitMat);
  m.position.copy(v3(v.pos, 1.004)); m.userData.v = i; m.visible = false;
  const g2 = new THREE.Group(); g2.quaternion.setFromUnitVectors(zAxis, m.position.clone().normalize());
  const rim = halo(10.25 * K, 1, 7.75 * K); rim.material.color.set(0xfff3cf);
  g2.add(halo(15 * K, 0.3), halo(9 * K, 0.6), rim); m.add(g2);
  scene.add(m); return m;
});
// 辺の向き: y = 辺の方向、z = 外向き法線
const edgeBasis = (A, C) => {
  const mid = A.clone().add(C).multiplyScalar(0.5), n = mid.clone().normalize(), y = C.clone().sub(A).normalize();
  const x = new THREE.Vector3().crossVectors(y, n).normalize(), z = new THREE.Vector3().crossVectors(x, y);
  return { mid, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)), len: A.distanceTo(C) };
};
const unitBox = (w, h) => new THREE.BoxGeometry(w, 1, h);
const roadDark = unitBox(10 * K, 3 * K), roadCol = unitBox(6 * K, 4 * K), roadHi = unitBox(9 * K, 3 * K);
const goldLine = basic(ACCENT, { transparent: true, opacity: 0.85 });
const eMeshes = B.edges.map(([a, b], i) => {
  const { mid, q, len } = edgeBasis(v3(B.verts[a].pos), v3(B.verts[b].pos));
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, len * 0.8, 0.04), hitMat);
  m.position.copy(mid.normalize().multiplyScalar(1.0)); m.quaternion.copy(q); m.userData.e = i; m.visible = false;
  const dk = new THREE.Mesh(roadHi, ink), gd = new THREE.Mesh(unitBox(5 * K, 3.4 * K), goldLine);
  dk.scale.y = gd.scale.y = len * 0.8; dk.position.z = 0.002; gd.position.z = 0.004; m.add(dk, gd);
  scene.add(m); return m;
});
const tileRings = B.tiles.map((t, i) => {
  if (!g.tiles[i].res) return null;
  const rho = v3(B.verts[t.verts[0]].pos).distanceTo(v3(t.center));
  const r = new THREE.Mesh(new THREE.TorusGeometry(rho * 0.93, 0.008, 6, 36).rotateX(Math.PI / 2), basic(ACCENT));
  stand(r, v3(t.center, 1.006)); r.visible = false; scene.add(r); return r;
});
function road(a, b, color) { // 黒縁の道（catan と同じ。縁の太さ 10・色の太さ 6）
  const A = v3(B.verts[a].pos), C = v3(B.verts[b].pos), { mid, q, len } = edgeBasis(A, C);
  const grp = new THREE.Group(), dk = new THREE.Mesh(roadDark, ink), body = new THREE.Mesh(roadCol, solidOf(color));
  dk.scale.y = body.scale.y = len * 0.8; dk.position.z = 1.5 * K; body.position.z = 2 * K; grp.add(dk, body);
  grp.position.copy(mid.normalize().multiplyScalar(1.0)); grp.quaternion.copy(q); return grp;
}
const bMeshes = []; // 建物と道
function refresh() {
  bMeshes.forEach((m) => scene.remove(m)); bMeshes.length = 0;
  g.vOwn.forEach((o, i) => {
    if (!o) return;
    const m = stand(building(o.city, PCOL[o.p]), v3(B.verts[i].pos, 1.001), i);
    scene.add(m); bMeshes.push(m);
  });
  g.eOwn.forEach((o, i) => { if (o != null) { const m = road(B.edges[i][0], B.edges[i][1], PCOL[o]); scene.add(m); bMeshes.push(m); } });
  const main = g.phase === 'main';
  const legalV = g.phase === 'setupS' || (main && mode === 'settle') ? legalSettle(g) : main && mode === 'city' ? legalCity(g) : [];
  const legalE = g.phase === 'setupR' || (main && mode === 'road') ? legalRoad(g) : [];
  vMeshes.forEach((m, i) => { m.visible = legalV.includes(i); });
  eMeshes.forEach((m, i) => { m.visible = g.eOwn[i] == null && legalE.includes(i); });
  tileRings.forEach((r) => { if (r) r.visible = g.phase === 'robber'; });
  robberMesh.visible = g.robber != null;
  if (g.robber != null) { // 数字チップの下（南）に置く
    const c = v3(B.tiles[g.robber].center), { t, r } = frame(c);
    stand(robberMesh, c.clone().addScaledVector(t, -14 * K).addScaledVector(r, 2 * K).normalize().multiplyScalar(1.002));
  }
  ui();
}

// ---- 操作（ドラッグは回転、ほぼ動かさずに離したらタップ）----
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let down = null;
cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
cv.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  const r = cv.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const cand = [...vMeshes.filter((m) => m.visible), ...eMeshes.filter((m) => m.visible && g.eOwn[m.userData.e] == null), ...(g.phase === 'robber' ? tileMeshes.filter((m) => g.tiles[m.userData.tile].res) : [])];
  const hit = ray.intersectObjects(cand)[0]?.object;
  if (hit) act(hit.userData);
});
function act(u) {
  beep(u.tile != null ? 200 : 520);
  if (u.tile != null) moveRobber(g, u.tile);
  else if (g.phase === 'setupS' || g.phase === 'setupR') build(g, u.v != null ? 'settle' : 'road', u.v ?? u.e);
  else if (u.e != null) { build(g, 'road', u.e); mode = null; }
  else { build(g, mode, u.v); mode = null; }
  refresh();
}

// ---- 画面 ----
const T = { setupS: '開拓地を置く', setupR: '道を置く', roll: 'サイコロを振る', main: '建設・交換・手番終了', robber: '盗賊を動かす六角形をタップ', steal: '奪う相手を選ぶ', discard: '', over: '' };
function ui() {
  const d = g.phase === 'discard' ? g.discard[0] : null;
  const hand = g.players[d ? d.p : g.cur].hand;
  const over = g.phase === 'over';
  $('who').replaceChildren(...[0, 1, 2].map((p) => {
    const el = document.createElement('div');
    el.className = 'player-card' + (p === g.cur ? ' is-turn' : '');
    el.style.setProperty('--pc', hex(PCOL[p]));
    const n = RES.reduce((t, r) => t + g.players[p].hand[r], 0);
    el.innerHTML = `<span class="player-card__dot" style="background:${hex(PCOL[p])}">${PNAME[p]}</span><div class="player-card__body"><span class="player-card__name"><span class="player-card__nametext">${PNAME[p]}</span>${p === g.cur ? '<span class="player-card__cur">手番</span>' : ''}</span><span class="player-card__sub">手札 ${n} 枚</span></div><div class="player-card__vp"><b>${vp(g, p)}</b><span>点</span></div>`;
    return el;
  }));
  if (over) { const w = document.createElement('div'); w.className = 'win-banner'; w.style.setProperty('--pc', hex(PCOL[g.cur])); w.textContent = `${PNAME[g.cur]}の勝ち！ ${vp(g, g.cur)} 点`; $('who').append(w); }
  $('hand').classList.toggle('discarding', !!d);
  $('hand').replaceChildren(...RES.map((r) => {
    const b = document.createElement('button'); b.className = 'hand__res' + (hand[r] ? '' : ' zero'); b.title = NAME[r];
    b.append(resIcon(r)); b.insertAdjacentHTML('beforeend', `<b>${hand[r]}</b>`);
    b.onclick = () => { if (d) { discard(g, r); refresh(); } };
    return b;
  }));
  const dice = g.dice ? `<span class="dice">${DIE[g.dice[0] - 1]} ${DIE[g.dice[1] - 1]}</span><b>${g.dice[0] + g.dice[1]}</b>` : '';
  const txt = g.phase === 'steal' ? '奪う相手を選ぶ' : d ? `${PNAME[d.p]}：手札を ${d.n} 枚捨てる（資源をタップ）` : [T[g.phase], g.msg].filter(Boolean).join('　');
  const m = $('msg'); m.innerHTML = dice; m.append(document.createTextNode(txt)); m.hidden = !dice && !txt;
  const main = g.phase === 'main';
  const mk = (label, fn, ok, on) => { const b = document.createElement('button'); b.className = 'btn' + (on ? ' is-selected' : ''); b.textContent = label; b.disabled = !ok; b.onclick = fn; return b; };
  const build_ = (kind) => {
    const b = mk('', () => { mode = mode === kind ? null : kind; refresh(); }, main && afford(g, kind), mode === kind);
    b.classList.add('build-btn');
    const need = RES.filter((r) => COST[kind][r]);
    const miss = need.filter((r) => g.players[g.cur].hand[r] < COST[kind][r]);
    b.innerHTML = `<span class="build-btn__label">${BNAME[kind]}</span><span class="build-btn__cost"></span>`;
    need.forEach((r) => { const c = document.createElement('span'); c.className = 'cost-pair' + (main && miss.includes(r) ? ' lack' : ''); c.append(resIcon(r)); c.insertAdjacentHTML('beforeend', `<span>${COST[kind][r]}</span>`); b.lastChild.append(c); });
    b.title = main && miss.length ? `不足: ${miss.map((r) => NAME[r]).join('・')}` : '';
    return b;
  };
  $('btns').replaceChildren(
    mk('サイコロ', () => { beep(330); roll(g); refresh(); }, g.phase === 'roll'),
    build_('road'), build_('settle'), build_('city'),
    mk('交換', () => { $('trade').hidden = !$('trade').hidden; }, main),
    mk('手番終了', () => { endTurn(g); mode = null; refresh(); }, main),
    ...(over ? [mk('もう一度', () => location.reload(), true)] : []),
  );
  if (g.phase === 'steal') $('btns').replaceChildren(...g.victims.map((p) => mk(`${PNAME[p]}から奪う`, () => { steal(g, p); refresh(); }, true)));
  if (!main) $('trade').hidden = true;
  rateText();
}
function rateText() { // 交換の率（市場に接していれば 2:1 / 3:1、なければ 4:1）
  const r = tradeRate(g, g.cur, $('give').value);
  $('tbtn').textContent = `${r}:1 で交換`;
}
// 交換（銀行。率は市場しだい）
for (const id of ['give', 'get']) $(id).replaceChildren(...RES.map((r) => new Option(NAME[r], r)));
$('get').value = 'brick';
$('give').onchange = rateText;
$('tbtn').onclick = () => { if (bankTrade(g, $('give').value, $('get').value)) refresh(); };

function resize() {
  const r = cv.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(cv);
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
refresh(); resize();
