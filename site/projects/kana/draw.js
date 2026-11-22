/*
  draw.js: confere a escrita de um kana, traço por traço.

  Não é um reconhecedor "de verdade" (que adivinha qual letra foi
  escrita): o jogo já sabe qual kana pediu. Então basta comparar cada
  traço desenhado com o traço esperado do KanjiVG (strokes.js), a mesma
  ideia usada por apps de escrita como o Hanzi Writer.

  Tudo aqui é matemática pura, sem DOM: o mesmo arquivo roda no
  navegador (window.Draw) e no Node (tools/kanjivg/check.js testa).
  Pontos são [x, y] em unidades do KanjiVG: cada célula mede 109×109.
*/
(function (root) {
  const BOX = 109;
  // Quantos pontos cada traço vira antes da comparação.
  const SAMPLES = 32;
  /*
    Distância média máxima (em unidades da caixa de 109) entre o traço
    desenhado e o esperado para contar como certo. 14 ≈ 13% do quadro:
    tolera mão tremida e letra um pouco fora do lugar, mas não um traço
    trocado. Ajustado com desenhos reais no tablet.
  */
  const LIMIT = 14;
  // Regra da forma (veja matchStroke): erro de forma máximo (fração do
  // comprimento), quanto o centro do traço pode fugir e o que é "curto".
  const SHAPE_LIMIT = 0.12;
  const DRIFT = 22;
  const SHORT = 20;

  /*
    Converte o "d" de um <path> em pontos. O KanjiVG só usa M (mover),
    C/c (curva cúbica), S/s (curva que continua a anterior) e às vezes
    L/l (reta). Minúscula = coordenadas relativas ao ponto atual.
    Cada curva vira alguns pontos calculados pela fórmula de Bézier.
  */
  function pathPoints(d) {
    const tokens = d.match(/[MmCcSsLl]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
    const points = [];
    let x = 0;
    let y = 0;
    let control = null; // último ponto de controle (para o S)
    let command = "";
    let i = 0;
    const num = () => Number(tokens[i++]);

    while (i < tokens.length) {
      // Números sem letra na frente repetem o último comando.
      if (/[A-Za-z]/.test(tokens[i])) command = tokens[i++];
      const relative = command === command.toLowerCase();
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      const type = command.toUpperCase();

      if (type === "M" || type === "L") {
        x = ox + num();
        y = oy + num();
        points.push([x, y]);
        control = null;
        // Depois de um M, pares extras de números são retas (regra do SVG).
        if (type === "M") command = relative ? "l" : "L";
      } else {
        let c1;
        if (type === "C") {
          c1 = [ox + num(), oy + num()];
        } else {
          // S: o 1º controle é o reflexo do último controle da curva anterior.
          c1 = control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
        }
        const c2 = [ox + num(), oy + num()];
        const end = [ox + num(), oy + num()];
        cubic([x, y], c1, c2, end, points);
        control = c2;
        [x, y] = end;
      }
    }
    return points;
  }

  // Bézier cúbica: B(t) = (1−t)³P0 + 3(1−t)²t·P1 + 3(1−t)t²·P2 + t³P3.
  function cubic(p0, p1, p2, p3, out) {
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      const a = (1 - t) ** 3;
      const b = 3 * (1 - t) ** 2 * t;
      const c = 3 * (1 - t) * t ** 2;
      const e = t ** 3;
      out.push([
        a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0],
        a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1],
      ]);
    }
  }

  const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /*
    Reamostra o traço em n pontos igualmente espaçados ao longo dele.
    Quem desenha devagar gera muitos pontos e quem desenha rápido,
    poucos; depois disto os dois traços ficam comparáveis ponto a ponto:
    o 1º com o 1º, o 10º com o 10º…
  */
  function resample(points, n = SAMPLES) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) {
      lengths.push(lengths[i - 1] + gap(points[i - 1], points[i]));
    }
    const total = lengths.at(-1);
    // Um toque sem arrastar: o "traço" é um ponto repetido n vezes.
    if (!total) return Array.from({ length: n }, () => points[0].slice(0, 2));
    const out = [];
    let j = 1;
    for (let k = 0; k < n; k++) {
      const target = (total * k) / (n - 1);
      while (j < points.length - 1 && lengths[j] < target) j++;
      const span = lengths[j] - lengths[j - 1] || 1;
      const t = Math.min(1, Math.max(0, (target - lengths[j - 1]) / span));
      const [ax, ay] = points[j - 1];
      const [bx, by] = points[j];
      out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
    return out;
  }

  // Distância média entre os pontos de mesma posição dos dois traços.
  function meanGap(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += gap(a[i], b[i]);
    return sum / a.length;
  }

  const length = (stroke) =>
    stroke.reduce((sum, p, i) => sum + (i ? gap(stroke[i - 1], p) : 0), 0);
  const center = (stroke) => [
    stroke.reduce((sum, [x]) => sum + x, 0) / stroke.length,
    stroke.reduce((sum, [, y]) => sum + y, 0) / stroke.length,
  ];

  /*
    Diferença só de forma: os dois traços são centralizados na origem e
    o desenhado é esticado até o tamanho do esperado. O resultado é uma
    fração do comprimento do traço (0.1 = 10%), então vale igual para
    letra grande ou pequena.
  */
  function shapeGap(user, expected, userLength, expectedLength) {
    const [ux, uy] = center(user);
    const [ex, ey] = center(expected);
    const k = expectedLength / userLength;
    let sum = 0;
    for (let i = 0; i < user.length; i++) {
      sum += gap(
        [(user[i][0] - ux) * k, (user[i][1] - uy) * k],
        [expected[i][0] - ex, expected[i][1] - ey],
      );
    }
    return sum / user.length / expectedLength;
  }

  /*
    Compara um traço desenhado com um esperado (os dois já reamostrados).
    Duas formas de acertar:
    1. perto do esperado, ponto a ponto (distância média < LIMIT);
    2. mesma forma (shapeGap < SHAPE_LIMIT), num tamanho parecido e
       sem fugir muito do lugar — cobre quem escreve o kana inteiro
       menor ou maior que a referência.
    Traços curtos (pontinhos, o ゛) só valem pela regra 1 — com limite
    DRIFT em vez de LIMIT quando "loose" (1º traço, veja checkStroke): neles a
    "forma" é quase só tremor da mão.
    Como os pontos são comparados na ordem, o sentido conta: um traço
    feito de trás para frente fica longe do esperado, mas perto dele
    invertido — é assim que se reconhece o erro de direção.
  */
  function matchStroke(user, expected, loose = false) {
    const fits = (target) => {
      const dist = meanGap(user, target);
      const userLength = length(user);
      const expectedLength = length(target);
      const short = expectedLength < SHORT;
      if (dist < (loose && short ? DRIFT : LIMIT)) return { ok: true, dist };
      if (short || userLength < SHORT / 2) return { ok: false, dist };
      const ratio = userLength / expectedLength;
      const ok =
        ratio > 0.5 &&
        ratio < 2 &&
        gap(center(user), center(target)) < DRIFT &&
        shapeGap(user, target, userLength, expectedLength) < SHAPE_LIMIT;
      return { ok, dist };
    };
    const forward = fits(expected);
    return {
      ok: forward.ok,
      dist: forward.dist,
      reversed: !forward.ok && fits(expected.toReversed()).ok,
    };
  }

  /*
    Os traços esperados de um texto já reamostrados. Nos combinados
    (きゃ) o 2º kana fica na célula da direita: soma 109 no x.
  */
  function expectedStrokes(text, table) {
    return [...text].flatMap((char, cell) =>
      table[char].map(([d]) =>
        resample(pathPoints(d).map(([x, y]) => [x + cell * BOX, y])),
      ),
    );
  }

  /*
    Cada pessoa escreve o kana num lugar e num tamanho um pouco
    diferentes da referência — e tudo bem: o que importa é a posição de
    um traço em relação aos outros. Com os traços já aceitos dá para
    medir esse "jeito da mão" (deslocamento + escala) e desfazê-lo
    antes de comparar o próximo traço. Sem traços aceitos, nada muda.
  */
  function fitHand(accepted, expected) {
    if (!accepted.length) return (p) => p;
    const user = accepted.flatMap((a) => resample(a.points));
    const target = accepted.flatMap((a) => expected[a.index]);
    const [ux, uy] = center(user);
    const [tx, ty] = center(target);
    // Espalhamento: distância média dos pontos até o centro.
    const spread = (pts, cx, cy) =>
      pts.reduce((sum, [x, y]) => sum + Math.hypot(x - cx, y - cy), 0) /
      pts.length;
    const userSpread = spread(user, ux, uy);
    const targetSpread = spread(target, tx, ty);
    // Só um pontinho aceito não diz nada sobre o tamanho: só desloca.
    let k = targetSpread < 8 || !userSpread ? 1 : targetSpread / userSpread;
    k = Math.min(1.6, Math.max(0.6, k));
    return ([x, y]) => [(x - ux) * k + tx, (y - uy) * k + ty];
  }

  /*
    Confere o traço de número "index" (0 = primeiro). Resultados:
    - "ok": bate com o esperado;
    - "order": não é este, mas bate com outro traço do kana — a forma
      está certa, a ordem não;
    - "direction": é este traço, mas feito ao contrário;
    - "shape": não bate com nenhum.
    "accepted" lista os traços já aceitos, { points, index }: eles
    calibram a mão (fitHand) e saem da disputa pela ordem.
  */
  function checkStroke(points, expected, index, accepted = []) {
    const user = resample(points).map(fitHand(accepted, expected));
    /*
      O 1º traço ainda não tem calibração da mão: se a letra inteira
      estiver deslocada, ele chega mais longe do esperado. Traços curtos
      (os pontinhos de シ) só valem pela distância, então ganham a mesma
      folga da regra da forma (DRIFT) enquanto nada foi aceito.
    */
    const loose = !accepted.length;
    const done = accepted.map((a) => a.index);
    /*
      Entre os traços que ainda faltam e que "batem", vale o mais perto.
      Sem isso, num kana com traços parecidos (as duas retas de き), o
      2º traço feito primeiro passaria como se fosse o 1º.
    */
    let best = null;
    expected.forEach((stroke, j) => {
      if (j !== index && done.includes(j)) return;
      const match = matchStroke(user, stroke, loose);
      if (match.ok && (!best || match.dist < best.dist)) {
        best = { ...match, j };
      }
    });
    const match = matchStroke(user, expected[index], loose);
    /*
      Empate técnico (os dois risquinhos do ゛ quase se encostam): se o
      traço esperado também bate, só é erro de ordem quando o outro está
      bem mais perto — menos de 60% da distância.
    */
    if (match.ok && (best.j === index || best.dist > match.dist * 0.6)) {
      return { result: "ok", dist: match.dist };
    }
    if (best) return { result: "order", dist: match.dist, other: best.j };
    if (match.reversed) return { result: "direction", dist: match.dist };
    return { result: "shape", dist: match.dist };
  }

  /*
    Confere o kana inteiro de uma vez (modo difícil). Cada traço i é
    comparado com o esperado i, calibrado pelos anteriores que estavam
    certos; sobras e faltas aparecem em "count".
  */
  function checkAll(strokes, expected) {
    const accepted = [];
    const results = strokes.map((points, i) => {
      if (i >= expected.length) return { result: "extra", dist: Infinity };
      const check = checkStroke(points, expected, i, accepted);
      if (check.result === "ok") accepted.push({ points, index: i });
      return check;
    });
    return {
      ok:
        strokes.length === expected.length &&
        results.every((r) => r.result === "ok"),
      count: [strokes.length, expected.length],
      results,
    };
  }

  const Draw = {
    BOX,
    LIMIT,
    pathPoints,
    resample,
    matchStroke,
    expectedStrokes,
    checkStroke,
    checkAll,
  };
  // No navegador vira global (window.Draw); no Node, module.exports.
  if (typeof module === "object" && module.exports) module.exports = Draw;
  else root.Draw = Draw;
})(globalThis);
