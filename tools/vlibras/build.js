/*
  build.js: gera a tabela de sinais do libras.exe a partir do VLibras.

  uso: node tools/vlibras/build.js   (ou: npm run vlibras)
  precisa: Node 18+ (fetch) e o comando "xz" (descompacta o LZMA do Unity).

  Passos, para cada letra e número:
  1. baixa o pacote do dicionário público do VLibras (o mesmo que o
     VLibras Desktop usa) e guarda em tools/vlibras/.cache;
  2. lê o AnimationClip de dentro dele (unityfs.js);
  3. calcula a posição dos ossos quadro a quadro (fk.js);
  4. converte para a pose do avatar (pose.js) e reescreve o bloco
     SIGN_TABLE de site/projects/libras/signs.js.
*/
const fs = require("fs");
const path = require("path");
const { clipFromBundle } = require("./unityfs.js");
const { framesFromClip } = require("./fk.js");
const { poseAt, holdFrame } = require("./pose.js");

const URL = "https://dicionario2.vlibras.gov.br/2018.3.1/LINUX/";
const CACHE = path.join(__dirname, ".cache");
const SIGNS = path.join(__dirname, "../../site/projects/libras/signs.js");
const ORDER =
  "A B C D E F G H I J K L M N O P Q R S T U V W X Y Z Ç 0 1 2 3 4 5 6 7 8 9".split(
    " ",
  );

/*
  Trecho do gesto em cada clipe com movimento (quadros a 30/s). Todo clipe
  sobe a mão do repouso, faz o sinal e desce; estes intervalos foram
  medidos olhando a velocidade da mão quadro a quadro.
*/
const WINDOWS = {
  H: [16, 44],
  J: [20, 38],
  K: [19, 29],
  X: [19, 33],
  Y: [19, 29],
  Z: [19, 38],
  Ç: [20, 35],
};
// Dedo cuja ponta deixa o rastro (0 = indicador … 3 = mínimo).
const TIP = { H: 0, J: 3, K: 1, X: 0, Y: 3, Z: 0, Ç: 0 };

async function bundle(sign) {
  const file = path.join(CACHE, sign);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const res = await fetch(URL + encodeURIComponent(sign));
  if (!res.ok) throw new Error(`${sign}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, data);
  return data;
}

const fmt = (v) => JSON.stringify(v).replace(/,/g, ", ");

function rows(sign, frames) {
  if (!WINDOWS[sign]) {
    const p = poseAt(frames[holdFrame(frames)]);
    return [
      `  ${sign}: pose(${[p.fingers, p.spread, p.thumb, p.q, p.offset, p.arm].map(fmt).join(", ")}),`,
    ];
  }
  const [a, b] = WINDOWS[sign];
  const picks = [];
  for (let i = a; i <= b; i += 2) picks.push(i); // 15 quadros/s bastam
  if (picks.at(-1) !== b) picks.push(b);
  let prevQ = null;
  const keys = picks.map((i, n) => {
    const p = poseAt(frames[i]);
    // q e -q são a mesma rotação: fica no hemisfério do quadro anterior
    // para a interpolação não dar a volta longa.
    if (prevQ && p.q.reduce((s, v, c) => s + v * prevQ[c], 0) < 0)
      p.q = p.q.map((v) => -v);
    prevQ = p.q;
    const t = +(n / (picks.length - 1)).toFixed(3);
    return `    ${fmt([t, p.offset, p.q, p.arm, p.fingers, p.spread, p.thumb])},`;
  });
  const duration = Math.round(((b - a) / 30) * 1000);
  return [`  ${sign}: moving(${TIP[sign]}, ${duration}, [`, ...keys, "  ]),"];
}

(async () => {
  const lines = [];
  for (const sign of ORDER) {
    const frames = framesFromClip(clipFromBundle(await bundle(sign)));
    lines.push(...rows(sign, frames));
  }
  const src = fs.readFileSync(SIGNS, "utf8");
  const start =
    src.indexOf("const SIGN_TABLE = {\n") + "const SIGN_TABLE = {\n".length;
  const end = src.indexOf("};\n\nAvatar.define");
  if (start < 21 || end < 0)
    throw new Error("bloco SIGN_TABLE não encontrado em signs.js");
  fs.writeFileSync(
    SIGNS,
    src.slice(0, start) + lines.join("\n") + "\n" + src.slice(end),
  );
  console.log(`signs.js: ${ORDER.length} sinais gerados.`);
})();
