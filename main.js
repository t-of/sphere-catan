import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import * as I from './illust.js';
import { buildBoard } from './board.js';
import { COST, RES, afford, bankTrade, build, discard, endTurn, legalCity, legalRoad, legalSettle, moveRobber, newGame, roll, steal, tradeRate, vp } from './game.js';

WebAppKit.init({ title: 'sphere-catan', text: 'サッカーボールの上のカタン' });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const NAME = { wood: '木', brick: 'レンガ', sheep: '羊', wheat: '麦', ore: '鉄' };
const COL = { wood: 0x2f7d32, brick: 0xb5502d, sheep: 0x9fd86b, wheat: 0xe6c84a, ore: 0x7d8794, none: 0xd8c690 };
const PCOL = [0xe53935, 0x1e88e5, 0xfb8c00];
const PNAME = ['赤', '青', '橙'];
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

// ---- three.js ----
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); // 背景は CSS の宇宙グラデーション
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
const chip = (n, mk) => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = mk ? '#3a3a4a' : '#f6efd8'; x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
  x.fillStyle = mk ? '#fff' : n === 6 || n === 8 ? '#d32f2f' : '#222'; x.font = `bold ${mk ? 24 : 34}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
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
  const mk = g.tiles[i].market; // 市場: 資源の色をうすめた灰色がかった色。生産タイルと区別する
  const col = mk ? new THREE.Color(mk === 'any' ? 0x8a8a98 : COL[mk]).lerp(new THREE.Color(0x555566), 0.6) : new THREE.Color(COL[g.tiles[i].res]);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide }));
  m.userData.tile = i; scene.add(m); tileMeshes.push(m);
  if (mk || g.tiles[i].num) { const s = chip(mk ? (mk === 'any' ? '3:1' : '2:1') : g.tiles[i].num, mk); s.position.copy(c).multiplyScalar(1.03); scene.add(s); }
});
// 盗賊: 裾の広い胴体＋頭＋とんがり帽子
const robberMesh = new THREE.Group();
{
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1c24 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.05, 0.1, 10), dark); body.position.y = 0.05;
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 1), new THREE.MeshLambertMaterial({ color: 0xe8d4b0 })); head.position.y = 0.12;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.06, 10), dark); hat.position.y = 0.17;
  robberMesh.add(body, head, hat);
}
scene.add(robberMesh);
// 建物: 開拓地 = 家（箱＋屋根）、都市 = 大きな建物（広い土台＋塔＋屋根）
function building(city, color) {
  const mat = new THREE.MeshLambertMaterial({ color }), roof = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.55) });
  const grp = new THREE.Group();
  const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.y = y; grp.add(o); return o; };
  if (!city) {
    add(new THREE.BoxGeometry(0.06, 0.04, 0.05), mat, 0.02);
    add(new THREE.ConeGeometry(0.048, 0.04, 4), roof, 0.06).rotation.y = Math.PI / 4;
  } else {
    add(new THREE.BoxGeometry(0.12, 0.05, 0.07), mat, 0.025);
    const tw = add(new THREE.BoxGeometry(0.06, 0.1, 0.06), mat, 0.075); tw.position.x = -0.025;
    add(new THREE.ConeGeometry(0.048, 0.05, 4), roof, 0.15).position.x = -0.025;
    grp.children[2].rotation.y = Math.PI / 4;
  }
  return grp;
}

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
    const m = building(o.city, PCOL[o.p]);
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
  robberMesh.visible = g.robber != null;
  if (g.robber != null) { const c = v3(B.tiles[g.robber].center, 1.0); robberMesh.position.copy(c); robberMesh.quaternion.setFromUnitVectors(up, c.clone().normalize()); }
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
  const cand = [...vMeshes.filter((m) => m.visible), ...eMeshes.filter((m) => m.visible && g.eOwn[m.userData.e] == null), ...(g.phase === 'robber' ? tileMeshes.filter((m) => m.userData.tile >= 12) : [])];
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
