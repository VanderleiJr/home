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
    Ordem de leitura de uma página em duas colunas. O stream do PDF segue
    as camadas do diagramador, que nem sempre é a ordem de leitura. Então
    ordenamos pela geometria: linhas que atravessam o meio da página
    (títulos, tabelas largas) cortam a página em faixas; dentro de cada
    faixa, lê-se a coluna esquerda de cima para baixo e depois a direita.
  */
  DND.readingOrder = (lines, width = 612) => {
    const mid = width / 2;
    const wide = (l) => l.x < mid - 10 && l.end > mid + 10;
    const cuts = lines.filter(wide).map((l) => l.y);
    const band = (l) =>
      cuts.filter((y) => y < l.y).length * 2 + (wide(l) ? 1 : 0);
    // Coluna direita começa um pouco antes do meio (x≈303 em 612): folga de 20.
    const key = (l) => [
      band(l),
      wide(l) ? 0 : l.x < mid - 20 ? 0 : 1,
      l.y,
      l.x,
    ];
    return lines
      .map((l) => ({ l, k: key(l) }))
      .sort((a, b) => {
        for (let i = 0; i < 4; i++)
          if (a.k[i] !== b.k[i]) return a.k[i] - b.k[i];
        return 0;
      })
      .map((e) => e.l);
  };

  /*
    Lê todas as páginas em linhas. Cada linha ganha a página e um índice
    global (ordem de leitura do livro inteiro), útil para recortar o
    texto entre dois títulos. onProgress(feitas, total) alimenta a barra.
  */
  DND.readBook = async (doc, onProgress) => {
    const pages = [];
    const lines = [];
    for (let n = 1; n <= doc.pageCount; n++) {
      const items = await doc.pageItems(n);
      const pageLines = DND.readingOrder(root.PDF.toLines(items), items.width);
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

  // Cola duas linhas de texto: palavra partida no fim da linha ("me-" +
  // "tros") volta a ser uma só; hífen de palavra composta ("usá-la") fica,
  // porque não está no fim da linha.
  DND.join = (a, b) => {
    if (!a) return b;
    if (/[a-zà-öø-ÿ]-$/i.test(a) && /^[a-zà-öø-ÿ]/.test(b))
      return a.slice(0, -1) + b;
    return a + " " + b;
  };

  /*
    Junta linhas em parágrafos. Parágrafo novo quando a linha tem recuo
    em relação à margem da sua coluna ou começa com "•". A margem de cada
    coluna (esquerda/direita da página) é o menor x visto nela; dentro de
    um item com "•", a linha recuada é só a continuação do item.
    Cada parágrafo diz se começa com um rótulo em negrito ("Duração.").
  */
  DND.paragraphs = (lines) => {
    const margins = new Map();
    const col = (l) => `${l.page}:${l.x < 286 ? 0 : 1}`;
    for (const l of lines)
      margins.set(col(l), Math.min(margins.get(col(l)) ?? Infinity, l.x));
    const out = [];
    let cur = null;
    let lastCol = null;
    let prevX = null;
    for (const l of lines) {
      const offset = l.x - margins.get(col(l));
      // Recuo grande repetido em linhas seguidas não é parágrafo novo: é o
      // texto contornando uma letra capitular.
      const wrap = offset > 16 && Math.abs(l.x - prevX) < 1;
      prevX = l.x;
      const indent = offset > 4 && !wrap;
      const bullet = /^[•●▪]/.test(l.text);
      const newCol = col(l) !== lastCol;
      lastCol = col(l);
      if (!cur || bullet || (indent && !(cur.bullet && !newCol))) {
        cur = { text: bullet ? l.text.replace(/^[•●▪]\s*/, "") : l.text };
        if (bullet) cur.bullet = true;
        // Rótulo: os primeiros pedaços em negrito da linha ("Duração.").
        const lead = [];
        for (const it of l.items || []) {
          if (!it.bold) break;
          lead.push(it.str);
        }
        const leadText = lead
          .join("")
          .trim()
          .replace(/^[•●▪]\s*/, "");
        // O texto fica sem o rótulo: quem exibe decide como destacá-lo.
        if (
          leadText &&
          cur.text.startsWith(leadText) &&
          leadText.length < cur.text.length
        ) {
          cur.lead = leadText;
          cur.text = cur.text.slice(leadText.length).trim();
        }
        out.push(cur);
        continue;
      }
      cur.text = DND.join(cur.text, l.text);
    }
    return out;
  };

  /*
    Tabela: a partir da linha de título, lê o cabeçalho (linhas em
    negrito) e as linhas de dados abaixo, na fonte das tabelas (opção
    font). As colunas saem dos dados e os nomes, do cabeçalho; cada
    célula vai para a coluna sob ela. Duas armadilhas tratadas:
    - célula que quebra em duas linhas: a linha sem a 1ª coluna é
      continuação da anterior;
    - "— — —" grudados atravessando colunas: viram uma célula por coluna.
    As linhas usadas ficam marcadas (inTable) para não irem para o texto.
  */
  DND.table = (book, title, { font, maxGap = 2.6 } = {}) => {
    const center = (it) => it.x + it.w / 2;
    const all = book.pages[title.page - 1].lines.filter(
      (l) =>
        l !== title &&
        l.y > title.y &&
        font.test(l.font) &&
        l.x >= title.x - 20,
    );
    all.sort((a, b) => a.y - b.y);
    // Cabeçalho: linhas em negrito antes da primeira linha comum.
    const header = [];
    let i = 0;
    for (; i < all.length && all[i].bold; i++) {
      if (header.length && all[i].y - header[header.length - 1].y > 30) break;
      header.push(all[i]);
    }
    if (!header.length) return null;
    const hItems = header.flatMap((l) =>
      l.items.map((it) => ({ ...it, y: l.y })),
    );
    const minX = Math.min(...hItems.map((it) => it.x)) - 20;
    const maxX = Math.max(...hItems.map((it) => it.x + it.w)) + 30;

    // Linhas de dados, agrupadas por y (pedaços da mesma altura = mesma linha).
    let lastY = header[header.length - 1].y;
    const used = [...header, title];
    const clusters = [];
    for (; i < all.length; i++) {
      const l = all[i];
      if (l.bold || l.x > maxX || l.x < minX) continue;
      if (l.y - lastY > l.size * maxGap) break;
      lastY = l.y;
      used.push(l);
      const c = clusters.find((c) => Math.abs(c.y - l.y) < 2);
      if (c) c.items.push(...l.items);
      else clusters.push({ y: l.y, items: [...l.items] });
    }
    if (!clusters.length) return null;

    /*
      Colunas: saem dos dados, onde as células vêm sempre bem separadas.
      Pedaços de linhas diferentes que se sobrepõem na horizontal são da
      mesma coluna (união de intervalos). "— — —" grudados ficam de fora,
      porque atravessam várias colunas.
    */
    const dashes = (it) => /^[—–-](\s+[—–-])+$/.test(it.str.trim());
    const cols = [];
    const spans = clusters
      .flatMap((c) => c.items)
      .filter((it) => it.str.trim() && !dashes(it))
      .map((it) => [it.x, it.x + it.w])
      .sort((a, b) => a[0] - b[0]);
    for (const [x1, x2] of spans) {
      const last = cols[cols.length - 1];
      if (last && x1 <= last.x2 + 1) last.x2 = Math.max(last.x2, x2);
      else cols.push({ x1, x2 });
    }
    for (const c of cols) {
      c.center = (c.x1 + c.x2) / 2;
      c.words = [];
    }
    const nearest = (x) =>
      cols.reduce((best, c) =>
        Math.abs(c.center - x) < Math.abs(best.center - x) ? c : best,
      );

    /*
      Nomes das colunas: rótulos que cobrem vários outros abaixo
      ("Espaços de Magia por Círculo" sobre 1…9) são grupo. Os demais são
      partidos em palavras, e cada palavra vai para a coluna sob ela — a
      posição de cada palavra é estimada pela proporção de letras, o que
      separa "Proficiência Características" grudados num pedaço só.
    */
    const isGroup = (a) =>
      hItems.filter(
        (b) => b !== a && b.y > a.y && center(b) > a.x && center(b) < a.x + a.w,
      ).length >= 2;
    const groups = hItems.filter(isGroup);
    for (const it of hItems.filter((h) => !isGroup(h))) {
      const text = it.str;
      let pos = 0;
      for (const word of text.split(/(\s+)/)) {
        const mid = it.x + ((pos + word.length / 2) / text.length) * it.w;
        pos += word.length;
        if (!word.trim()) continue;
        const col =
          cols.find((c) => mid >= c.x1 - 6 && mid <= c.x2 + 6) || nearest(mid);
        col.words.push({ word, y: it.y, x: mid });
      }
    }
    for (const c of cols) {
      const group = groups.find((g) => c.center > g.x && c.center < g.x + g.w);
      const name = c.words
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((w) => w.word)
        .join(" ");
      c.name = group ? `${group.str.trim()} ${name}`.trim() : name;
    }

    // Células: cada pedaço vai para a coluna sob ele; "— — —" é repartido.
    const rows = [];
    for (const cl of clusters.sort((a, b) => a.y - b.y)) {
      const cells = cols.map(() => "");
      for (const it of cl.items.sort((a, b) => a.x - b.x)) {
        const tokens = it.str.trim().split(/\s+/);
        if (dashes(it)) {
          const inside = cols.filter(
            (c) => c.center >= it.x - 2 && c.center <= it.x + it.w + 2,
          );
          if (inside.length === tokens.length) {
            inside.forEach((c, k) => (cells[cols.indexOf(c)] = tokens[k]));
            continue;
          }
        }
        const col =
          cols.find((c) => center(it) >= c.x1 - 2 && center(it) <= c.x2 + 2) ||
          nearest(center(it));
        const k = cols.indexOf(col);
        cells[k] = DND.join(cells[k], it.str.trim());
      }
      // Linha sem a 1ª coluna: continuação da célula de cima.
      if (cells[0] || !rows.length) rows.push(cells);
      else {
        const prev = rows[rows.length - 1];
        cells.forEach((v, k) => v && (prev[k] = DND.join(prev[k], v)));
      }
    }
    for (const l of used) l.inTable = true;
    return {
      title: title.text.replace(/\.$/, ""),
      page: title.page,
      columns: cols.map((c) => c.name),
      rows,
    };
  };

  // Lista "Rótulo valor" (como os Traços Básicos de uma classe): pedaço
  // em negrito abre um campo novo; o resto (e as linhas seguintes sem
  // negrito) é o valor.
  DND.labeled = (lines) => {
    const fields = [];
    for (const l of lines) {
      for (const it of l.items) {
        const s = it.str.trim();
        if (!s) continue;
        if (it.bold) fields.push({ label: s, value: "" });
        else if (fields.length) {
          const f = fields[fields.length - 1];
          f.value = DND.join(f.value, s);
        }
      }
      l.inTable = true;
    }
    return fields;
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
