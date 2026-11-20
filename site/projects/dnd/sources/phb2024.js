/*
  Fonte: Livro do Jogador (D&D 2024), PDF em português.

  Tudo o que é específico deste PDF mora aqui: o hash que identifica a
  versão e os estilos (fonte + tamanho) que o livro usa em cada nível de
  título. Nenhum texto do livro está neste arquivo — só regras de leitura.
  Outro livro = outro arquivo como este, com os seus próprios estilos.
*/
(function (root) {
  "use strict";

  const DND = root.DND;

  // Fontes do diagramador: decoradas para títulos, MrsEaves para seções.
  const is = (font, size) => (l) => l.font === font && l.size === size;
  const TITLE_FONT = "WolpePegasus-Regular";
  const SECTION_FONT = "MrsEavesOT-Roman";

  // Rodapé com "CAPÍTULO 3 | CLASSES DE PERSONAGEM 127" e o número da página.
  const isFooter = (l) =>
    l.font === "MrsEavesOT-Bold" && l.size === 12 && l.y > 730;

  const headings = [
    { level: 0, test: is(TITLE_FONT, 38) }, // capítulo
    { level: 1, test: is(TITLE_FONT, 64) }, // classe (abre o seu capítulo)
    { level: 1, test: is(SECTION_FONT, 18) }, // seção
    { level: 2, test: is(SECTION_FONT, 15) }, // subseção, subclasse
    { level: 3, test: is(SECTION_FONT, 13) }, // verbete do glossário
    { level: 3, test: is(SECTION_FONT, 12.5) }, // característica, magia, talento
    // Algumas características saíram em corpo 12 na diagramação: o
    // padrão "Nível N:" garante que não se percam.
    {
      level: 3,
      test: (l) =>
        l.font === SECTION_FONT &&
        l.size >= 12 &&
        l.size < 13 &&
        /^Nível \d+:/.test(l.text),
    },
  ];

  /*
    Página impressa × página do PDF: o rodapé termina com o número impresso
    ("… 127" na página 133 do PDF). O deslocamento mais comum vale para o
    livro todo e permite usar o sumário impresso para conferir o mapa.
  */
  function pageOffset(book) {
    const votes = new Map();
    for (const l of book.lines) {
      const m = isFooter(l) && /(?:^|\s)(\d{1,3})$/.exec(l.text);
      if (m) {
        const off = l.page - Number(m[1]);
        votes.set(off, (votes.get(off) || 0) + 1);
      }
    }
    return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  }

  // ---------- Classes ----------

  // Ids dos atributos: termos de jogo, não texto do livro. O motor de
  // regras usa os ids; a interface mostra os nomes vindos do livro.
  const ABILITIES = {
    forca: "str",
    destreza: "dex",
    constituicao: "con",
    inteligencia: "int",
    sabedoria: "wis",
    carisma: "cha",
  };
  const abilitiesIn = (text) =>
    DND.norm(text)
      .split(" ")
      .map((w) => ABILITIES[w])
      .filter(Boolean);

  const slug = (s) => DND.norm(s).replace(/ /g, "-");
  const isTableTitle = (l) => l.font === "ScalaSansCaps-Bold" && l.size === 11;
  const TABLE_FONT = /^ScalaSans/;
  // Linhas que nunca são texto corrido: rodapé, créditos de arte (letra
  // miúda), títulos decorativos, frase de efeito e linhas de tabela.
  const isNoise = (l) =>
    l.inTable ||
    isFooter(l) ||
    l.size < 7 ||
    l.font === TITLE_FONT ||
    l.font === "TTJenevers-MediumItalic";

  /*
    Letra capitular: o "G" gigante de "Guerreiros…" vem numa linha
    própria (às vezes desenhado duas vezes, "GG"). Ela é colada de volta
    no começo da linha seguinte e some do texto.
  */
  function fixDropCaps(book) {
    for (const cap of book.lines) {
      if (cap.font !== "TTJenevers-Bold" || cap.size < 30) continue;
      // A primeira linha do parágrafo começa à direita da capitular, na
      // altura do topo dela.
      const next = book.pages[cap.page - 1].lines
        .filter(
          (n) =>
            n.x > cap.x + 5 &&
            n.x < cap.x + 80 &&
            n.y >= cap.y - cap.size &&
            n.y <= cap.y + 2 &&
            n.size < 12,
        )
        .sort((a, b) => a.y - b.y)[0];
      // A capitular às vezes vem desenhada duas vezes: cola só uma.
      if (next && !next.capped) {
        next.text = cap.text[0] + next.text;
        next.capped = true;
      }
      cap.inTable = true; // fora do texto corrido
    }
  }

  const paragraphs = (book, node, own) =>
    DND.paragraphs(DND.body(book, node, { own }).filter((l) => !isNoise(l)));

  // "Escolha 2: Acrobacia, Atletismo … ou Sobrevivência"
  function parseSkills(value) {
    const m = /(\d+)/.exec(value); // "Escolha 2: …" ou "Escolha quaisquer 3 perícias"
    const list = value.includes(":") ? value.slice(value.indexOf(":") + 1) : "";
    const from = list
      .split(/,|\bou\b/)
      .map((s) => s.trim().replace(/\.$/, ""))
      .filter(Boolean);
    return { choose: m ? Number(m[1]) : 0, from, any: from.length === 0 };
  }

  // "Escolha A ou B: (A) …; ou (B) 75 PO" → [{ option: "A", text }, …]
  function parseEquipment(value) {
    const parts = value.split(/\(([A-Z])\)/).slice(1);
    const out = [];
    for (let i = 0; i < parts.length; i += 2)
      out.push({
        option: parts[i],
        text: parts[i + 1]
          .trim()
          .replace(/[;,.]?\s*(ou)?$/, "")
          .trim(),
      });
    return out;
  }

  function parseTraits(fields) {
    const traits = { fields };
    for (const { label, value } of fields) {
      const k = DND.norm(label);
      if (k.startsWith("atributo")) traits.primaryAbility = abilitiesIn(value);
      else if (k.startsWith("dado de ponto"))
        traits.hitDie = Number((/D(\d+)/i.exec(value) || [])[1]);
      else if (k.includes("salvaguarda"))
        traits.savingThrows = abilitiesIn(value);
      else if (k.includes("pericia")) traits.skills = parseSkills(value);
      else if (k.includes("armas")) traits.weapons = value;
      else if (k.includes("armadura")) traits.armor = value;
      else if (k.includes("ferramenta")) traits.tools = value;
      else if (k.includes("equipamento"))
        traits.equipment = parseEquipment(value);
    }
    return traits;
  }

  // Tabela de progressão → uma linha por nível. As 3 primeiras colunas
  // são sempre Nível, Bônus de Proficiência e Características; as
  // demais (Fúrias, Truques, espaços de magia…) ficam em "values".
  function progression(table) {
    if (!table) return null;
    return {
      headers: table.columns, // todos os nomes, do jeito que o livro escreve
      columns: table.columns.slice(3),
      rows: table.rows.map((r) => ({
        level: parseInt(r[0], 10),
        proficiency: parseInt(r[1].replace("+", ""), 10),
        features: r[2] === "—" ? [] : r[2].split(/,\s*/).filter(Boolean),
        values: r.slice(3),
      })),
    };
  }

  // Características "Nível N: Nome" (de classe ou de subclasse), com as
  // tabelas que estiverem dentro delas.
  function features(book, node, tables) {
    const out = [];
    const extra = [];
    for (const c of node.children) {
      const m = /^Nível\s+(\d+):\s*(.+)$/.exec(c.title);
      const item = {
        name: m ? m[2] : c.title,
        page: c.page,
        text: paragraphs(book, c, false),
        tables: tables
          .filter((t) => t.index > c.index && t.index < c.end)
          .map((t) => t.table),
      };
      if (m) out.push({ level: Number(m[1]), ...item });
      else extra.push(item);
    }
    return { features: out, sections: extra };
  }

  /*
    Liga cada nome citado na tabela de progressão à seção da
    característica. A tradução nem sempre usa o mesmo nome nos dois
    lugares ("Especialização" na tabela, "Especialista" no título), então
    tenta, em ordem: nome igual; um começa com o outro ("Arcana Mística
    (6º Círculo)"); a seção do mesmo nível que ficou sem par. O título da
    seção é o nome oficial; "aliases" guarda as diferenças encontradas.
  */
  function linkFeatures(cls) {
    if (!cls.progression) return;
    const feats = cls.features;
    const generic = /subclasse|aumento no valor|dadiva epica/;
    const used = new Set();
    cls.aliases = [];
    for (const row of cls.progression.rows) {
      row.refs = [];
      const pending = [];
      for (const name of row.features) {
        const n = DND.norm(name);
        let k = feats.findIndex((f) => DND.norm(f.name) === n);
        if (k < 0)
          k = feats.findIndex(
            (f) =>
              n.startsWith(DND.norm(f.name)) || DND.norm(f.name).startsWith(n),
          );
        if (k < 0)
          k = feats.findIndex(
            (f) =>
              DND.norm(f.name).includes(n.split(" ").pop()) &&
              n.length > 8 &&
              f.level <= row.level,
          );
        if (k >= 0) {
          row.refs.push(k);
          if (feats[k].level === row.level) used.add(k);
        } else if (!generic.test(n)) pending.push(name);
      }
      for (const name of pending) {
        let k = feats.findIndex(
          (f, j) =>
            f.level === row.level && !used.has(j) && !row.refs.includes(j),
        );
        // Menção repetida de uma característica antiga ("Especialização"
        // de novo no nível 9): mesmo radical, nível anterior.
        if (k < 0)
          k = feats.findIndex(
            (f) =>
              f.level < row.level &&
              DND.norm(f.name).slice(0, 8) === DND.norm(name).slice(0, 8),
          );
        else used.add(k);
        if (k >= 0) {
          row.refs.push(k);
          cls.aliases.push({
            table: name,
            feature: feats[k].name,
            level: row.level,
          });
        } else (cls.unlinked ||= []).push(`${row.level}: ${name}`);
      }
    }
  }

  function extractClasses(book, outline) {
    const chapter = outline.children.find(
      (c) => DND.norm(c.title) === "classes de personagem",
    );
    if (!chapter) return [];
    const nodes = chapter.children;
    const classes = [];
    nodes.forEach((node, i) => {
      const subs = nodes[i + 1];
      if (
        !subs ||
        DND.norm(subs.title) !== DND.norm("Subclasses de " + node.title)
      )
        return;
      const range = book.lines.slice(node.index, subs.end);

      // 1) Traços básicos (lista rotulada) e 2) tabelas: marcadas antes,
      // para não vazarem no texto das características.
      const traitsTitle = range.find(
        (l) => isTableTitle(l) && /^Traços Básicos/.test(l.text),
      );
      let traits = {};
      if (traitsTitle) {
        traitsTitle.inTable = true;
        const after = book.lines.slice(traitsTitle.index + 1);
        const end = after.findIndex(
          (l) => !TABLE_FONT.test(l.font) || isTableTitle(l),
        );
        traits = parseTraits(DND.labeled(after.slice(0, end < 0 ? 0 : end)));
      }
      const tables = range
        .filter((l) => isTableTitle(l) && !l.inTable)
        .map((l) => ({
          index: l.index,
          table: DND.table(book, l, { font: TABLE_FONT }),
        }))
        .filter((t) => t.table);
      const main = tables.find(
        (t) =>
          /^Características d[eo]\s/.test(t.table.title) &&
          t.index < subs.index,
      );

      const featNode = node.children.find((c) =>
        /^Características de Classe/.test(c.title),
      );
      const tagline = range.find(
        (l) => l.font === "TTJenevers-MediumItalic" && l.page === node.page,
      );
      classes.push({
        id: slug(node.title),
        name: node.title,
        source: "phb2024",
        page: node.page,
        tagline: tagline?.text,
        description: paragraphs(book, node, true),
        ...traits,
        progression: progression(main?.table),
        ...(featNode
          ? features(
              book,
              featNode,
              tables.filter((t) => t !== main),
            )
          : { features: [] }),
        subclasses: subs.children.map((sub) => {
          const body = DND.body(book, sub, { own: true }).filter(
            (l) => !isNoise(l),
          );
          const tag = body.find((l) => l.italic && l.size < 10);
          return {
            id: slug(sub.title),
            name: sub.title,
            class: slug(node.title),
            source: "phb2024",
            page: sub.page,
            tagline: tag?.text,
            description: DND.paragraphs(body.filter((l) => l !== tag)),
            ...features(book, sub, tables),
          };
        }),
      });
    });
    classes.forEach(linkFeatures);
    return classes;
  }

  DND.registerSource({
    id: "phb2024",
    name: "Livro do Jogador (2024)",
    edition: "2024",
    lang: "pt-BR",
    sha256: [
      "55f530ae733992d95cf6c7a000b86b40a2166e98292347e76db4693941f7236c",
    ],
    tocPages: [9],
    skip: isFooter,

    // As próximas etapas acrescentam origens, talentos, magias e equipamento.
    extract(book) {
      fixDropCaps(book);
      const outline = DND.outline(book, { headings, skip: isFooter });
      return {
        source: this.id,
        offset: pageOffset(book),
        outline,
        toc: DND.parseToc(book, this.tocPages),
        classes: extractClasses(book, outline),
      };
    },
  });
})(globalThis);
