/*
  avatar.js: um personagem 3D que faz os sinais, em WebGL puro.

  Ideias principais deste arquivo:
  - Tudo é feito de três peças: esfera, cilindro e elipsoide (esfera
    esticada). Um dedo é uma fileira de "cápsulas" (cilindro com uma
    esfera em cada ponta), como bonecos de massinha.
  - Cinemática direta: cada dedo é uma corrente de juntas. Dobrar uma
    junta é multiplicar uma matriz de rotação, e o resto do dedo segue.
  - O polegar é posicionado por um pequeno "solver": em vez de
    escrevermos os ângulos dele à mão, dizemos onde a ponta deve
    encostar (no indicador, no médio…) e o código procura os ângulos.
  - Um único contexto WebGL desenha todas as vistas (carta, botões,
    tabela) e copia cada resultado para o <canvas> 2D da vista —
    navegadores limitam quantos contextos WebGL uma página pode ter.
*/

const Avatar = (() => {
  // ---------- Matemática: vetores, matrizes 4×4 e quatérnios ----------

  /*
    Matrizes em "column-major" (coluna por coluna), o formato que o
    WebGL espera: o elemento da linha r, coluna c fica em m[c * 4 + r].
  */
  const ident = () => {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  };

  function mul(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
        out[c * 4 + r] = sum;
      }
    }
    return out;
  }

  const translate = (x, y, z) => {
    const m = ident();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  };

  const scale = (x, y, z) => {
    const m = ident();
    m[0] = x;
    m[5] = y;
    m[10] = z;
    return m;
  };

  const rad = (deg) => (deg * Math.PI) / 180;

  // Rotação de "deg" graus em torno de um eixo qualquer (fórmula de Rodrigues).
  function rotate(axis, deg) {
    const [x, y, z] = norm(axis);
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    const t = 1 - c;
    const m = ident();
    m[0] = t * x * x + c;
    m[1] = t * x * y + s * z;
    m[2] = t * x * z - s * y;
    m[4] = t * x * y - s * z;
    m[5] = t * y * y + c;
    m[6] = t * y * z + s * x;
    m[8] = t * x * z + s * y;
    m[9] = t * y * z - s * x;
    m[10] = t * z * z + c;
    return m;
  }

  const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

  const point = (m, [x, y, z]) => [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const times = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const len = (a) => Math.hypot(...a);
  const norm = (a) => times(a, 1 / (len(a) || 1));
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

  // Perspectiva: o que está longe encolhe (fovy = abertura vertical da lente).
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(rad(fovy) / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  }

  // A câmera: leva o mundo para o ponto de vista de quem olha de "eye" para "target".
  function lookAt(eye, target) {
    const z = norm(sub(eye, target));
    const x = norm(cross([0, 1, 0], z));
    const y = cross(z, x);
    const m = ident();
    [m[0], m[4], m[8]] = x;
    [m[1], m[5], m[9]] = y;
    [m[2], m[6], m[10]] = z;
    m[12] = -dot(x, eye);
    m[13] = -dot(y, eye);
    m[14] = -dot(z, eye);
    return m;
  }

  /*
    Matriz das normais: a inversa transposta da parte 3×3 do modelo.
    Quando uma esfera é esticada (elipsoide), as normais precisam
    "esticar ao contrário" para continuarem perpendiculares à superfície.
  */
  function normalMatrix(m) {
    const [a, b, c, d, e, f, g, h, i] = [
      m[0],
      m[1],
      m[2],
      m[4],
      m[5],
      m[6],
      m[8],
      m[9],
      m[10],
    ];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C || 1;
    return new Float32Array([
      A / det,
      B / det,
      C / det,
      -(b * i - c * h) / det,
      (a * i - c * g) / det,
      -(a * h - b * g) / det,
      (b * f - c * e) / det,
      -(a * f - c * d) / det,
      (a * e - b * d) / det,
    ]);
  }

  /*
    Quatérnios guardam orientações e sabem interpolar entre duas delas
    pelo caminho mais curto (slerp) — é o que deixa a mão girar suave
    de um sinal para o outro, sem as viradas estranhas dos ângulos.
  */
  const quat = (axis, deg) => {
    const [x, y, z] = norm(axis);
    const s = Math.sin(rad(deg) / 2);
    return [x * s, y * s, z * s, Math.cos(rad(deg) / 2)];
  };

  const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];

  function slerp(a, b, t) {
    let d = dot(a, b) + a[3] * b[3];
    if (d < 0) {
      b = b.map((v) => -v);
      d = -d;
    }
    if (d > 0.9995) return norm4(a.map((v, i) => lerp(v, b[i], t)));
    const theta = Math.acos(d);
    const s = Math.sin(theta);
    const wa = Math.sin((1 - t) * theta) / s;
    const wb = Math.sin(t * theta) / s;
    return a.map((v, i) => v * wa + b[i] * wb);
  }

  const norm4 = (q) => {
    const l = Math.hypot(...q) || 1;
    return q.map((v) => v / l);
  };

  function quatMatrix([x, y, z, w]) {
    const m = ident();
    m[0] = 1 - 2 * (y * y + z * z);
    m[1] = 2 * (x * y + z * w);
    m[2] = 2 * (x * z - y * w);
    m[4] = 2 * (x * y - z * w);
    m[5] = 1 - 2 * (x * x + z * z);
    m[6] = 2 * (y * z + x * w);
    m[8] = 2 * (x * z + y * w);
    m[9] = 2 * (y * z - x * w);
    m[10] = 1 - 2 * (x * x + y * y);
    return m;
  }

  // Lista de giros nos eixos do mundo, na ordem: [["x", 90], ["y", -90]].
  const orientation = (turns = []) =>
    turns.reduce(
      (q, [axis, deg]) => qmul(quat(AXES[axis], deg), q),
      [0, 0, 0, 1],
    );

  // ---------- A mão: medidas e cinemática ----------

  /*
    Sistema da mão direita (em centímetros), com origem no punho:
    +Y aponta para os dedos, +Z sai da palma e +X vai para o polegar.
    Sem giro nenhum, a palma fica de frente para quem olha.
  */
  const FINGERS = [
    { base: [2.85, 8.3, 0], lengths: [4.0, 2.4, 1.9], radius: 1.08 }, // indicador
    { base: [0.95, 8.6, 0], lengths: [4.5, 2.8, 2.0], radius: 1.1 }, // médio
    { base: [-0.95, 8.3, 0], lengths: [4.2, 2.6, 1.9], radius: 1.04 }, // anelar
    { base: [-2.75, 7.5, 0], lengths: [3.3, 2.0, 1.7], radius: 0.92 }, // mínimo
  ];
  const THUMB = { base: [2.5, 2.0, 0.8], lengths: [4.0, 3.1, 2.6] };
  const THUMB_AXIS = [0.7, 0, 0.7];
  const SPREAD = [4, 0, -4, -9];

  /*
    Um dedo: parte da junta da base, gira para os lados (spread) e
    depois dobra junta por junta em torno do eixo X — dobrar para +Z
    é fechar em direção à palma. Devolve os pontos das juntas e o
    "quadro" (matriz) de cada falange, usado para colar a unha no dorso.
  */
  function fingerChain(finger, [mcp, pip, dip], spread) {
    let m = mul(translate(...finger.base), rotate(AXES.z, -spread));
    const points = [finger.base];
    const frames = [];
    [mcp, pip, dip].forEach((angle, i) => {
      m = mul(m, rotate(AXES.x, angle));
      frames.push(m);
      m = mul(m, translate(0, finger.lengths[i], 0));
      points.push(point(m, [0, 0, 0]));
    });
    return { points, frames };
  }

  const fingerJoints = (finger, angles, spread) =>
    fingerChain(finger, angles, spread).points;

  /*
    O polegar tem quatro ângulos: out (abre para o lado, no plano da
    palma), opp (oposição: vem para a frente da palma) e a dobra das
    duas juntas. A dobra é em torno de um eixo inclinado (THUMB_AXIS),
    porque o polegar fecha ao mesmo tempo para a frente e para o mínimo.
  */
  /*
    Polegar medido: as quatro juntas vêm prontas (points, em cm no espaço
    da mão). Cada falange recebe um "frame" girando o anterior o mínimo
    necessário para apontar na nova direção (transporte paralelo): assim
    a unha não torce à toa.
  */
  function pointsChain(points) {
    let r = rotate(AXES.z, -30);
    let dir = norm(point(r, [0, 1, 0]));
    const frames = [];
    for (let i = 0; i < 3; i++) {
      const next = norm(sub(points[i + 1], points[i]));
      const axis = cross(dir, next);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(dir, next))));
      if (len(axis) > 1e-6) r = mul(rotate(axis, (angle * 180) / Math.PI), r);
      frames.push(mul(translate(...points[i]), r));
      dir = next;
    }
    return { points, frames };
  }

  function thumbChain(thumb) {
    if (thumb.points) return pointsChain(thumb.points);
    const { out, opp, mcp, ip } = thumb;
    let m = mul(translate(...THUMB.base), rotate(AXES.z, -(30 + out)));
    m = mul(m, rotate(AXES.x, opp));
    const points = [THUMB.base];
    const frames = [];
    [0, mcp, ip].forEach((angle, i) => {
      m = mul(m, rotate(THUMB_AXIS, angle));
      frames.push(m);
      m = mul(m, translate(0, THUMB.lengths[i], 0));
      points.push(point(m, [0, 0, 0]));
    });
    return { points, frames };
  }

  const thumbJoints = (thumb) => thumbChain(thumb).points;

  const THUMB_LIMITS = {
    out: [-25, 85],
    opp: [-15, 95],
    mcp: [-10, 85],
    ip: [-15, 90],
  };

  /*
    Solver do polegar (descida por coordenadas): mexe um ângulo de
    cada vez, para mais e para menos; se a ponta chegou mais perto do
    alvo, fica com a mudança. Quando nada melhora, o passo cai pela
    metade. Poucas centenas de contas — roda uma vez por sinal.
  */
  function solveThumb(target, start = { out: 10, opp: 40, mcp: 20, ip: 20 }) {
    const cost = (t) => {
      const tip = thumbJoints(t).at(-1);
      // Um pequeno "custo de conforto" prefere juntas pouco dobradas.
      return len(sub(tip, target)) ** 2 + 0.0004 * (t.mcp ** 2 + t.ip ** 2);
    };
    let best = { ...start };
    let bestCost = cost(best);
    for (let step = 24; step > 0.5; step /= 2) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const key of Object.keys(THUMB_LIMITS)) {
          for (const dir of [1, -1]) {
            const [lo, hi] = THUMB_LIMITS[key];
            const tryPose = {
              ...best,
              [key]: Math.min(hi, Math.max(lo, best[key] + dir * step)),
            };
            const c = cost(tryPose);
            if (c < bestCost - 1e-6) {
              best = tryPose;
              bestCost = c;
              improved = true;
            }
          }
        }
      }
    }
    return best;
  }

  /*
    Transforma a receita de um sinal (veja signs.js) em uma pose
    completa: ângulos de todos os dedos, do polegar e a orientação.
  */
  // Ponto mais próximo de p no segmento a–b.
  function closestOnSegment(p, a, b) {
    const ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    return add(a, times(ab, t));
  }

  /*
    Polegar medido vem de outro boneco (o VLibras), de dedos mais finos:
    aqui ele pode ficar "enterrado" nos dedos fechados (S, G, Q, 8) e
    sumir. Para cada junta (e o meio de cada falange), se estiver mais
    perto de um dedo do que a soma dos raios, empurramos para fora, na
    direção que a afasta do dedo — e o resto do polegar vai junto.
  */
  function unburyThumb(points, fingers) {
    const CLEAR = 2.3; // raio do polegar (~1,2) + raio do dedo (~1,1)
    const segments = fingers.flatMap((f, i) => {
      const p = fingerJoints(FINGERS[i], f.angles, f.spread);
      return [0, 1, 2].map((k) => [p[k], p[k + 1]]);
    });
    const pts = points.map((p) => [...p]);
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 1; i < pts.length; i++) {
        for (const probe of [pts[i], lerp3(pts[i - 1], pts[i], 0.5)]) {
          let push = null;
          for (const [a, b] of segments) {
            const away = sub(probe, closestOnSegment(probe, a, b));
            const d = len(away);
            if (d < CLEAR) {
              // Dentro do dedo e sem direção clara: sai pela frente da palma.
              const dir = d > 0.05 ? times(away, 1 / d) : [0, 0, 1];
              const step = times(dir, CLEAR - d);
              if (!push || len(step) > len(push)) push = step;
            }
          }
          if (push)
            for (let j = i; j < pts.length; j++) pts[j] = add(pts[j], push);
        }
      }
    }
    return pts;
  }

  function resolvePose(spec) {
    const fingers = spec.fingers.map((angles, i) => ({
      angles,
      spread: spec.spread?.[i] ?? SPREAD[i],
    }));
    let thumb = spec.thumb;
    if (spec.thumb.to) {
      // Alvo: uma junta de um dedo (0 = base … 3 = ponta), mais um deslocamento.
      const [finger, joint] = spec.thumb.to;
      // Junta fracionária (1.5 = meio da falange do meio) vira um ponto interpolado.
      const joints =
        finger === "palm"
          ? null
          : fingerJoints(
              FINGERS[finger],
              fingers[finger].angles,
              fingers[finger].spread,
            );
      const k = Math.floor(joint);
      const anchor = joints
        ? lerp3(joints[k], joints[Math.min(3, k + 1)], joint - k)
        : joint;
      thumb = solveThumb(
        add(anchor, spec.thumb.offset ?? [0, 0, 0]),
        spec.thumb.start,
      );
    }
    if (thumb.points) thumb = { points: unburyThumb(thumb.points, fingers) };
    return {
      fingers,
      thumb,
      // q (quatérnio) vem pronto da captura; rotate são giros escritos à mão.
      rotation: spec.q ? norm4(spec.q) : orientation(spec.rotate),
      offset: spec.offset ?? [0, 0, 0],
      arm: spec.arm,
    };
  }

  function mixPose(a, b, t) {
    return {
      fingers: a.fingers.map((f, i) => ({
        angles: lerp3(f.angles, b.fingers[i].angles, t),
        spread: lerp(f.spread, b.fingers[i].spread, t),
      })),
      thumb:
        a.thumb.points && b.thumb.points
          ? {
              points: a.thumb.points.map((p, i) =>
                lerp3(p, b.thumb.points[i], t),
              ),
            }
          : a.thumb.points || b.thumb.points
            ? b.thumb
            : Object.fromEntries(
                Object.keys(a.thumb).map((k) => [
                  k,
                  lerp(a.thumb[k], b.thumb[k], t),
                ]),
              ),
      rotation: slerp(a.rotation, b.rotation, t),
      offset: lerp3(a.offset, b.offset, t),
      arm: a.arm && b.arm ? lerp3(a.arm, b.arm, t) : b.arm,
    };
  }

  // ---------- Movimentos ----------

  /*
    Um movimento é uma lista de quadros-chave (veja moving() em signs.js):
    em cada instante t (0 a 1 do ciclo), onde está o punho (pos, em cm),
    a orientação da mão (q, quatérnio), a direção do cotovelo (arm) e,
    opcionalmente, a forma da mão. Os quadros vêm de uma captura a 15
    quadros/s, então a interpolação entre eles é linear no tempo.
    "tip" é o dedo cuja ponta deixa o rastro pontilhado.
  */

  const ease = (t) => t * t * (3 - 2 * t);

  /*
    Catmull-Rom: uma curva que passa exatamente por todos os pontos e
    usa os vizinhos (p0 e p3) para decidir a direção em cada um — o
    caminho fica liso, sem "bicos" nos quadros-chave. Dois quadros
    iguais seguidos viram uma pausa.
  */
  const catmull = (p0, p1, p2, p3, u) =>
    0.5 *
    (2 * p1 +
      (p2 - p0) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
      (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);

  // Punho, cotovelo e orientação do movimento no instante "phase" (0 a 1).
  function moveAt(move, phase) {
    const keys = move.keys.map((k) => [...k.pos, ...k.arm, ...k.q]);
    const times = move.keys.map((k) => k.t);
    let i = times.findIndex((t) => t > phase) - 1;
    if (i < 0) i = times.length - 2;
    // A captura já traz a aceleração natural do gesto: sem ease aqui.
    const u = (phase - times[i]) / (times[i + 1] - times[i] || 1);
    // Nas pontas, o vizinho que falta é o próprio ponto.
    const p0 = keys[Math.max(0, i - 1)];
    const p3 = keys[Math.min(keys.length - 1, i + 2)];
    const value = keys[i].map((_, c) =>
      catmull(p0[c], keys[i][c], keys[i + 1][c], p3[c], u),
    );
    return {
      pos: value.slice(0, 3),
      arm: value.slice(3, 6),
      q: value.slice(6),
    };
  }

  // ---------- Personagens ----------

  /*
    O corpo fica no mundo em centímetros: o personagem olha para +Z
    (para quem vê a tela) e a mão direita sinaliza na altura do peito.
    A direita DELE fica à esquerda de quem olha — o lado -X.

    Camisa escura e lisa de propósito: é o que intérpretes de Libras
    vestem, para a mão (clara) se destacar contra o fundo.
  */
  const CHARACTERS = {
    f: {
      skin: [0.86, 0.63, 0.5],
      nail: [0.95, 0.8, 0.76],
      shirt: [0.07, 0.2, 0.25],
      hair: [0.2, 0.11, 0.08],
      lips: [0.72, 0.36, 0.38],
      handScale: 0.95,
      shoulders: 15,
      hairStyle: "long",
    },
    m: {
      skin: [0.78, 0.55, 0.41],
      nail: [0.9, 0.74, 0.68],
      shirt: [0.17, 0.11, 0.27],
      hair: [0.12, 0.09, 0.08],
      lips: [0.6, 0.35, 0.32],
      handScale: 1,
      shoulders: 17,
      hairStyle: "short",
    },
  };

  const WRIST = [-17, 131, 22];
  const DARK = [0.08, 0.06, 0.07];
  const TRAIL = [1, 0.3, 0.72];

  function cap(a, b, r, color, r2 = r) {
    return { kind: "cap", a, b, r, r2, color };
  }
  function sph(c, r, color) {
    return { kind: "sph", c, r, color };
  }
  function ell(c, r, color, m) {
    return { kind: "ell", c, r, color, m };
  }
  // "Caixa arredondada": um superelipsoide (veja boxMesh).
  function box(c, r, color, m) {
    return { kind: "box", c, r, color, m };
  }

  // Peças do corpo que não mudam com o sinal (cabeça, tronco, braço esquerdo).
  function bodyParts(c) {
    const s = c.shoulders;
    // Altura do centro da cabeça: o rosto é montado em volta dela.
    const h = 158.5;
    const parts = [
      // Tronco: peito largo e cintura mais estreita, dois elipsoides que se fundem.
      ell([0, 130, -1], [s + 1, 14, 9.5], c.shirt),
      ell([0, 113, -2], [s - 3, 15, 7.5], c.shirt),
      sph([-(s - 1), 139, 0], 5.6, c.shirt),
      sph([s - 1, 139, 0], 5.6, c.shirt),
      cap([0, 141, 0], [0, 150, 0.5], 3.8, c.skin),
      ell([0, h, 0.5], [8.4, 10.4, 9.2], c.skin),
      ell([-8.4, h, 0], [1.4, 2.6, 1.6], c.skin),
      ell([8.4, h, 0], [1.4, 2.6, 1.6], c.skin),
      // Rosto: olhos, sobrancelhas, nariz e boca.
      sph([-3.1, h + 1.6, 8.2], 1.05, DARK),
      sph([3.1, h + 1.6, 8.2], 1.05, DARK),
      cap([-4.6, h + 4.6, 7.8], [-1.8, h + 5, 8.6], 0.45, c.hair),
      cap([4.6, h + 4.6, 7.8], [1.8, h + 5, 8.6], 0.45, c.hair),
      sph([0, h - 1.4, 9.5], 1.25, c.skin),
      cap([-1.9, h - 5.4, 8.5], [1.9, h - 5.4, 8.5], 0.55, c.lips),
      // Braço esquerdo, relaxado ao lado do corpo.
      cap([s - 1, 139, 0], [s + 2, 116, 2], 4, c.shirt, 3.5),
      cap([s + 2, 116, 2], [s + 3, 95, 7], 2.9, c.skin, 2.3),
      ell([s + 3, 89, 8], [2.4, 4.6, 3.4], c.skin),
      // Cabelo: um "capacete" atrás e em cima da cabeça.
      ell([0, h + 3.5, -1.4], [9.2, 8.6, 9.6], c.hair),
    ];
    if (c.hairStyle === "long") {
      parts.push(
        ell([0, h - 9, -4.5], [10, 15, 6.5], c.hair),
        cap([-8.4, h + 5, 2], [-9.6, h - 13, 0], 2.6, c.hair),
        cap([8.4, h + 5, 2], [9.6, h - 13, 0], 2.6, c.hair),
        ell([0, h + 8, 4], [7.8, 3.2, 5.6], c.hair),
      );
    } else {
      parts.push(ell([0, h + 7.5, 3], [8, 3, 6], c.hair));
    }
    return parts;
  }

  /*
    Monta as peças da mão direita para uma pose. "hand" é a matriz que
    leva da mão (punho na origem) para o mundo.
  */
  function handParts(c, pose, hand) {
    const skin = c.skin;
    const w = (p) => point(hand, p);
    const parts = [
      // Palma: caixa arredondada, mais as "almofadas" da base do polegar e do mínimo.
      box([0, 4.7, 0.1], [4.0, 4.4, 1.65], skin, hand),
      ell([2.0, 2.6, 0.8], [1.9, 2.5, 1.45], skin, hand),
      ell([-2.4, 3.3, 0.55], [1.5, 3.1, 1.3], skin, hand),
      ell([0, 0.5, 0], [2.6, 1.7, 1.75], skin, hand),
    ];
    pose.fingers.forEach((f, i) => {
      const finger = FINGERS[i];
      const { points, frames } = fingerChain(finger, f.angles, f.spread);
      const p = points.map(w);
      // O dedo afina da base para a ponta.
      const r = [1.04, 0.96, 0.89, 0.83].map((k) => k * finger.radius);
      for (let k = 0; k < 3; k++)
        parts.push(cap(p[k], p[k + 1], r[k], skin, r[k + 1]));
      parts.push(
        nail(c, mul(hand, frames[2]), finger.lengths[2], r[3], [0, 0, -1]),
      );
    });
    const { points, frames } = thumbChain(pose.thumb);
    const t = points.map(w);
    parts.push(cap(t[0], t[1], 1.5, skin, 1.22));
    parts.push(cap(t[1], t[2], 1.22, skin, 1.1));
    parts.push(cap(t[2], t[3], 1.1, skin, 1.0));
    // A unha do polegar fica de lado: ele é "girado" em relação aos outros dedos.
    parts.push(
      nail(c, mul(hand, frames[2]), THUMB.lengths[2], 1.0, [0.75, 0, -0.65]),
    );
    return parts;
  }

  /*
    Unha: um elipsoide achatado no dorso da última falange. Parece
    detalhe, mas é o que mostra de cara se estamos vendo a palma (sem
    unhas) ou as costas da mão (com unhas) — essencial para ler sinais.
  */
  function nail(c, frame, length, r, side) {
    const [x, , z] = norm(side);
    const center = [x * r * 0.62, length * 0.6, z * r * 0.62];
    // Gira o elipsoide para "deitar" na direção do dorso (side).
    const turn = rotate(AXES.y, (Math.atan2(x, -z) * 180) / Math.PI);
    const m = mul(mul(frame, translate(...center)), turn);
    return ell([0, 0, 0], [r * 0.7, length * 0.4, r * 0.36], c.nail, m);
  }

  /*
    O braço não tem juntas próprias: o cotovelo é calculado. Ele fica
    "atrás" do punho, numa direção que mistura o caimento natural do
    braço com o prolongamento da mão — assim, se a mão aponta para
    baixo (M, N), o antebraço deita; se aponta para o lado (P, X), ele
    vem do outro lado.
  */
  /*
    O cotovelo sai de uma mistura entre o braço "de descanso" e a direção
    da mão. Um movimento pode dizer a direção exata (arm: do punho para o
    cotovelo) — no J o cotovelo sobe e vai para fora.
  */
  function armParts(c, hand, arm) {
    const wrist = point(hand, [0, 0, 0]);
    const along = norm(sub(wrist, point(hand, [0, 1, 0])));
    const rest = norm([-0.15, -0.85, -0.5]);
    const dir = arm
      ? norm(arm)
      : norm(add(times(rest, 0.5), times(along, 0.5)));
    const elbow = add(wrist, times(dir, 25));
    const shoulder = [-(c.shoulders - 1), 139, 0];
    return [
      cap(shoulder, elbow, 4.2, c.shirt, 3.6),
      cap(elbow, wrist, 3.0, c.skin, 2.3),
    ];
  }

  // ---------- WebGL ----------

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    antialias: true,
    premultipliedAlpha: true,
  });

  /*
    Os shaders são programas que rodam na placa de vídeo.

    Vértice: leva cada ponto da malha para a tela. Dois truques:
    - taper afina o cilindro numa das pontas (dedos, antebraço);
    - outline empurra a superfície para fora, ao longo da normal. É o
      contorno de desenho animado ("inverted hull"): desenhamos cada
      peça de novo, um pouco maior, só com as faces de TRÁS e em cor
      escura — o que sobra em volta vira uma linha. A largura é
      multiplicada pela distância até a câmera, para a linha ter a
      mesma espessura na tela, perto ou longe.

    Fragmento: a cor de cada pixel. Luz "embrulhada" (wrap: a sombra
    começa depois da metade, como na pele, que espalha a luz por
    dentro), uma luz de preenchimento, um brilho especular fraco e um
    brilho de borda (rim) que descola a mão do fundo.
  */
  const VERTEX = `
    attribute vec3 position;
    attribute vec3 normal;
    uniform mat4 viewProj;
    uniform mat4 model;
    uniform mat3 normals;
    uniform float taper;
    uniform float outline;
    uniform vec3 eye;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main() {
      vec3 p = position;
      p.xz *= mix(1.0, taper, clamp(p.y, 0.0, 1.0));
      vec3 n = normalize(normals * normal);
      vec3 world = (model * vec4(p, 1.0)).xyz;
      world += n * outline * distance(world, eye);
      vNormal = n;
      vWorld = world;
      gl_Position = viewProj * vec4(world, 1.0);
    }`;
  const FRAGMENT = `
    // highp: uniforms usados nos dois shaders (eye, outline) precisam ter a mesma precisão.
    precision highp float;
    uniform vec3 color;
    uniform vec3 eye;
    uniform float outline;
    varying vec3 vNormal;
    varying vec3 vWorld;
    void main() {
      if (outline > 0.0) {
        gl_FragColor = vec4(color, 1.0);
        return;
      }
      vec3 n = normalize(vNormal);
      vec3 v = normalize(eye - vWorld);
      if (dot(n, v) < 0.0) n = -n;
      vec3 l = normalize(vec3(-0.35, 0.65, 0.7));
      float wrap = max((dot(n, l) + 0.4) / 1.4, 0.0);
      float fill = max(dot(n, normalize(vec3(0.7, -0.1, 0.6))), 0.0);
      float spec = pow(max(dot(n, normalize(l + v)), 0.0), 40.0) * 0.1;
      float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
      vec3 lit = color * (0.3 + 0.7 * wrap + 0.14 * fill)
        + spec + rim * 0.14 * vec3(1.0, 0.85, 0.95);
      gl_FragColor = vec4(lit, 1.0);
    }`;

  let program;
  let loc;
  let meshes;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    // Erro de digitação num shader só aparece aqui, então vale avisar no console.
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  // Malhas: listas de vértices (posição + normal) e de triângulos (índices).
  function buildMesh(positions, normals, indices) {
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const data = new Float32Array(positions.length * 2);
    for (let i = 0; i < positions.length / 3; i++) {
      data.set(positions.slice(i * 3, i * 3 + 3), i * 6);
      data.set(normals.slice(i * 3, i * 3 + 3), i * 6 + 3);
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(indices),
      gl.STATIC_DRAW,
    );
    return { vbo, ibo, count: indices.length };
  }

  /*
    Esfera e superelipsoide saem da mesma receita: anéis de latitude ×
    fatias de longitude. "e" é o expoente: com e = 1, esfera; com e < 1,
    os cossenos e senos "achatam" e a forma vira uma caixa de cantos
    arredondados (ótima para a palma). A normal usa o expoente 2 − e.
  */
  function roundMesh(e = 1, rings = 16, slices = 24) {
    const pw = (v, k) => Math.sign(v) * Math.abs(v) ** k;
    const p = [];
    const n = [];
    const idx = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings) * Math.PI;
      for (let s = 0; s <= slices; s++) {
        const theta = (s / slices) * Math.PI * 2;
        for (const [list, k] of [
          [p, e],
          [n, 2 - e],
        ]) {
          list.push(
            pw(Math.sin(phi), k) * pw(Math.cos(theta), k),
            pw(Math.cos(phi), k),
            pw(Math.sin(phi), k) * pw(Math.sin(theta), k),
          );
        }
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < slices; s++) {
        const a = r * (slices + 1) + s;
        const b = a + slices + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return buildMesh(p, n, idx);
  }

  // Cilindro aberto de raio 1, de y = 0 a y = 1.
  function cylinderMesh(slices = 24) {
    const p = [];
    const n = [];
    const idx = [];
    for (let s = 0; s <= slices; s++) {
      const theta = (s / slices) * Math.PI * 2;
      const x = Math.cos(theta);
      const z = Math.sin(theta);
      p.push(x, 0, z, x, 1, z);
      n.push(x, 0, z, x, 0, z);
    }
    for (let s = 0; s < slices; s++) {
      const a = s * 2;
      // Mesma ordem dos triângulos da esfera (importa para o contorno).
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    return buildMesh(p, n, idx);
  }

  function setup() {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    gl.useProgram(program);
    loc = {};
    for (const name of [
      "viewProj",
      "model",
      "normals",
      "color",
      "eye",
      "taper",
      "outline",
    ]) {
      loc[name] = gl.getUniformLocation(program, name);
    }
    loc.position = gl.getAttribLocation(program, "position");
    loc.normal = gl.getAttribLocation(program, "normal");
    meshes = {
      sphere: roundMesh(1),
      box: roundMesh(0.45),
      cylinder: cylinderMesh(),
    };
    // Teste de profundidade: o que está na frente esconde o que está atrás.
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
  }

  // Matriz que leva o cilindro unitário para o segmento de a até b.
  function segmentMatrix(a, b, r) {
    const axis = sub(b, a);
    const y = norm(axis);
    const helper = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const x = norm(cross(helper, y));
    const z = cross(x, y);
    const m = ident();
    [m[0], m[1], m[2]] = times(x, r);
    [m[4], m[5], m[6]] = axis;
    [m[8], m[9], m[10]] = times(z, r);
    [m[12], m[13], m[14]] = a;
    return m;
  }

  function draw(mesh, model, color, taper = 1) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    gl.vertexAttribPointer(loc.position, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(loc.normal, 3, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(loc.position);
    gl.enableVertexAttribArray(loc.normal);
    gl.uniformMatrix4fv(loc.model, false, model);
    gl.uniformMatrix3fv(loc.normals, false, normalMatrix(model));
    gl.uniform3fv(loc.color, color);
    gl.uniform1f(loc.taper, taper);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }

  const ball = (c, r) => mul(translate(...c), scale(r, r, r));

  // No contorno, a cor da peça escurecida vira a cor da linha.
  function drawPart(part, outlined = false) {
    const color = outlined ? times(part.color, 0.28) : part.color;
    if (part.kind === "sph") {
      draw(meshes.sphere, ball(part.c, part.r), color);
    } else if (part.kind === "ell" || part.kind === "box") {
      const local = mul(translate(...part.c), scale(...part.r));
      const mesh = part.kind === "box" ? meshes.box : meshes.sphere;
      draw(mesh, part.m ? mul(part.m, local) : local, color);
    } else {
      draw(
        meshes.cylinder,
        segmentMatrix(part.a, part.b, part.r),
        color,
        part.r2 / part.r,
      );
      draw(meshes.sphere, ball(part.a, part.r), color);
      draw(meshes.sphere, ball(part.b, part.r2), color);
    }
  }

  // ---------- Vistas: cada <canvas> 2D que mostra um sinal ----------

  const signs = {};
  let character = CHARACTERS.f;
  let body = null;
  const views = new Map();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const FOV = 30;

  function handMatrix(c, pose, extra) {
    const position = add(add(WRIST, pose.offset), extra?.pos ?? [0, 0, 0]);
    // No movimento, q é a orientação da mão naquele quadro (quatérnio).
    const turn = extra ? norm4(extra.q) : [0, 0, 0, 1];
    const s = c.handScale;
    return mul(
      mul(translate(...position), quatMatrix(qmul(turn, pose.rotation))),
      scale(s, s, s),
    );
  }

  /*
    Uma vista guarda o sinal atual e o anterior: na troca, a pose
    "derrete" de um para o outro em 350 ms (mixPose).
  */
  /*
    Forma da mão no instante "phase", para movimentos em que os dedos
    também mexem (o Ç treme os dedos; no K o médio sobe): cada quadro
    guarda uma pose já resolvida (shape) e misturamos as duas vizinhas.
  */
  function shapeAt(move, phase) {
    const keys = move.keys;
    let i = keys.findIndex((k) => k.t > phase) - 1;
    if (i < 0) i = keys.length - 2;
    const u = (phase - keys[i].t) / (keys[i + 1].t - keys[i].t || 1);
    return mixPose(keys[i].shape, keys[i + 1].shape, u);
  }

  function viewState(view, now) {
    const sign = signs[view.sign];
    const move = sign.move;
    // phase fixa = um quadro congelado do movimento (sem animação).
    const period = move?.period ?? 1;
    const phase = view.phase ?? ((now - view.changedAt) % period) / period;
    let pose = move?.keys[0].shape ? shapeAt(move, phase) : sign.pose;
    const morph = reduceMotion.matches
      ? 1
      : Math.min(1, (now - view.changedAt) / 350);
    if (morph < 1 && view.from)
      pose = mixPose(signs[view.from].pose, pose, ease(morph));
    const extra = move ? moveAt(move, phase) : undefined;
    return { pose, move, extra, morphing: morph < 1 };
  }

  // Câmera do close: centro e distância cobrem as mãos de todos os sinais.
  const CLOSE_CENTER = [-11, 139, 18];
  const CLOSE_DISTANCE = 76;

  /*
    Rastro do movimento: a ponta do dedo amostrada ao longo do trecho
    em que a mão anda (move.trail), desenhada como um tubo tracejado
    com uma ponta de seta (um cilindro com taper 0 vira um cone).
  */
  function trailParts(pose, move) {
    const [from, to] = move.trail ?? [0, 0.6];
    // Ponta do dedo no espaço da mão (os dedos podem mexer durante o gesto).
    const tipOf = (p) => {
      const f = p.fingers[move.tip];
      const { points } = fingerChain(FINGERS[move.tip], f.angles, f.spread);
      const tipDir = norm(sub(points[3], points[2]));
      return add(points[3], times(tipDir, 1.1));
    };
    const samples = [];
    for (let i = 0; i <= 30; i++) {
      const phase = from + ((to - from) * i) / 30;
      const at = moveAt(move, phase);
      const shape = move.keys[0].shape ? shapeAt(move, phase) : pose;
      samples.push(point(handMatrix(character, pose, at), tipOf(shape)));
    }
    const parts = [];
    for (let i = 0; i < samples.length - 2; i += 2) {
      parts.push(cap(samples[i], samples[i + 1], 0.32, TRAIL));
    }
    const end = samples.at(-1);
    const dir = norm(sub(end, samples.at(-3)));
    parts.push({ ...cap(end, add(end, times(dir, 1.8)), 0.85, TRAIL, 0.01) });
    return parts;
  }

  function render(view, now) {
    const { canvas: target } = view;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(target.clientWidth * dpr);
    const h = Math.round(target.clientHeight * dpr);
    if (!w || !h) return false;
    if (target.width !== w || target.height !== h) {
      target.width = w;
      target.height = h;
    }
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }

    const { pose, move, extra } = viewState(view, now);
    const hand = handMatrix(character, pose, extra);

    const close = view.framing === "hand";
    /*
      Close com câmera FIXA, igual para todos os sinais: mira o meio da
      região onde as mãos de todos os sinais ficam (medida nos dados).
      Assim os quadros são comparáveis e a posição da mão em relação ao
      corpo — um dos parâmetros da Libras — também ensina.
    */
    const center = close ? CLOSE_CENTER : [-4, 140, 0];
    const distance = close ? CLOSE_DISTANCE : 140;
    const yaw = rad(view.yaw + (close ? -10 : -6));
    const pitch = rad(view.pitch + 4);
    const eye = add(center, [
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    ]);
    gl.uniformMatrix4fv(
      loc.viewProj,
      false,
      mul(perspective(FOV, w / h, 5, 600), lookAt(eye, center)),
    );
    gl.uniform3fv(loc.eye, eye);

    gl.viewport(0, 0, w, h);
    gl.scissor(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    body ??= bodyParts(character);
    const parts = [
      ...body,
      ...armParts(character, hand, extra?.arm ?? pose.arm),
      ...handParts(character, pose, hand),
    ];
    // 1ª passada: as peças normais.
    gl.uniform1f(loc.outline, 0);
    gl.disable(gl.CULL_FACE);
    for (const part of parts) drawPart(part);
    // 2ª passada: o contorno (só o lado de dentro das peças infladas).
    const pixel = (2 * Math.tan(rad(FOV) / 2)) / h;
    gl.uniform1f(loc.outline, 1.4 * dpr * pixel);
    gl.enable(gl.CULL_FACE);
    // Nossas malhas têm os triângulos no sentido horário: as faces "de trás" são as BACK.
    gl.cullFace(gl.BACK);
    for (const part of parts) drawPart(part, true);
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(loc.outline, 0);

    if (move?.tip !== undefined) {
      for (const part of trailParts(signs[view.sign].pose, move))
        drawPart(part);
    }

    // Copia o canto de baixo do canvas WebGL (a origem dele é embaixo) para a vista.
    const ctx = view.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, canvas.height - h, w, h, 0, 0, w, h);
    return true;
  }

  /*
    Um só laço de animação para todas as vistas. Só redesenha o que
    precisa: vistas com movimento, no meio de uma troca, sendo
    arrastadas, ou marcadas como "sujas" (dirty). Vistas que saíram
    da página são esquecidas.
  */
  function loop(now) {
    for (const view of views.values()) {
      if (!view.canvas.isConnected) {
        views.delete(view.canvas);
        continue;
      }
      const sign = signs[view.sign];
      const busy =
        view.dirty ||
        view.dragging ||
        (sign.move && view.phase == null) ||
        now - view.changedAt < 400;
      if (busy && render(view, now)) view.dirty = false;
    }
    requestAnimationFrame(loop);
  }

  // Arrastar gira a câmera em volta da mão; dois cliques voltam ao normal.
  function makeInteractive(view) {
    const c = view.canvas;
    c.addEventListener("pointerdown", (e) => {
      view.dragging = {
        x: e.clientX,
        y: e.clientY,
        yaw: view.yaw,
        pitch: view.pitch,
      };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      const d = view.dragging;
      if (!d) return;
      view.yaw = Math.max(-80, Math.min(80, d.yaw - (e.clientX - d.x) * 0.5));
      view.pitch = Math.max(
        -40,
        Math.min(50, d.pitch + (e.clientY - d.y) * 0.4),
      );
    });
    const stop = () => {
      view.dragging = null;
      view.dirty = true;
    };
    c.addEventListener("pointerup", stop);
    c.addEventListener("pointercancel", stop);
    c.addEventListener("dblclick", () => {
      view.yaw = 0;
      view.pitch = 0;
      view.dirty = true;
    });
  }

  // ---------- API usada pelo libras.js ----------

  const supported = Boolean(gl);
  if (supported) {
    setup();
    requestAnimationFrame(loop);
    // Janela mudou de tamanho: os canvas também, então tudo é redesenhado.
    addEventListener("resize", () => {
      for (const view of views.values()) view.dirty = true;
    });
  }

  return {
    supported,
    // Registra os sinais: resolve as poses (e o polegar) uma vez só.
    define(table) {
      for (const [id, spec] of Object.entries(table)) {
        // Quadros com a forma da mão (hand) viram poses prontas uma vez só.
        for (const k of spec.move?.keys ?? []) {
          if (!k.hand) continue;
          const [fingers, spread, thumb] = k.hand;
          k.shape = resolvePose({ fingers, spread, thumb: { points: thumb } });
        }
        signs[id] = { pose: resolvePose(spec), move: spec.move };
      }
    },
    character(key) {
      character = CHARACTERS[key] ?? CHARACTERS.f;
      body = null;
      for (const view of views.values()) view.dirty = true;
    },
    // Liga um <canvas> a um sinal. framing: "hand" (close) ou "body".
    show(
      target,
      sign,
      { framing = "hand", interactive = false, phase = null, yaw, pitch } = {},
    ) {
      let view = views.get(target);
      if (!view) {
        view = {
          canvas: target,
          ctx: target.getContext("2d"),
          yaw: 0,
          pitch: 0,
        };
        views.set(target, view);
        if (interactive) makeInteractive(view);
      }
      if (view.sign !== sign) {
        view.from = view.sign;
        view.sign = sign;
        view.changedAt = performance.now();
      }
      view.framing = framing;
      view.phase = phase;
      // Ângulo inicial da câmera (graus), opcional.
      if (yaw !== undefined) view.yaw = yaw;
      if (pitch !== undefined) view.pitch = pitch;
      view.dirty = true;
    },
    // Qual sinal um canvas está mostrando.
    signOf(target) {
      return views.get(target)?.sign;
    },
    // Marca uma vista para redesenhar (ex.: depois de aparecer na tela).
    refresh(target) {
      const view = views.get(target);
      if (view) view.dirty = true;
    },
  };
})();
