/*
  check.js: testa o reconhecedor do modo desenho (site/projects/kana/draw.js)
  com os próprios traços do KanjiVG, deformados como uma mão de verdade.

  uso: node tools/kanjivg/check.js   (ou: npm run kana:check)

  Para cada kana:
  - os traços certos, com tremor, deslocamento e escala → "ok";
  - um traço feito ao contrário → "direction";
  - o 2º traço feito no lugar do 1º → "order".
  Os dois últimos têm exceções naturais (um traço quase simétrico, ou
  dois traços quase iguais, como os do ゛), então só a taxa é cobrada.
*/
const STROKES = require("../../site/projects/kana/strokes.js");
const Draw = require("../../site/projects/kana/draw.js");

// Aleatório com semente: o teste dá sempre o mesmo resultado.
let seed = 42;
const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/*
  "Mão humana": o kana inteiro sai um pouco deslocado e maior ou menor
  (o mesmo para todos os traços dele), cada traço escorrega um pouco e
  cada ponto treme.
*/
const sway = () => random() * 2 - 1;
function hand({ shift = 6, scale = 0.15 } = {}) {
  const dx = sway() * shift;
  const dy = sway() * shift;
  const s = 1 + sway() * scale;
  return (points) => {
    const sx = sway() * 1.5;
    const sy = sway() * 1.5;
    return points.map(([x, y]) => [
      54.5 + (x - 54.5) * s + dx + sx + sway() * 1.5,
      54.5 + (y - 54.5) * s + dy + sy + sway() * 1.5,
    ]);
  };
}

const raw = (char) => STROKES[char].map(([d]) => Draw.pathPoints(d));

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log("  ✘", msg);
};
const tally = { direction: [0, 0], order: [0, 0] };
const exceptions = { direction: [], order: [] };

for (const char of Object.keys(STROKES)) {
  const expected = Draw.expectedStrokes(char, STROKES);
  const strokes = raw(char);

  // Certo: cada traço, um por vez, e o kana inteiro.
  const wobble = hand();
  const drawn = strokes.map((s) => wobble(s));
  const accepted = [];
  drawn.forEach((points, i) => {
    const { result, dist } = Draw.checkStroke(points, expected, i, accepted);
    if (result !== "ok")
      fail(`${char} traço ${i + 1}: ${result} (${dist.toFixed(1)})`);
    accepted.push({ points, index: i });
  });
  if (!Draw.checkAll(drawn, expected).ok) fail(`${char}: checkAll falhou`);

  // Direção: o traço mais longo, de trás para frente.
  const longest = strokes.reduce(
    (a, s, i) => (s.length > strokes[a].length ? i : a),
    0,
  );
  const back = wobble(strokes[longest].toReversed());
  tally.direction[1]++;
  if (Draw.checkStroke(back, expected, longest).result === "direction")
    tally.direction[0]++;
  else exceptions.direction.push(char);

  // Ordem: começar pelo 2º traço.
  if (strokes.length > 1) {
    tally.order[1]++;
    if (Draw.checkStroke(wobble(strokes[1]), expected, 0).result === "order")
      tally.order[0]++;
    else exceptions.order.push(char);
  }
}

/*
  Letra pequena e fora do centro (até 35% menor e 12 unidades para o
  lado): a calibração (fitHand) deve aceitar quase tudo, mas o 1º
  traço ainda é julgado sem ela, então só a taxa é cobrada.
*/
let smallOk = 0;
for (const char of Object.keys(STROKES)) {
  const wobble = hand({ shift: 12, scale: 0.35 });
  if (
    Draw.checkAll(
      raw(char).map((s) => wobble(s)),
      Draw.expectedStrokes(char, STROKES),
    ).ok
  )
    smallOk++;
}
const smallRate = smallOk / Object.keys(STROKES).length;
console.log(`letra pequena/deslocada: ${Math.round(smallRate * 100)}%`);
if (smallRate < 0.9) fail("letra pequena/deslocada: taxa abaixo de 90%");

// Combinados: ゃ na célula da direita.
const kya = Draw.expectedStrokes("きゃ", STROKES);
const small = raw("ゃ").map((s) => s.map(([x, y]) => [x + Draw.BOX, y]));
const wobble = hand();
const kyaDrawn = [...raw("き"), ...small].map((s) => wobble(s));
if (!Draw.checkAll(kyaDrawn, kya).ok) fail("きゃ: checkAll falhou");
if (
  Draw.checkAll(
    raw("き").map((s) => wobble(s)),
    kya,
  ).ok
)
  fail("きゃ: aceitou só き");

for (const kind of ["direction", "order"]) {
  const [hit, total] = tally[kind];
  const rate = hit / total;
  console.log(
    `${kind}: ${hit}/${total} (${Math.round(rate * 100)}%)` +
      (exceptions[kind].length
        ? ` — exceções: ${exceptions[kind].join(" ")}`
        : ""),
  );
  if (rate < 0.9) fail(`${kind}: taxa abaixo de 90%`);
}

console.log(failures ? `✘ ${failures} falha(s)` : "✔ reconhecedor ok");
process.exitCode = failures ? 1 : 0;
