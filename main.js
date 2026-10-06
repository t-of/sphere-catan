import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { buildBoard } from './board.js';
import { RES, afford, bankTrade, build, discard, endTurn, legalCity, legalRoad, legalSettle, moveRobber, newGame, roll, vp } from './game.js';

WebAppKit.init({ title: 'sphere-catan', text: 'サッカーボールの上のカタン' });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const NAME = { wood: '木', brick: 'レンガ', sheep: '羊', wheat: '麦', ore: '鉄' };
const COL = { wood: 0x2f7d32, brick: 0xb5502d, sheep: 0x9fd86b, wheat: 0xe6c84a, ore: 0x7d8794, none: 0xd8c690 };
const PCOL = [0xe53935, 0x1e88e5, 0xfb8c00];
const PNAME = ['赤', '青', '橙'];
const $ = (id) => document.getElementById(id);

const B = buildBoard();
const g = newGame(B);
let mode = null; // 本番の建設モード: 'road' | 'settle' | 'city'

// ---- three.js ----
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
camera.position.set(0, 1.2, 3.6);
const controls = new OrbitControls(camera, cv);
controls.enablePan = false; controls.minDistance = 2.2; controls.maxDistance = 6;
scene.add(new THREE.AmbientLight(0xffffff, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
camera.add(sun); sun.position.set(2, 3, 4); scene.add(camera);

const v3 = (a, k = 1) => new THREE.Vector3(a[0] * k, a[1] * k, a[2] * k);
const up = new THREE.Vector3(0, 1, 0);
const tileMeshes = [];
const chip = (n) => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#f6efd8'; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
  x.fillStyle = n === 6 || n === 8 ? '#d32f2f' : '#222'; x.font = 'bold 34px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(n, 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
  s.scale.set(0.2, 0.2, 1); return s;
};
B.tiles.forEach((t, i) => {
  const c = v3(t.center);
  const q = t.verts.map((v) => v3(B.verts[v].pos).sub(c).multiplyScalar(0.93).add(c).normalize()); // すき間を空ける
  const pos = [];
  q.forEach((p, k) => pos.push(...c.toArray(), ...p.toArray(), ...q[(k + 1) % q.length].toArray()));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COL[g.tiles[i].res || 'none'], side: THREE.DoubleSide }));
  m.userData.tile = i; scene.add(m); tileMeshes.push(m);
  if (g.tiles[i].num) { const s = chip(g.tiles[i].num); s.position.copy(c).multiplyScalar(1.03); scene.add(s); }
});
const robberMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), new THREE.MeshLambertMaterial({ color: 0x222222 }));
scene.add(robberMesh);

// 頂点の目印と辺の目印（置ける場所を光らせる。道は辺の目印をそのまま色づけ）
const vMeshes = B.verts.map((v, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffee58 }));
  m.position.copy(v3(v.pos, 1.02)); m.userData.v = i; m.visible = false; scene.add(m); return m;
});
const eMeshes = B.edges.map(([a, b], i) => {
  const A = v3(B.verts[a].pos, 1.015), C = v3(B.verts[b].pos, 1.015), len = A.distanceTo(C);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len * 0.7, 6), new THREE.MeshLambertMaterial({ color: 0xffee58 }));
  m.position.copy(A.clone().add(C).multiplyScalar(0.5));
  m.quaternion.setFromUnitVectors(up, C.clone().sub(A).normalize());
  m.userData.e = i; m.visible = false; scene.add(m); return m;
});
const bMeshes = []; // 建物
function refresh() {
  bMeshes.forEach((m) => scene.remove(m)); bMeshes.length = 0;
  g.vOwn.forEach((o, i) => {
    if (!o) return;
    const s = o.city ? 0.07 : 0.05;
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshLambertMaterial({ color: PCOL[o.p] }));
    m.position.copy(v3(B.verts[i].pos, 1.03)); m.quaternion.setFromUnitVectors(up, m.position.clone().normalize());
    scene.add(m); bMeshes.push(m);
  });
  const main = g.phase === 'main';
  const legalV = g.phase === 'setupS' || (main && mode === 'settle') ? legalSettle(g) : main && mode === 'city' ? legalCity(g) : [];
  const legalE = g.phase === 'setupR' || (main && mode === 'road') ? legalRoad(g) : [];
  vMeshes.forEach((m, i) => { m.visible = legalV.includes(i); });
  eMeshes.forEach((m, i) => {
    const o = g.eOwn[i];
    m.visible = o != null || legalE.includes(i);
    m.material.color.setHex(o != null ? PCOL[o] : 0xffee58);
    m.scale.set(o != null ? 1 : 1.6, 1, o != null ? 1 : 1.6);
  });
  robberMesh.position.copy(v3(B.tiles[g.robber].center, 1.07));
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
  const cand = [...vMeshes.filter((m) => m.visible), ...eMeshes.filter((m) => m.visible && g.eOwn[m.userData.e] == null), ...(g.phase === 'robber' ? tileMeshes : [])];
  const hit = ray.intersectObjects(cand)[0]?.object;
  if (hit) act(hit.userData);
});
function act(u) {
  if (u.tile != null) moveRobber(g, u.tile);
  else if (g.phase === 'setupS' || g.phase === 'setupR') build(g, u.v != null ? 'settle' : 'road', u.v ?? u.e);
  else if (u.e != null) { build(g, 'road', u.e); mode = null; }
  else { build(g, mode, u.v); mode = null; }
  refresh();
}

// ---- 画面 ----
const T = { setupS: '開拓地を置く', setupR: '道を置く', roll: 'サイコロを振る', main: '建設・交換・手番終了', robber: '盗賊を動かすタイルをタップ', discard: '', over: '' };
function ui() {
  const d = g.phase === 'discard' ? g.discard[0] : null;
  const hand = g.players[d ? d.p : g.cur].hand;
  $('who').textContent = g.phase === 'over' ? `${PNAME[g.cur]}の勝ち！ ${vp(g, g.cur)} 点` : `${PNAME[g.cur]}の番　` + [0, 1, 2].map((p) => `${PNAME[p]}${vp(g, p)}点`).join(' ');
  $('who').style.color = '#' + PCOL[g.cur].toString(16).padStart(6, '0');
  $('hand').replaceChildren(...RES.map((r) => {
    const b = document.createElement('button'); b.className = 'chip'; b.innerHTML = `${NAME[r]}<b>${hand[r]}</b>`;
    b.onclick = () => { if (d) { discard(g, r); refresh(); } };
    return b;
  }));
  $('msg').textContent = d ? `${PNAME[d.p]}：手札を ${d.n} 枚捨てる（資源をタップ）` : [g.dice ? `出目 ${g.dice[0] + g.dice[1]}` : '', T[g.phase], g.msg].filter(Boolean).join('　');
  const main = g.phase === 'main';
  const mk = (label, fn, ok, on) => { const b = document.createElement('button'); b.className = 'pill' + (on ? ' on' : ''); b.textContent = label; b.disabled = !ok; b.onclick = fn; return b; };
  const setMode = (m) => () => { mode = mode === m ? null : m; refresh(); };
  $('btns').replaceChildren(
    mk('サイコロ', () => { roll(g); refresh(); }, g.phase === 'roll'),
    mk('道', setMode('road'), main && afford(g, 'road'), mode === 'road'),
    mk('開拓地', setMode('settle'), main && afford(g, 'settle'), mode === 'settle'),
    mk('都市', setMode('city'), main && afford(g, 'city'), mode === 'city'),
    mk('交換', () => { $('trade').hidden = !$('trade').hidden; }, main),
    mk('終了', () => { endTurn(g); mode = null; refresh(); }, main),
    ...(g.phase === 'over' ? [mk('もう一度', () => location.reload(), true)] : []),
  );
  if (!main) $('trade').hidden = true;
}
// 交換（銀行と 4:1）
for (const id of ['give', 'get']) $(id).replaceChildren(...RES.map((r) => new Option(NAME[r], r)));
$('get').value = 'brick';
$('tbtn').onclick = () => { if (bankTrade(g, $('give').value, $('get').value)) refresh(); };

function resize() {
  const r = cv.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(cv);
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
refresh(); resize();
