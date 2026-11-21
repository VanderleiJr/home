// Diagnóstico de um PDF para o d&d.exe (Node, nunca publicado).
// Uso: node tools/dnd/inspect.js [arquivo.pdf]
// Responde: está criptografado? as páginas têm texto ou são imagens
// escaneadas? as fontes têm ToUnicode (mapa glifo → letra)? Sem isso não
// dá para extrair texto confiável, e a abordagem precisaria mudar.
// Varredura leve por expressões regulares; o leitor completo é o pdf.js.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

// --texto 61,62: em vez do diagnóstico, imprime o texto dessas páginas
// usando o mesmo leitor do site (site/projects/dnd/pdf.js).
const args = process.argv.slice(2);
const textIdx = args.indexOf("--texto");
const textPages =
  textIdx >= 0 ? args.splice(textIdx, 2)[1].split(",").map(Number) : null;
const file = args[0] || path.join(__dirname, "livros", "livro-do-jogador.pdf");

if (textPages) {
  const PDF = require("../../site/projects/dnd/pdf.js");
  (async () => {
    const buf = fs.readFileSync(file);
    const doc = await PDF.open(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length),
    );
    for (const n of textPages) {
      console.log(`\n===== página ${n} de ${doc.pageCount} =====`);
      for (const l of PDF.toLines(await doc.pageItems(n)))
        console.log(
          `[${l.size.toFixed(1)}${l.bold ? "b" : ""} x${Math.round(l.x)}] ${l.text}`,
        );
    }
  })();
  return;
}
const buf = fs.readFileSync(file);
// latin1 mapeia 1 byte → 1 caractere: posições da string = posições no arquivo.
const bin = buf.toString("latin1");

// ---------- Objetos via tabela xref ----------
const startxref = Number(/startxref\s+(\d+)/g.exec(bin.slice(-2048))[1]);
const offsets = new Map();
let pos = startxref;
// Segue a cadeia de /Prev (atualizações incrementais), da mais nova à mais velha.
while (pos != null) {
  const head = bin.slice(pos, pos + 30);
  if (!head.startsWith("xref"))
    throw new Error("xref em stream: não suportado");
  let cursor = pos + 4;
  const re = /\s*(\d+) (\d+)\s*\n?|trailer/y;
  for (;;) {
    re.lastIndex = cursor;
    const m = re.exec(bin);
    if (!m || m[0].includes("trailer")) break;
    const [first, count] = [Number(m[1]), Number(m[2])];
    let entry = re.lastIndex;
    for (let i = 0; i < count; i++, entry += 20) {
      const [off, , type] = bin.slice(entry, entry + 18).split(" ");
      if (type === "n" && !offsets.has(first + i))
        offsets.set(first + i, Number(off));
    }
    cursor = entry;
  }
  const trailer = bin.slice(cursor, cursor + 600);
  const prev = /\/Prev\s+(\d+)/.exec(trailer);
  pos = prev ? Number(prev[1]) : null;
  if (!offsets.trailer) offsets.trailer = trailer;
}

function object(num) {
  const off = offsets.get(num);
  const end = bin.indexOf("endobj", off);
  const text = bin.slice(off, end);
  const dictEnd = text.indexOf("stream");
  const dict = dictEnd < 0 ? text : text.slice(0, dictEnd);
  let data = null;
  if (dictEnd >= 0) {
    let start = off + dictEnd + 6;
    if (bin[start] === "\r") start++;
    if (bin[start] === "\n") start++;
    const len = /\/Length (\d+)(?!\d| \d+ R)/.exec(dict);
    const stop = len ? start + Number(len[1]) : bin.indexOf("endstream", start);
    data = buf.subarray(start, stop);
    if (/\/FlateDecode/.test(dict)) {
      try {
        data = zlib.inflateSync(data);
      } catch {
        data = null;
      }
    }
  }
  return { dict, data };
}

const refs = (s, key) =>
  [...s.matchAll(new RegExp(`/${key}\\s+(\\d+) 0 R`, "g"))].map((m) =>
    Number(m[1]),
  );

// ---------- Panorama ----------
const report = {
  arquivo: path.basename(file),
  tamanhoMB: +(buf.length / 1e6).toFixed(1),
  sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  versao: bin.slice(5, 8),
  objetos: offsets.size,
  criptografado: /\/Encrypt/.test(offsets.trailer),
  info: {},
  paginas: 0,
  filtros: {},
};
const info = refs(offsets.trailer, "Info")[0];
if (info) {
  for (const m of object(info).dict.matchAll(/\/(\w+)\s*\(([^)]*)\)/g))
    report.info[m[1]] = m[2];
}

const fonts = new Map(); // num → { nome, subtipo, toUnicode, paginas }
const pages = [];
for (const [num] of offsets) {
  const { dict } = object(num);
  for (const f of dict.matchAll(/\/Filter\s*\/(\w+)/g))
    report.filtros[f[1]] = (report.filtros[f[1]] || 0) + 1;
  if (/\/Type\s*\/Page(?!s)/.test(dict)) pages.push(num);
  if (/\/Type\s*\/Font(?!\w)/.test(dict)) {
    fonts.set(num, {
      nome: (/\/BaseFont\s*\/([^\s/]+)/.exec(dict) || [])[1],
      subtipo: (/\/Subtype\s*\/(\w+)/.exec(dict) || [])[1],
      // Como transformar os códigos dos glifos em letras, do melhor ao pior:
      // ToUnicode (mapa explícito) > Encoding padrão > Differences (nomes de
      // glifos, como "Asmall") > descendente CID (o mapa fica na fonte-mãe).
      decodificacao: /\/ToUnicode/.test(dict)
        ? "ToUnicode"
        : /\/Encoding\s*\/(\w+)/.test(dict)
          ? RegExp.$1
          : /\/Encoding\s+\d+ 0 R/.test(dict)
            ? "Differences"
            : /CIDFontType/.test(dict)
              ? "CID (via Type0)"
              : "nenhuma",
      paginas: 0,
    });
  }
}
report.paginas = pages.length;

// ---------- Por página: quanto texto e quantas imagens ----------
// Resources podem estar inline na página ou num objeto referenciado.
function resources(pageDict) {
  const ref = /\/Resources\s+(\d+) 0 R/.exec(pageDict);
  return ref ? object(Number(ref[1])).dict : pageDict;
}
// Os números de página do arquivo seguem a ordem da árvore /Pages, não a dos objetos.
function pageOrder() {
  const root = object(refs(offsets.trailer, "Root")[0]).dict;
  const order = [];
  (function walk(num) {
    const { dict } = object(num);
    if (/\/Type\s*\/Pages/.test(dict)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(dict)[1];
      for (const k of kids.matchAll(/(\d+) 0 R/g)) walk(Number(k[1]));
    } else order.push(num);
  })(refs(root, "Pages")[0]);
  return order;
}

const perPage = [];
for (const num of pageOrder()) {
  const { dict } = object(num);
  const res = resources(dict);
  let ops = 0;
  let imgs = 0;
  const contents = /\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/.exec(dict);
  const parts = contents
    ? [...contents[1].matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]))
    : [];
  for (const c of parts) {
    const data = object(c).data;
    if (!data) continue;
    const s = data.toString("latin1");
    ops += (s.match(/\bT[Jj]\b/g) || []).length;
    imgs += (s.match(/\bDo\b/g) || []).length;
  }
  const fontDict = /\/Font\s*(<<[^>]*>>|\d+ 0 R)/.exec(res);
  if (fontDict) {
    const body = fontDict[1].startsWith("<<")
      ? fontDict[1]
      : object(Number(fontDict[1].split(" ")[0])).dict;
    for (const m of body.matchAll(/(\d+) 0 R/g)) {
      const f = fonts.get(Number(m[1]));
      if (f) f.paginas++;
    }
  }
  perPage.push({ ops, imgs });
}

const semTexto = perPage
  .map((p, i) => (p.ops === 0 ? i + 1 : null))
  .filter(Boolean);
report.paginasSemTexto = semTexto.length;
report.amostraSemTexto = semTexto.slice(0, 30);
report.operadoresTextoTotal = perPage.reduce((a, p) => a + p.ops, 0);
report.fontes = {
  total: fonts.size,
  porSubtipo: [...fonts.values()].reduce(
    (a, f) => ((a[f.subtipo] = (a[f.subtipo] || 0) + 1), a),
    {},
  ),
  porDecodificacao: [...fonts.values()].reduce(
    (a, f) => ((a[f.decodificacao] = (a[f.decodificacao] || 0) + 1), a),
    {},
  ),
  familias: [
    ...new Set([...fonts.values()].map((f) => f.nome?.replace(/^\w{6}\+/, ""))),
  ],
};

console.log(JSON.stringify(report, null, 2));
