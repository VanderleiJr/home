/*
  fk.js: cinemática direta de um AnimationClip "legacy" do Unity.

  O clipe só guarda, para cada osso, posição/rotação/escala LOCAIS (em
  relação ao osso pai). A posição no mundo sai multiplicando a cadeia
  inteira, do quadril até a ponta do dedo: mundo = pai × (T · R · S).
  Amostramos a 30 quadros/s e devolvemos, por quadro, a posição e a
  direção (eixo Y local = ao longo do osso) dos ossos que interessam.
*/

// Hermite entre chaves (como o Unity avalia curvas).
function sample(keys, t, comps) {
  if (t <= keys[0].time) return comps.map((c) => keys[0].value[c]);
  const last = keys.at(-1);
  if (t >= last.time) return comps.map((c) => last.value[c]);
  let i = 0;
  while (keys[i + 1].time < t) i++;
  const a = keys[i],
    b = keys[i + 1];
  const dt = b.time - a.time,
    u = (t - a.time) / dt;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1,
    h10 = u ** 3 - 2 * u ** 2 + u,
    h01 = -2 * u ** 3 + 3 * u ** 2,
    h11 = u ** 3 - u ** 2;
  return comps.map((c) => {
    const m0 = isFinite(a.outSlope[c]) ? a.outSlope[c] * dt : 0;
    const m1 = isFinite(b.inSlope[c]) ? b.inSlope[c] * dt : 0;
    if (!isFinite(a.outSlope[c]) || !isFinite(b.inSlope[c])) return a.value[c];
    return h00 * a.value[c] + h10 * m0 + h01 * b.value[c] + h11 * m1;
  });
}

function framesFromClip(clip) {
  const bones = {};
  const bone = (p) =>
    (bones[p] ??= { path: p, pos: null, rot: null, scl: null });
  for (const c of clip.m_PositionCurves) bone(c.path).pos = c.curve.m_Curve;
  for (const c of clip.m_RotationCurves) bone(c.path).rot = c.curve.m_Curve;
  for (const c of clip.m_ScaleCurves) bone(c.path).scl = c.curve.m_Curve;

  const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const qrot = (q, v) => {
    const p = qmul(qmul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]);
    return p.slice(0, 3);
  };
  const qnorm = (q) => {
    const l = Math.hypot(...q);
    return q.map((x) => x / l);
  };

  // Transformação no mundo: pai * (T * R * S) do filho.
  function world(path, t, cache) {
    if (cache[path]) return cache[path];
    const b = bones[path];
    const pos = b?.pos ? sample(b.pos, t, ["x", "y", "z"]) : [0, 0, 0];
    const rot = b?.rot
      ? qnorm(sample(b.rot, t, ["x", "y", "z", "w"]))
      : [0, 0, 0, 1];
    const scl = b?.scl ? sample(b.scl, t, ["x", "y", "z"]) : [1, 1, 1];
    const cut = path.lastIndexOf("/");
    let W;
    if (cut < 0) W = { p: pos, q: rot, s: scl };
    else {
      const P = world(path.slice(0, cut), t, cache);
      const sp = pos.map((x, i) => x * P.s[i]);
      W = {
        p: qrot(P.q, sp).map((x, i) => x + P.p[i]),
        q: qmul(P.q, rot),
        s: scl.map((x, i) => x * P.s[i]),
      };
    }
    return (cache[path] = W);
  }

  const find = (end) => Object.keys(bones).find((p) => p.endsWith(end));
  const KEYS = {
    head: "/BnCabeca",
    neck: "/BnPescoco",
    chest: "/BnCol-03",
    shoulderL: "/BnBraco.L",
    shoulder: "/BnBraco.R",
    elbow: "/BnAntBraco.R",
    fore: "/BnAntBraco.R.001",
    wrist: "/BnMao.R",
    eyeL: "/BnOlho.L",
    eyeR: "/BnOlho.R",
    pinky0: "/BnDedo.1.R",
    pinky1: "/BnDedo.1.R.006",
    pinky2: "/BnDedo.1.R.005",
    ring0: "/BnDedo.1.R.001",
    ring1: "/BnDedo.1.R.008",
    ring2: "/BnDedo.1.R.007",
    middle0: "/BnDedo.1.R.002",
    middle1: "/BnDedo.1.R.010",
    middle2: "/BnDedo.1.R.009",
    index0: "/BnDedo.1.R.003",
    index1: "/BnDedo.1.R.012",
    index2: "/BnDedo.1.R.011",
    thumb0: "/BnDedo.1.R.004",
    thumb1: "/BnDedo.1.R.014",
    thumb2: "/BnDedo.1.R.013",
  };
  const paths = Object.fromEntries(
    Object.entries(KEYS).map(([k, e]) => [k, find(e)]),
  );
  const dur = clip.m_RotationCurves[0].curve.m_Curve.at(-1).time;
  const frames = [];
  for (let t = 0; t <= dur + 1e-6; t += 1 / 30) {
    const cache = {};
    const f = { t: +t.toFixed(3) };
    for (const [k, p] of Object.entries(paths)) {
      const W = world(p, t, cache);
      f[k] = W.p.map((x) => +x.toFixed(4));
      // Direção de cada osso (o eixo Y local do Unity corre ao longo do osso).
      f[k + "Dir"] = qrot(W.q, [0, 1, 0]).map((x) => +x.toFixed(4));
    }
    frames.push(f);
  }
  return frames;
}

module.exports = { framesFromClip };
