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
  2. tira só o atributo "d" de cada traço, na ordem do número "-sN";
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
  const found = [
    ...text.matchAll(/<path id="kvg:\w+-s(\d+)"[^>]*? d="([^"]+)"/g),
  ];
  return found.sort((a, b) => a[1] - b[1]).map((m) => m[2]);
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
      // Mesmo formato que o Prettier daria: um traço por linha.
      lines.push(
        `    ${char}: [`,
        ...list.map((d) => `      "${d}",`),
        "    ],",
      );
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
