/*
  build.js: gera os traços de referência do modo desenho do kana.exe.

  uso: node tools/kanjivg/build.js   (ou: npm run kanjivg)
  precisa: Node 18+ (fetch).

  Fonte: KanjiVG (https://kanjivg.tagaini.net), de Ulrich Apel, licença
  CC BY-SA 3.0. Cada caractere é um SVG numa caixa de 109×109 em que
  cada traço é um <path id="kvg:XXXXX-sN">, já na ordem correta de escrita.

  Passos:
  1. baixa o SVG de cada hiragana e katakana (inclusive os pequenos, como
     ゃ e ッ) e guarda em tools/kanjivg/.cache;
  2. tira o atributo "d" de cada traço, na ordem do número "-sN", e a
     posição do número que o KanjiVG desenha ao lado de cada traço
     (<text transform="matrix(1 0 0 1 X Y)">N) — escolhida à mão para
     não encavalar com os traços;
  3. reescreve o bloco STROKES de site/projects/kana/strokes.js.
*/
const fs = require("fs");
const path = require("path");

const URL = "https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/";
const CACHE = path.join(__dirname, ".cache");
const OUT = path.join(__dirname, "../../site/projects/kana/strokes.js");

// Blocos Unicode: hiragana ぁ (3041) a ゖ (3096), katakana ァ (30A1) a ヺ (30FA).
const RANGES = [
  [0x3041, 0x3096],
  [0x30a1, 0x30fa],
];
// Os que o jogo não usa (formas arcaicas ou raras) ficam de fora.
const SKIP = new Set("ゐゑゔゕゖヰヱヴヵヶヷヸヹヺ");

const hex = (code) => code.toString(16).padStart(5, "0");

async function svg(code) {
  const file = path.join(CACHE, `${hex(code)}.svg`);
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const res = await fetch(`${URL}${hex(code)}.svg`);
  if (!res.ok) throw new Error(`${hex(code)}: HTTP ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, text);
  return text;
}

function strokes(text) {
  const paths = [
    ...text.matchAll(/<path id="kvg:\w+-s(\d+)"[^>]*? d="([^"]+)"/g),
  ].sort((a, b) => a[1] - b[1]);
  const numbers = new Map(
    [...text.matchAll(/matrix\(1 0 0 1 ([\d.]+) ([\d.]+)\)">(\d+)</g)].map(
      (m) => [m[3], [Number(m[1]), Number(m[2])]],
    ),
  );
  return paths.map(([, n, d]) => {
    if (!numbers.has(n)) throw new Error(`traço ${n} sem número`);
    return [d, ...numbers.get(n)];
  });
}

(async () => {
  const lines = [];
  let count = 0;
  for (const [first, last] of RANGES) {
    for (let code = first; code <= last; code++) {
      const char = String.fromCodePoint(code);
      if (SKIP.has(char)) continue;
      const list = strokes(await svg(code));
      if (!list.length) throw new Error(`${char}: nenhum traço no SVG`);
      count++;
      // Mesmo formato que o Prettier daria, para o arquivo já sair formatado.
      lines.push(`    ${char}: [`);
      for (const [d, x, y] of list) {
        // Cabe em 80 colunas? Uma linha só; senão, um valor por linha.
        const line = `      ["${d}", ${x}, ${y}],`;
        if (line.length <= 80) lines.push(line);
        else
          lines.push(
            "      [",
            `        "${d}",`,
            `        ${x},`,
            `        ${y},`,
            "      ],",
          );
      }
      lines.push("    ],");
    }
  }

  // Troca só o conteúdo entre "const STROKES = {" e o "};" que o fecha.
  const src = fs.readFileSync(OUT, "utf8");
  const block = /const STROKES = \{[^]*?\};/;
  if (!block.test(src))
    throw new Error("bloco STROKES não encontrado em strokes.js");
  const body = `const STROKES = {\n${lines.join("\n")}\n  };`;
  fs.writeFileSync(
    OUT,
    src.replace(block, () => body),
  );
  console.log(`strokes.js: ${count} kana gerados.`);
})();
