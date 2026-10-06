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

// ---- three.js（見た目は catan-3d に合わせる: 地形テクスチャ・石の数字チップ・石灰の家と瓦屋根・持ち主色の旗）----
const cv = $('cv');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.7;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
camera.position.set(0, 1.2, 3.6);
const controls = new OrbitControls(camera, cv);
controls.enablePan = false; controls.minDistance = 2.2; controls.maxDistance = 6;
{ // 空: catan-3d の skyTexture と同じ青のグラデーション
  const c = document.createElement('canvas'); c.width = 2; c.height = 256;
  const x = c.getContext('2d'), gr = x.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#2d6ca0'); gr.addColorStop(1, '#bfe3f2'); x.fillStyle = gr; x.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.add(new THREE.HemisphereLight(0xbfe3f2, 0x7a6a58, 2.2));
const sun = new THREE.DirectionalLight(0xfff1d6, 3); // 影は使わない（スマホで重いので、球面は法線の陰影だけ）
camera.add(sun); sun.position.set(-2, 3, 4); scene.add(camera);

const v3 = (a, k = 1) => new THREE.Vector3(a[0] * k, a[1] * k, a[2] * k);
const up = new THREE.Vector3(0, 1, 0);
const tileMeshes = [];
const K = 0.0055; // catan-3d の座標（六角形の外接円 66）を球に縮める倍率
const stdMat = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
const stone = stdMat(0x9a968c), plinth = stdMat(0xb7b0a0), wall = stdMat(0xcdc3ad), roofTile = stdMat(0x8a4a36), thatch = stdMat(0xc8a862);
const cloth = {}; const clothOf = (c) => cloth[c] || (cloth[c] = stdMat(c, { roughness: 0.82, side: THREE.DoubleSide }));
const glow = new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffd84a, emissiveIntensity: 0.9, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.02, depthWrite: false }); // タップ判定用（ほぼ透明）
// 向きをそろえる: 局所の y を球の外向き法線 n に、spin は法線まわりの回転
const stand = (o, p, spin = 0) => {
  o.position.copy(p); o.quaternion.setFromUnitVectors(up, p.clone().normalize());
  o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(up, spin)); return o;
};

// 海（タイルのすき間に見える）
scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.975, 48, 32), stdMat(0x1d4a5c, { roughness: 0.5 })));

// 地形テクスチャ（catan-3d の diff を 512px にしたもの）。資源 → 地形
const TERRAIN = { wood: 'forest', brick: 'hills', sheep: 'pasture', wheat: 'field', ore: 'mountains', none: 'desert' };
const loader = new THREE.TextureLoader();
const tileMat = {};
function matFor(res, mk) {
  const key = mk ? 'mk' + mk : res;
  if (tileMat[key]) return tileMat[key];
  const tex = loader.load(`./textures/${TERRAIN[mk && mk !== 'any' ? mk : res]}_diff.jpg`);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // 市場: 資源の地面を灰色がかった色に沈め、生産タイルと区別する
  return (tileMat[key] = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide, color: mk ? 0xb4b4c0 : 0xffffff }));
}

// 数字チップ: 風化した石の円盤に数字を彫る（catan-3d の numberTexture と同じ絵）。市場は「3:1」「2:1」
function chipTexture(label, hot) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#a89d8a'; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill();
  x.strokeStyle = 'rgba(70,62,48,0.55)'; x.lineWidth = 3; x.beginPath(); x.arc(64, 64, 57, 0, 7); x.stroke();
  x.strokeStyle = 'rgba(235,225,200,0.4)'; x.lineWidth = 2; x.beginPath(); x.arc(64, 64, 54, 0, 7); x.stroke();
  const engrave = (draw) => {
    x.save(); x.translate(1.6, 2.6); x.fillStyle = 'rgba(30,24,16,0.65)'; draw(); x.restore();
    x.save(); x.translate(-1.1, -1.1); x.fillStyle = 'rgba(240,230,205,0.35)'; draw(); x.restore();
    x.fillStyle = hot ? '#7a2015' : '#2b2318'; draw();
  };
  const mk = typeof label === 'string';
  x.font = `bold ${mk ? 46 : 66}px Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  engrave(() => x.fillText(String(label), 64, mk ? 64 : 66));
  if (!mk) { const dots = 6 - Math.abs(7 - label); engrave(() => { for (let d = 0; d < dots; d++) { x.beginPath(); x.arc(64 - (dots - 1) * 7 + d * 14, 101, 3.4, 0, 7); x.fill(); } }); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const chipGeo = new THREE.CylinderGeometry(0.065, 0.068, 0.012, 24), chipFace = new THREE.CircleGeometry(0.065, 24).rotateX(-Math.PI / 2);
function chip(label, hot, c) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(chipGeo, stdMat(0x8d8574, { roughness: 0.96 })));
  const top = new THREE.Mesh(chipFace, new THREE.MeshStandardMaterial({ map: chipTexture(label, hot), roughness: 0.75 })); top.position.y = 0.0062; g.add(top);
  // 文字の上を北に向ける（円盤の上面は +x が右、-z が上）
  const n = c.clone(), t = up.clone().sub(n.clone().multiplyScalar(up.dot(n)));
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
  t.normalize(); const r = new THREE.Vector3().crossVectors(t, n);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, n, t.clone().negate()));
  g.position.copy(c).multiplyScalar(0.996 + 0.006); return g;
}

// タイルの飾り（資源ごと）。球面の法線方向に立てる。長さは scene 単位
const S = 0.0095;
function lumpy(geo, amp, seed) { // catan-3d の lumpy と同じ
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 1 + amp * (Math.sin(x * 3.1 + y * 1.7 + seed) * Math.cos(z * 2.3 - y * 1.1 + seed * 0.7) + Math.sin(x * 5.3 - z * 4.1) * 0.4);
    p.setXYZ(i, x * f, y * f, z * f);
  }
  geo.computeVertexNormals(); return geo;
}
function conifer() { // 針葉樹: 2 段の円錐（catan-3d の conifer と同じ）
  const a = new THREE.ConeGeometry(1.5, 3.6, 8, 1, true).translate(0, -0.7, 0), b = new THREE.ConeGeometry(1.05, 3.0, 8, 1, true).translate(0, 1.2, 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));
  geo.setIndex([...a.index.array, ...b.index.array.map((v) => v + a.attributes.position.count)]);
  return lumpy(geo, 0.06, 2).translate(0, 2.5, 0).scale(S, S, S);
}
const lump = (r, sy, seed) => lumpy(new THREE.IcosahedronGeometry(r, 1), 0.18, seed).scale(S, S * sy, S);
const DECOR = { // 資源 → [ジオメトリ, 材質, 個数, 浮かす高さ]
  wood: [conifer(), stdMat(0x2c5a36, { roughness: 0.92 }), 7, 0],
  sheep: [new THREE.SphereGeometry(1, 8, 6).scale(S * 0.9, S * 0.6, S * 0.6), stdMat(0xf2eee2), 5, S * 0.6],
  wheat: [new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10).rotateZ(Math.PI / 2).scale(S, S, S), stdMat(0xd9b84a, { roughness: 0.95 }), 5, S * 0.9],
  brick: [new THREE.BoxGeometry(3, 1.4, 1.6).scale(S, S, S), stdMat(0x9c4a2c, { roughness: 0.92 }), 6, S * 0.7],
  ore: [lump(2.2, 0.9, 3), stdMat(0x6b675f, { roughness: 0.95 }), 5, S * 1.2],
  none: [lump(1.5, 0.7, 5), stdMat(0x6f5f4c, { roughness: 0.95 }), 3, S * 0.6],
};
function decorate(t, i, res) {
  const [geo, mat, n, lift] = DECOR[res];
  const c = v3(t.center), ref = Math.abs(c.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(c, ref).normalize(), w = new THREE.Vector3().crossVectors(c, u);
  const rho = v3(B.verts[t.verts[0]].pos).distanceTo(c);
  const im = new THREE.InstancedMesh(geo, mat, n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion();
  let seed = i * 7919 + 13; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rnd() * 0.6, d = rho * (0.42 + rnd() * 0.22);
    const p = c.clone().addScaledVector(u, Math.cos(a) * d).addScaledVector(w, Math.sin(a) * d).normalize();
    p.multiplyScalar(0.994 + lift);
    q.setFromUnitVectors(up, p.clone().normalize()); qy.setFromAxisAngle(up, rnd() * 6.28); q.multiply(qy);
    const s = 0.8 + rnd() * 0.5;
    im.setMatrixAt(k, m.compose(p, q, new THREE.Vector3(s, s, s)));
  }
  scene.add(im);
}

B.tiles.forEach((t, i) => {
  const c = v3(t.center);
  const q = t.verts.map((v) => v3(B.verts[v].pos).sub(c).multiplyScalar(0.93).add(c).normalize()); // すき間を空ける
  const ref = Math.abs(c.y) < 0.9 ? up : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(c, ref).normalize(), w = new THREE.Vector3().crossVectors(c, u);
  const pos = [], uv = [], nor = [];
  const push = (p) => { // UV は中心から放射状（接平面に投影して貼る。何度か繰り返す）
    pos.push(p.x, p.y, p.z); nor.push(p.x, p.y, p.z);
    const d = p.clone().sub(c); uv.push(d.dot(u) * 2.2 + 0.5, d.dot(w) * 2.2 + 0.5);
  };
  q.forEach((p, k) => { push(c); push(p); push(q[(k + 1) % q.length]); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); // 球の法線（なめらかに見せる）
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mk = g.tiles[i].market, res = g.tiles[i].res;
  const m = new THREE.Mesh(geo, matFor(res, mk));
  m.userData.tile = i; scene.add(m); tileMeshes.push(m);
  if (mk || g.tiles[i].num) scene.add(chip(mk ? (mk === 'any' ? '3:1' : '2:1') : g.tiles[i].num, !mk && (g.tiles[i].num === 6 || g.tiles[i].num === 8), c));
  if (!mk) decorate(t, i, res);
});
// 盗賊: 黒い外套の一団（catan-3d と同じ。3 人の三角の隊形）＋足もとの暗い影
const robberMesh = new THREE.Group();
{
  const cloak = stdMat(0x1c1b22), headM = stdMat(0x2d2c36, { roughness: 0.85 });
  const shade = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0b10, transparent: true, opacity: 0.34, depthWrite: false }));
  shade.position.y = 0.002; robberMesh.add(shade);
  [[0, 0, 1], [-8, 5, 0.68], [8, -4, 0.68]].forEach(([dx, dz, s]) => {
    const add = (geo, m, y) => { const o = new THREE.Mesh(geo, m); o.position.set(dx * K, y * s * K, dz * K); robberMesh.add(o); };
    add(new THREE.ConeGeometry(9 * s * K, 22 * s * K, 8), cloak, 11);
    add(new THREE.TorusGeometry(5 * s * K, 1.6 * s * K, 6, 10).rotateX(Math.PI / 2), cloak, 20);
    add(new THREE.SphereGeometry(6 * s * K, 8, 6), headM, 25);
    add(new THREE.ConeGeometry(7 * s * K, 3 * s * K, 8), cloak, 29);
  });
}
scene.add(robberMesh);
// 建物（catan-3d: 壁は石灰、屋根は瓦か茅、持ち主の色は旗）。開拓地 = 家 2 軒、都市 = 教会・塔・城壁
const flag = (grp, x, y, z, s, color) => {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 10 * s, 5), stdMat(0x6e5436)); pole.position.set(x, y + 5 * s, z);
  const cl = new THREE.Mesh(new THREE.PlaneGeometry(5 * s, 3 * s), clothOf(color)); cl.position.set(x + 2.5 * s, y + 8.5 * s, z);
  grp.add(pole, cl);
};
function building(city, color) {
  const grp = new THREE.Group(), add = (geo, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; grp.add(o); return o; };
  const house = (x, z, s, roof) => { add(new THREE.BoxGeometry(8 * s, 5 * s, 6 * s), wall, x, 2.5 * s, z); add(new THREE.ConeGeometry(6 * s, 3.6 * s, 4), roof, x, 6.8 * s, z, Math.PI / 4); };
  if (!city) { house(-4, 2, 1.1, roofTile); house(4.5, -2, 0.9, thatch); flag(grp, 0, 0, 3, 1.3, color); }
  else {
    add(new THREE.CylinderGeometry(16, 16, 9, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95, side: THREE.DoubleSide }), 0, 4.5, 0);
    add(new THREE.BoxGeometry(9, 10, 14), plinth, 0, 5, 0); add(new THREE.ConeGeometry(8, 6, 4), roofTile, 0, 13, 0, Math.PI / 4).scale.z = 1.5;
    add(new THREE.CylinderGeometry(2.4, 2.8, 24, 8), stone, 7, 12, 0); add(new THREE.ConeGeometry(3.6, 7, 8), roofTile, 7, 27.5, 0);
    flag(grp, 7, 31, 0, 0.9, color);
    [-0.55, 0.55].forEach((a) => {
      const x = Math.cos(a + 2.2) * 16, z = Math.sin(a + 2.2) * 16;
      add(new THREE.CylinderGeometry(4, 4, 16, 10), stone, x, 8, z); add(new THREE.ConeGeometry(5, 6.4, 10), roofTile, x, 19.2, z);
      flag(grp, x, 22, z, 0.7, color);
    });
    for (let i = 0; i < 4; i++) { const a = 0.4 + i * 1.2; house(Math.cos(a) * 10, Math.sin(a) * 10, 0.6, i % 2 ? thatch : roofTile); }
  }
  grp.scale.setScalar(K); const out = new THREE.Group(); out.add(grp); return out;
}

// 置ける場所は catan-3d と同じく光る線で示す（頂点 = 光の輪、辺 = 光る帯、盗賊の行き先 = 六角の輪）。当たり判定はほぼ透明の塊
const ringGeo = new THREE.RingGeometry(0.034, 0.05, 28).rotateX(-Math.PI / 2);
const vMeshes = B.verts.map((v, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), hitMat);
  m.position.copy(v3(v.pos, 1.004)); m.userData.v = i; m.visible = false;
  const r = new THREE.Mesh(ringGeo, glow); r.quaternion.setFromUnitVectors(up, m.position.clone().normalize()); m.add(r);
  scene.add(m); return m;
});
// 辺の向き: y = 辺の方向、z = 外向き法線
const edgeBasis = (A, C) => {
  const mid = A.clone().add(C).multiplyScalar(0.5), n = mid.clone().normalize(), y = C.clone().sub(A).normalize();
  const x = new THREE.Vector3().crossVectors(y, n).normalize(), z = new THREE.Vector3().crossVectors(x, y);
  return { mid, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)), len: A.distanceTo(C) };
};
const eMeshes = B.edges.map(([a, b], i) => {
  const { mid, q, len } = edgeBasis(v3(B.verts[a].pos), v3(B.verts[b].pos));
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, len * 0.8, 0.04), hitMat);
  m.position.copy(mid.normalize().multiplyScalar(1.0)); m.quaternion.copy(q); m.userData.e = i; m.visible = false;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.035, len * 0.7, 0.006), glow); band.position.z = 0.012; m.add(band);
  scene.add(m); return m;
});
const tileRings = B.tiles.map((t, i) => {
  if (i < 12) return null;
  const rho = v3(B.verts[t.verts[0]].pos).distanceTo(v3(t.center));
  const r = new THREE.Mesh(new THREE.TorusGeometry(rho * 0.78, 0.007, 6, 36).rotateX(Math.PI / 2), glow);
  stand(r, v3(t.center, 1.006)); r.visible = false; scene.add(r); return r;
});
const roadGeo = new THREE.BoxGeometry(0.036, 1, 0.014), postGeo = new THREE.CylinderGeometry(0.0014, 0.0016, 0.05, 5).rotateX(Math.PI / 2), clothGeo = new THREE.PlaneGeometry(0.02, 0.03).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), roadMat = stdMat(0xbaa87c, { roughness: 0.92 });
function road(a, b, color) { // 土の道と、持ち主の色の旗を 2 本
  const A = v3(B.verts[a].pos), C = v3(B.verts[b].pos), { mid, q, len } = edgeBasis(A, C);
  const grp = new THREE.Group(), body = new THREE.Mesh(roadGeo, roadMat); body.scale.y = len * 0.82; grp.add(body);
  [-0.28, 0.28].forEach((f) => {
    const post = new THREE.Mesh(postGeo, stdMat(0x6e5436)); post.position.set(0.032, len * f, 0.03);
    const cl = new THREE.Mesh(clothGeo, clothOf(color)); cl.position.set(0.032, len * f + 0.011, 0.04); grp.add(post, cl);
  });
  grp.position.copy(mid.normalize().multiplyScalar(0.998)); grp.quaternion.copy(q); return grp;
}
const bMeshes = []; // 建物と道
function refresh() {
  bMeshes.forEach((m) => scene.remove(m)); bMeshes.length = 0;
  g.vOwn.forEach((o, i) => {
    if (!o) return;
    const m = stand(building(o.city, PCOL[o.p]), v3(B.verts[i].pos, 0.996), i);
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
  if (g.robber != null) stand(robberMesh, v3(B.tiles[g.robber].center, 0.996));
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
