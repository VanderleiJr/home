// Confere a extração do d&d.exe contra o PDF local (Node, nunca publicado).
// Uso: npm run dnd:check [-- --mapa] [arquivo.pdf]
// Roda o mesmo código do site (pdf.js, extract.js, sources/*) e imprime
// um relatório: assim dá para afinar o extrator sem abrir o navegador.
// Os números de "esperado" são contagens, não conteúdo do livro.

const fs = require("node:fs");
const path = require("node:path");

const site = path.join(__dirname, "../../site/projects/dnd");
const PDF = require(path.join(site, "pdf.js"));
globalThis.PDF = PDF;
const DND = require(path.join(site, "extract.js"));
for (const f of fs.readdirSync(path.join(site, "sources")))
  require(path.join(site, "sources", f));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file =
  args.find((a) => !a.startsWith("--")) ||
  path.join(__dirname, "livros", "livro-do-jogador.pdf");

let failures = 0;
function expect(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  const started = Date.now();
  const hash = await PDF.sha256(ab);
  const source = DND.identify(hash);
  expect("versão do PDF reconhecida", !!source, source ? source.name : hash);
  if (!source) process.exit(1);

  const doc = await PDF.open(ab);
  const book = await DND.readBook(doc);
  const data = source.extract(book);
  console.log(`⏱  ${doc.pageCount} páginas em ${Date.now() - started} ms\n`);

  // ---------- Mapa do livro × sumário impresso ----------
  const all = [];
  (function walk(n) {
    for (const c of n.children) {
      all.push(c);
      walk(c);
    }
  })(data.outline);

  const chapters = data.outline.children;
  console.log(
    `🗺  Capítulos detectados (deslocamento de página: ${data.offset})`,
  );
  for (const c of chapters) {
    const last = c.end > 0 ? book.lines[c.end - 1].page : c.page;
    console.log(
      `   p.${String(c.page).padStart(3)}–${String(last).padEnd(3)} ${c.title} (${c.children.length} seções)`,
    );
    if (flags.has("--mapa"))
      for (const s of c.children) console.log(`        p.${s.page} ${s.title}`);
  }

  // "Cap. 3: Classes de Personagem" no sumário = "Classes de Personagem" no título.
  const clean = (t) =>
    DND.norm(t.replace(/^(cap\.|capítulo|ap\.|apêndice)\s*\w*\s*:\s*/i, ""));
  const missing = [];
  for (const e of data.toc) {
    const want = clean(e.title);
    const page = e.printed + data.offset;
    const hit = all.find(
      (h) =>
        Math.abs(h.page - page) <= 1 &&
        (DND.norm(h.title) === want || DND.norm(h.title).startsWith(want)),
    );
    if (!hit) missing.push(`${e.title} (p.${e.printed} → PDF ${page})`);
  }
  const found = data.toc.length - missing.length;
  console.log("");
  expect(
    "sumário impresso encontrado no mapa",
    missing.length <= data.toc.length * 0.02,
    `${found}/${data.toc.length} entradas`,
  );
  for (const m of missing) console.log(`   ⚠️  não achei: ${m}`);

  console.log(
    failures ? `\n${failures} verificação(ões) falharam` : "\nTudo certo",
  );
  process.exit(failures ? 1 : 0);
})();
