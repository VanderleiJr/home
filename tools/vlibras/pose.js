/*
  pose.js: converte um quadro da cinemática do VLibras para o avatar.

  - Coordenadas: o Unity usa mão esquerda (x para a direita DO avatar);
    o nosso mundo é mão direita, com a direita do boneco em -X. Espelhar
    x converte uma na outra.
  - Escala: igualamos a largura dos ombros (1 unidade ≈ 11,8 cm) e
    ancoramos no ombro direito do nosso boneco.
  - Mão: montamos a base X (polegar), Y (dedos), Z (palma) e medimos os
    ângulos de cada dedo do mesmo jeito que o fingerChain os aplica.
*/
const SHOULDER = [-15, 139, 0];
const WRIST = [-17, 131, 22];
const K = 11.8;
const OUR_MIDDLE = 8.6; // altura da base do médio na nossa mão (cm)

const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const mulv = (a, s) => a.map((v) => v * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = (a) => mulv(a, 1 / Math.hypot(...a));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const deg = (r) => (r * 180) / Math.PI;
const mirror = (v) => [-v[0], v[1], v[2]];
const ours = (f, k) => add(SHOULDER, mulv(mirror(sub(f[k], f.shoulder)), K));
const dirOf = (f, k) => mirror(f[k + "Dir"]);

function quatFromBasis(X, Y, Z) {
  const [m00, m10, m20] = X,
    [m01, m11, m21] = Y,
    [m02, m12, m22] = Z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

// Base da mão no nosso padrão: Y = dedos, X = lado do polegar, Z = palma.
function handBasis(f) {
  const w = ours(f, "wrist");
  const Y = norm(sub(ours(f, "middle0"), w));
  let X = norm(sub(ours(f, "index0"), ours(f, "ring0")));
  const Z = norm(cross(X, Y));
  X = cross(Y, Z);
  return { w, X, Y, Z };
}
const local = (B, v) => [dot(v, B.X), dot(v, B.Y), dot(v, B.Z)];

// Ângulos [base, meio, ponta] + abertura, no mesmo encadeamento do fingerChain.
function fingerAngles(f, B, name) {
  const d = [0, 1, 2].map((i) => local(B, dirOf(f, name + i)));
  const mcp = deg(Math.asin(Math.max(-1, Math.min(1, d[0][2]))));
  // Com o dedo "deitado" (base ~90°) a abertura fica indefinida: usa a dos outros.
  const spread =
    Math.hypot(d[0][0], d[0][1]) > 0.35
      ? deg(Math.atan2(d[0][0], d[0][1]))
      : null;
  // Eixo de dobra do dedo: o X da mão girado pela abertura (como no fingerChain).
  const s = ((spread ?? 0) * Math.PI) / 180;
  const axis = [Math.cos(s), -Math.sin(s), 0];
  const flex = (u, v) => deg(Math.atan2(dot(cross(u, v), axis), dot(u, v)));
  return { angles: [mcp, flex(d[0], d[1]), flex(d[1], d[2])], spread };
}

function thumbPoints(f, B) {
  const scale =
    OUR_MIDDLE / Math.hypot(...local(B, sub(ours(f, "middle0"), B.w)));
  const t2 = ours(f, "thumb2");
  const len = Math.hypot(...sub(t2, ours(f, "thumb1"))) * 0.9;
  const tip = add(t2, mulv(dirOf(f, "thumb2"), len));
  const at = (p) =>
    mulv(local(B, sub(p, B.w)), scale).map((v) => +v.toFixed(1));
  return [at(ours(f, "thumb0")), at(ours(f, "thumb1")), at(t2), at(tip)];
}

function poseAt(f) {
  const B = handBasis(f);
  const names = ["index", "middle", "ring", "pinky"];
  const fa = names.map((n) => fingerAngles(f, B, n));
  const r = (a, d = 0) => a.map((v) => +v.toFixed(d));
  return {
    fingers: fa.map((x) => r(x.angles)),
    spread: fa.map((x, i) =>
      x.spread == null ? [4, 0, -4, -9][i] : Math.round(x.spread),
    ),
    thumb: thumbPoints(f, B),
    q: r(quatFromBasis(B.X, B.Y, B.Z), 3),
    offset: r(sub(B.w, WRIST), 1),
    arm: r(norm(sub(ours(f, "elbow"), B.w)), 2),
  };
}

// Quadro de pose: o meio do trecho mais longo em que a mão quase não se move.
function holdFrame(F) {
  const pts = ["wrist", "pinky2", "index2", "middle2", "thumb2"];
  const sp = F.map((f, i) =>
    i === 0
      ? 99
      : Math.max(...pts.map((k) => Math.hypot(...sub(f[k], F[i - 1][k])))) *
        13.4 *
        30,
  );
  let best = [0, 0],
    start = -1;
  sp.forEach((v, i) => {
    if (v < 3 && start < 0) start = i;
    if ((v >= 3 || i === sp.length - 1) && start >= 0) {
      const end = v >= 3 ? i - 1 : i;
      if (end - start > best[1] - best[0]) best = [start, end];
      start = -1;
    }
  });
  if (best[1] === 0) return Math.floor(F.length / 2);
  return Math.round((best[0] + best[1]) / 2);
}

module.exports = { poseAt, holdFrame, handBasis, ours };
