/*
  extract.js — ferramentas genéricas para transformar o texto de um
  livro (vindo do pdf.js) em dados. Nada aqui conhece um livro em
  particular: cada livro é uma "fonte" (sources/<id>.js) que se registra
  com DND.registerSource e usa estas ferramentas com as suas regras.

  Assim, uma expansão nova é só mais um arquivo em sources/, sem mexer
  no motor nem na interface.

  Funciona no navegador (global DND) e no Node (tools/dnd/check.js).
*/
(function (root) {
  "use strict";

  const DND = (root.DND = root.DND || {});
  DND.sources = DND.sources || [];

  // Cada fonte declara: id, nome, sha256 (lista de versões aceitas do
  // PDF) e extract(book) → dados no formato comum do d&d.exe.
  DND.registerSource = (source) => DND.sources.push(source);
  DND.identify = (hash) => DND.sources.find((s) => s.sha256.includes(hash));

  // Normaliza para comparar títulos: sem acento, sem pontuação, minúsculo.
  // normalize("NFD") separa "é" em "e" + acento, e o regex tira o acento.
  DND.norm = (s) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase();

  // "Estilo" de uma linha: fonte + tamanho. É o que diferencia um título
  // de capítulo de um parágrafo, já que o PDF não tem tags de estrutura.
  DND.style = (line) => `${line.font}@${line.size}`;

  /*
    Lê todas as páginas em linhas. Cada linha ganha a página e um índice
    global (ordem de leitura do livro inteiro), útil para recortar o
    texto entre dois títulos. onProgress(feitas, total) alimenta a barra.
  */
  DND.readBook = async (doc, onProgress) => {
    const pages = [];
    const lines = [];
    for (let n = 1; n <= doc.pageCount; n++) {
      const pageLines = root.PDF.toLines(await doc.pageItems(n));
      for (const l of pageLines) {
        l.page = n;
        l.index = lines.length;
        lines.push(l);
      }
      pages.push({ n, lines: pageLines });
      if (onProgress && n % 10 === 0) {
        onProgress(n, doc.pageCount);
        // Devolve a vez ao navegador para a barra de progresso redesenhar.
        await new Promise((r) => setTimeout(r));
      }
    }
    return { pages, lines };
  };

  /*
    Monta o mapa (outline) do livro a partir dos estilos de título.
    headings: [{ level, test(line) }] — o primeiro teste que bater decide
    o nível. skip(line): linhas a ignorar (cabeçalhos de página etc.).
    Títulos que quebram em várias linhas ("Características de" / "Classe
    de Paladino") são unidos quando vêm em sequência, no mesmo estilo.
  */
  DND.outline = (book, { headings, skip = () => false }) => {
    const found = [];
    let prev = null;
    for (const line of book.lines) {
      if (skip(line)) continue;
      const rule = headings.find((h) => h.test(line));
      if (!rule) {
        prev = null;
        continue;
      }
      const continues =
        prev &&
        prev.level === rule.level &&
        prev.style === DND.style(line) &&
        prev.page === line.page &&
        line.y - prev.lastY > 0 &&
        line.y - prev.lastY < line.size * 1.6;
      if (continues) {
        // Mesmo texto repetido (sombra/contorno desenhado duas vezes): ignora.
        if (line.text !== prev.lines[prev.lines.length - 1]) {
          prev.title += " " + line.text;
          prev.lines.push(line.text);
        }
        prev.lastY = line.y;
        continue;
      }
      // Título repetido logo em seguida (sombra desenhada duas vezes, ou
      // título que atravessa a página dupla): fica só o primeiro.
      const repeated = found.some(
        (h) =>
          h.title === line.text &&
          h.level === rule.level &&
          line.page - h.page <= 1,
      );
      if (repeated) {
        prev = null;
        continue;
      }
      prev = {
        level: rule.level,
        title: line.text,
        page: line.page,
        index: line.index,
        style: DND.style(line),
        lastY: line.y,
        lines: [line.text],
      };
      found.push(prev);
    }

    /*
      O título de capítulo nem sempre é desenhado primeiro na página (o
      stream segue a ordem das camadas do diagramador). Ele é puxado para
      o começo da sua página, antes das seções que dividem a página com ele.
    */
    for (const h of found) {
      if (h.level === 0)
        h.index = Math.min(h.index, book.pages[h.page - 1].lines[0].index);
    }
    found.sort((a, b) => a.index - b.index || a.level - b.level);

    // Árvore: cada título "adota" os seguintes de nível maior, e o seu
    // conteúdo vai até o próximo título de nível igual ou menor.
    const rootNode = { level: -1, title: "", children: [], index: 0 };
    const stack = [rootNode];
    for (const h of found) {
      while (stack[stack.length - 1].level >= h.level) stack.pop();
      const node = { ...h, children: [] };
      delete node.lines;
      delete node.lastY;
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    const close = (node, end) => {
      node.end = end;
      node.children.forEach((c, i) =>
        close(
          c,
          i + 1 < node.children.length ? node.children[i + 1].index : end,
        ),
      );
    };
    close(rootNode, book.lines.length);
    return rootNode;
  };

  // Procura, em profundidade, o primeiro nó cujo título bate.
  DND.find = (node, test) => {
    for (const c of node.children || []) {
      if (test(c)) return c;
      const deep = DND.find(c, test);
      if (deep) return deep;
    }
    return null;
  };

  // Linhas do corpo de uma seção (entre o título e o primeiro filho).
  DND.body = (book, node, { skip = () => false, own = true } = {}) => {
    const end = own && node.children.length ? node.children[0].index : node.end;
    return book.lines.slice(node.index + 1, end).filter((l) => !skip(l));
  };

  /*
    Junta linhas em parágrafos. Uma linha nova é parágrafo novo quando
    tem recuo (x maior que o da margem da coluna) ou começa com "•".
    Palavra partida no fim da linha ("me-" + "tros") é colada de volta;
    hífen de palavra composta ("usá-la") fica, pois não está no fim.
  */
  DND.paragraphs = (lines) => {
    const out = [];
    let cur = null;
    let margin = null;
    for (const l of lines) {
      // A margem é o menor x visto na coluna atual (as colunas mudam o x).
      if (margin === null || Math.abs(l.x - margin) > 60) margin = l.x;
      if (l.x < margin) margin = l.x;
      const indent = l.x - margin > 4;
      const bullet = /^[•●▪]/.test(l.text);
      if (!cur || indent || bullet) {
        cur = { text: l.text, lines: [l] };
        out.push(cur);
        continue;
      }
      cur.lines.push(l);
      if (/[a-zà-ú]-$/.test(cur.text) && /^[a-zà-ú]/.test(l.text))
        cur.text = cur.text.slice(0, -1) + l.text;
      else cur.text += " " + l.text;
    }
    return out;
  };

  // Lê o sumário: linhas "Título ........ 42". O recuo diz o nível.
  DND.parseToc = (book, pages) => {
    const entries = [];
    for (const n of pages) {
      for (const l of book.pages[n - 1].lines) {
        const m = /^(.+?)\s*\.{3,}\s*(\d+)$/.exec(l.text);
        if (m)
          entries.push({
            title: m[1].trim(),
            printed: Number(m[2]),
            x: l.x,
            page: n,
          });
      }
    }
    // Recuo relativo à coluna: a menor margem de cada coluna é o nível 0.
    const cols = [...new Set(entries.map((e) => Math.round(e.x / 150)))];
    for (const c of cols) {
      const inCol = entries.filter((e) => Math.round(e.x / 150) === c);
      const min = Math.min(...inCol.map((e) => e.x));
      for (const e of inCol) e.level = e.x - min > 4 ? 1 : 0;
    }
    return entries;
  };

  if (typeof module === "object" && module.exports) module.exports = DND;
})(globalThis);
