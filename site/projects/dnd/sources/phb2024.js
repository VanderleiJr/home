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

  /*
    Rodapé com "CAPÍTULO 3 | CLASSES DE PERSONAGEM 127" e o número da
    página. Nas páginas ímpares vem em corpo 12, à direita; nas pares,
    em corpo 9, à esquerda. Por isso o texto também identifica o rodapé.
  */
  const isFooter = (l) =>
    l.font === "MrsEavesOT-Bold" &&
    l.y > 730 &&
    (l.size === 12 || /^CAP[IÍ]TULO\s*\d+\s*\|/i.test(l.text));

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
  // miúda), títulos decorativos, frase de efeito, legendas de
  // ilustração (DaiVernon) e linhas de tabela.
  const isNoise = (l) =>
    l.inTable ||
    l.inStat ||
    isFooter(l) ||
    l.size < 7 ||
    l.font === TITLE_FONT ||
    l.font.startsWith("DaiVernon") ||
    l.font === "TTJenevers-MediumItalic";

  /*
    Ficha de criatura (as feras do Senhor das Feras, os espíritos das
    magias de invocação, o apêndice B): título "Fera do Mar" em
    ScalaSansCaps corpo 13 e, abaixo, linhas em ScalaSans (CA, PV,
    "For 14 +2 +2"…, Traços, Ações). Não é parágrafo nem tabela, então
    as linhas são marcadas (inStat) e saem do texto das características.
    A ficha acaba na primeira linha de outra fonte na mesma coluna.
  */
  function markStatBlocks(book) {
    const isTitle = (l) => l.font === "ScalaSansCaps-Bold" && l.size >= 12.5;
    // Colunas numeradas em sequência: página × 2 + lado (0 = esquerda).
    const column = (n) => {
      const page = book.pages[(n >> 1) - 1];
      if (!page) return null;
      const mid = (page.width || 612) / 2;
      return page.lines
        .filter((l) => (l.x < mid - 20 ? 0 : 1) === (n & 1) && !isFooter(l))
        .sort((a, b) => a.y - b.y);
    };
    /*
      Marca as linhas da ficha a partir de "from"; devolve true se a coluna
      acabou ainda dentro dela (a ficha continua na coluna seguinte).
      Legendas de ilustração (DaiVernon) e letras miúdas (MOD/SG, créditos
      de arte) não interrompem a ficha.
    */
    const mark = (lines, from) => {
      for (const l of lines) {
        if (l.y <= from) continue;
        if (l.font.startsWith("DaiVernon") || l.size < 7) continue;
        if (!l.font.startsWith("ScalaSans") || isTitle(l)) return false;
        l.inStat = true;
      }
      return true;
    };
    for (let n = 2; n <= book.pages.length * 2 + 1; n++) {
      for (const title of column(n) || []) {
        if (!isTitle(title)) continue;
        title.inStat = true;
        let next = n;
        let open = mark(column(n), title.y);
        while (open && ++next <= n + 2) open = mark(column(next) || [], 0);
      }
    }
  }

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

  // Formato: "Escolha 2: <perícia>, <perícia> … ou <perícia>"
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
    // Às vezes o "(A)" foi esquecido: "Escolha A ou B: Cota…; ou (B) 110 PO".
    if (!/\(A\)/.test(value) && /\(B\)/.test(value))
      value = value.replace(/^(Escolha[^:]*:)?\s*/, "$1 (A) ");
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

  function parseTraits(raw) {
    // Rótulo quebrado em duas linhas ("Proficiências com" / "Ferramentas"):
    // a segunda metade vem como um campo vazio logo depois.
    const fields = [];
    for (const f of raw) {
      const prev = fields.at(-1);
      if (prev && !f.value && prev.value) prev.label += " " + f.label;
      else fields.push({ ...f });
    }
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

  // Números por extenso que aparecem nas regras ("Você conhece dois truques").
  const WORDS = {
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
    quatro: 4,
    cinco: 5,
  };

  /*
    Conjuração: o atributo sai do parágrafo "Atributo de Conjuração."
    (ou do texto "X é seu atributo de conjuração"). A lista de magias é
    a da própria classe, ou a citada no texto ("lista de magias de
    Mago") quando é uma subclasse que conjura (Cavaleiro Místico).
  */
  function castingIn(items, classIds) {
    for (const f of items)
      for (const p of f.text) {
        const t = `${p.lead || ""} ${p.text}`;
        if (!/atributo de conjuração/i.test(t)) continue;
        const m = /(\S+) é (?:seu|o) atributo de conjuração/i.exec(t);
        const ability = m && abilitiesIn(m[1])[0];
        if (!ability) continue;
        const all = f.text.map((q) => q.text).join(" ");
        const list = /lista de magias de (\S+)/i.exec(all);
        const cantrips = /conhece (\S+) truques/i.exec(all);
        return {
          ability,
          feature: f.name,
          ...(list &&
            classIds.includes(slug(list[1])) && {
              list: slug(list[1]),
            }),
          ...(cantrips &&
            WORDS[DND.norm(cantrips[1])] && {
              cantrips: WORDS[DND.norm(cantrips[1])],
            }),
        };
      }
    return null;
  }

  /*
    Tabela "Nível de X | Magias": magias sempre preparadas de uma
    subclasse. O livro às vezes funde a 1ª linha ao cabeçalho
    ("Nível de Guardião 3" / "Magias Enfeitiçar Pessoa"): ela é refeita.
  */
  function spellTable(t) {
    if (t.columns.length !== 2 || !/^nivel/.test(DND.norm(t.columns[0])))
      return null;
    if (!/magia/.test(DND.norm(t.columns[1]))) return null;
    const rows = [...t.rows];
    const m = /(\d+)$/.exec(t.columns[0]);
    if (m)
      rows.unshift([
        m[1],
        t.columns[1].replace(/^Magias(\s+de\s+\S+\s+\S+)?\s*/, ""),
      ]);
    return {
      title: t.title,
      rows: rows
        .filter((r) => /^\d+/.test(r[0]))
        .map((r) => ({
          level: parseInt(r[0], 10),
          spells: r[1]
            .split(/,\s*/)
            .map((n) => n.trim())
            .filter(Boolean)
            .map((name) => ({
              id: SPELL_ALIASES[slug(name)] || slug(name),
              name,
            })),
        })),
    };
  }

  // Tabela "Nível | Magias Preparadas | Espaços 1…4" de subclasse.
  function casterTable(t) {
    const prep = t.columns.findIndex((c) => /magias preparadas/i.test(c));
    if (prep < 0 || !/^nivel/.test(DND.norm(t.columns[0]))) return null;
    return t.rows.map((r) => ({
      level: parseInt(r[0], 10),
      prepared: parseInt(r[prep], 10) || 0,
      slots: t.columns
        .map((c, k) => [c, r[k]])
        .filter(([c]) => /Círculo de Magia \d$/.test(c))
        .map(([, v]) => parseInt(v, 10) || 0),
    }));
  }

  // Nomes que o livro usa fora do capítulo de magias para a mesma magia.
  const SPELL_ALIASES = { "maos-ardentes": "maos-flamejantes" };

  function spellcasting(cls, _, classes) {
    const ids = classes.map((c) => c.id);
    /*
      "Defesa sem Armadura": CA = 10 + Des + os outros modificadores
      citados no texto (o primeiro é sempre Destreza). Se o texto citar
      "Escudo" junto de "ou empunhando", o escudo anula o benefício.
    */
    const ud = cls.features.find((f) =>
      /^defesa sem armadura/.test(DND.norm(f.name)),
    );
    if (ud) {
      const t = ud.text.map((p) => p.text).join(" ");
      cls.unarmored = {
        abilities: abilitiesIn(t).filter((a) => a !== "dex"),
        shield: !/ou empunhando um escudo/i.test(t),
      };
    }
    const own = castingIn(cls.features, ids);
    if (own) cls.spellcasting = { ...own, list: cls.id };
    for (const sub of cls.subclasses) {
      const tables = sub.features.flatMap((f) => f.tables);
      const sc = castingIn(sub.features, ids);
      const progression = tables.map(casterTable).find(Boolean);
      if (sc && progression)
        sub.spellcasting = { ...sc, list: sc.list || cls.id, progression };
      const lists = tables.map(spellTable).filter(Boolean);
      if (lists.length) sub.spellLists = lists;
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
        optionGroups: node.children
          .filter((c) => /^opcoes de/.test(DND.norm(c.title)))
          .map((g) => ({
            id: slug(g.title.replace(/^Opções de\s+/i, "")),
            name: g.title.replace(/^Opções de\s+/i, ""),
            options: g.children.map((o) => {
              // Pré-requisito: linha(s) em itálico logo abaixo do nome.
              const lines = DND.body(book, o, { own: false }).filter(
                (l) => !isNoise(l),
              );
              let k = 0;
              let pre = "";
              while (k < lines.length && lines[k].italic && !lines[k].bold)
                pre = DND.join(pre, lines[k++].text);
              const text = DND.paragraphs(lines.slice(k));
              const lv = /Nível (\d+)/.exec(pre);
              return {
                id: slug(o.title),
                name: o.title,
                ...(pre && { prerequisite: pre }),
                ...(lv && { level: Number(lv[1]) }),
                repeatable: text.some((p) =>
                  /^repetivel/.test(DND.norm(p.lead || "")),
                ),
                text,
              };
            }),
          })),
      });
    });
    classes.forEach(linkFeatures);
    classes.forEach(spellcasting);
    return classes;
  }

  // ---------- Origens: antecedentes, espécies, idiomas e perícias ----------

  const chapterOf = (outline, title) =>
    outline.children.find((c) => DND.norm(c.title) === DND.norm(title));
  const titleLine = (book, node) => book.lines[node.index];
  // "Talento: Sortudo (veja o capítulo 5)": a remissão não é dado.
  const noRef = (s) => s.replace(/\s*\(veja [^)]*\)/i, "").trim();
  const list = (s) =>
    s
      .split(/,|\be\b/)
      .map((x) => x.trim().replace(/\.$/, ""))
      .filter(Boolean);

  // "Iniciado em Magia (Clérigo)" → { id, name, option: "Clérigo" }.
  function featRef(text) {
    const m = /^(.+?)\s*\(([^)]+)\)$/.exec(noRef(text));
    const name = m ? m[1] : noRef(text);
    return { id: slug(name), name, ...(m && { option: m[2] }) };
  }

  /*
    Antecedentes: cada página traz dois, e cada um ocupa uma faixa da
    página — atributos à esquerda, história à direita, na mesma altura.
    Por isso o recorte é geométrico (do título até o próximo título), não
    pela ordem de leitura, que leria a coluna esquerda inteira primeiro.
  */
  function extractBackgrounds(book, outline) {
    const chapter = chapterOf(outline, "Origens dos Personagens");
    if (!chapter) return [];
    const nodes = chapter.children;
    const start = nodes.findIndex((n) =>
      /^descricoes dos antecedentes/.test(DND.norm(n.title)),
    );
    if (start < 0) return [];
    const out = [];
    for (const node of nodes.slice(start + 1)) {
      if (/^descricoes/.test(DND.norm(node.title))) break;
      const head = titleLine(book, node);
      const page = book.pages[node.page - 1].lines;
      const nextY = Math.min(
        ...page
          .filter(
            (l) => l.font === SECTION_FONT && l.size === 18 && l.y > head.y,
          )
          .map((l) => l.y),
      );
      const band = page.filter(
        (l) => l !== head && l.y > head.y && l.y < nextY && !isNoise(l),
      );
      const fields = DND.labeled(band.filter((l) => TABLE_FONT.test(l.font)));
      const bg = {
        id: slug(node.title),
        name: node.title,
        source: "phb2024",
        page: node.page,
        fields,
        description: DND.paragraphs(band.filter((l) => !l.inTable)),
      };
      for (const { label, value } of fields) {
        const k = DND.norm(label);
        if (k.startsWith("valores de atributo"))
          bg.abilities = abilitiesIn(value);
        else if (k.startsWith("talento")) bg.feat = featRef(value);
        else if (k.includes("pericia")) bg.skills = list(value).map(slug);
        else if (k.includes("ferramenta")) bg.tool = noRef(value);
        else if (k.startsWith("equipamento"))
          bg.equipment = parseEquipment(value);
      }
      out.push(bg);
    }
    return out;
  }

  /*
    Tabela com as colunas repetidas lado a lado para caber na página
    ("Dragão | Tipo de Dano | Dragão | Tipo de Dano"): vira uma só,
    com o dobro de linhas.
  */
  function unfold(table) {
    const n = table.columns.length;
    const half = n / 2;
    if (
      n % 2 ||
      table.columns.slice(0, half).join("|") !==
        table.columns.slice(half).join("|")
    )
      return table;
    const rows = [
      ...table.rows.map((r) => r.slice(0, half)),
      ...table.rows.map((r) => r.slice(half)),
    ].filter((r) => r[0]);
    return { ...table, columns: table.columns.slice(0, half), rows };
  }

  // Linha de tabela → opção: { name, values: { "Nível 3": "…", … } }.
  const optionsOf = (table) =>
    table.rows.map((r) => ({
      name: r[0],
      values: Object.fromEntries(
        table.columns.slice(1).map((c, k) => [c, r[k + 1]]),
      ),
    }));

  const SIZES = /\b(Miúdo|Minúsculo|Pequeno|Médio|Grande)\b/g;

  /*
    Espécie: título com a descrição, filhos com as variantes (Altos
    Elfos, Drow…) e um "Traços de X" com o bloco rotulado (tipo, tamanho,
    deslocamento) e os traços. Rótulo negrito-itálico abre um traço;
    rótulo negrito reto é uma opção dentro do traço anterior (as
    linhagens do Gnomo, as ancestralidades do Golias). Tabelas dentro
    dos traços (Linhagem Élfica…) viram as opções do traço que as cita.
  */
  function extractSpecies(book, outline) {
    const chapter = chapterOf(outline, "Origens dos Personagens");
    const section = chapter?.children.find((n) =>
      /^descricoes das especies/.test(DND.norm(n.title)),
    );
    if (!section) return [];
    return section.children.map((node) => {
      const traitsNode = node.children.find((c) => /^Traços/.test(c.title));
      const range = traitsNode
        ? DND.body(book, traitsNode, { own: false })
        : [];
      const tables = range
        .filter((l) => isTableTitle(l) && !l.inTable)
        .map((l) => DND.table(book, l, { font: TABLE_FONT }))
        .filter(Boolean)
        .map(unfold);
      const lines = range.filter((l) => !isNoise(l));
      const head = lines.filter((l) => TABLE_FONT.test(l.font));
      const fields = DND.labeled(head);
      const sp = {
        id: slug(node.title),
        name: node.title,
        source: "phb2024",
        page: node.page,
        description: paragraphs(book, node, true),
        variants: node.children
          .filter((c) => c !== traitsNode)
          .map((c) => ({
            id: slug(c.title),
            name: c.title,
            description: paragraphs(book, c, false),
          })),
        fields,
        traits: [],
      };
      for (const { label, value } of fields) {
        const k = DND.norm(label);
        if (k.startsWith("tipo")) sp.creatureType = value;
        else if (k.startsWith("tamanho"))
          sp.sizes = [...value.replace(/\([^)]*\)/g, "").matchAll(SIZES)].map(
            (m) => m[1],
          );
        else if (k.startsWith("deslocamento"))
          sp.speed = Number(
            (/[\d,]+/.exec(value) || ["0"])[0].replace(",", "."),
          );
      }
      let trait = null;
      for (const p of DND.paragraphs(lines.filter((l) => !l.inTable))) {
        if (p.lead && p.leadItalic) {
          trait = { name: p.lead.replace(/\.$/, ""), text: [p] };
          sp.traits.push(trait);
        } else if (p.lead && trait) {
          (trait.options ||= []).push({
            name: p.lead.replace(/\.$/, ""),
            text: [p],
          });
        } else if (trait) {
          // Parágrafo sem rótulo: continua a opção (ou o traço) anterior.
          (trait.options?.at(-1) || trait).text.push(p);
        }
      }
      for (const t of tables) {
        const n = DND.norm(t.title);
        const owner =
          sp.traits.find((tr) => DND.norm(tr.name) === n) ||
          sp.traits.find((tr) =>
            tr.text.some((p) => DND.norm(p.text).includes(n)),
          );
        if (owner) {
          owner.table = t;
          owner.options = optionsOf(t);
        } else (sp.tables ||= []).push(t);
      }
      // Traços que dão escolhas: "um talento de Origem à sua escolha",
      // "proficiência em uma perícia à sua escolha".
      for (const tr of sp.traits) {
        const t = tr.text.map((p) => p.text).join(" ");
        if (/talento de origem à sua escolha/i.test(t))
          tr.grants = { feat: "origin" };
        const sk = /proficiência em (\S+) perícias? à sua escolha/i.exec(t);
        if (sk && WORDS[DND.norm(sk[1])])
          tr.grants = { skills: WORDS[DND.norm(sk[1])] };
      }
      return sp;
    });
  }

  // Tabela achada pelo título em qualquer lugar do livro.
  const tableNamed = (book, title) => {
    const l = book.lines.find(
      (l) => isTableTitle(l) && DND.norm(l.text) === DND.norm(title),
    );
    return l && DND.table(book, l, { font: TABLE_FONT });
  };

  // Idiomas (capítulo 2): o "*" de nota de rodapé sai do nome.
  function extractLanguages(book) {
    const out = [];
    for (const [title, rare] of [
      ["Idiomas Comuns", false],
      ["Idiomas Raros", true],
    ]) {
      const t = tableNamed(book, title);
      if (!t) continue;
      const col = (name) => t.columns.findIndex((c) => DND.norm(c) === name);
      const [ci, co, cr] = [col("idioma"), col("origem"), col("1d12")];
      for (const r of t.rows) {
        const name = r[ci].replace(/\*$/, "");
        out.push({
          id: slug(name),
          name,
          origin: r[co],
          rare,
          ...(cr >= 0 && { roll: r[cr] }),
        });
      }
    }
    return out;
  }

  // Perícias (capítulo 1): nome → atributo, para o motor de regras.
  function extractSkills(book) {
    const t = tableNamed(book, "Perícias");
    if (!t) return [];
    return t.rows.map((r) => ({
      id: slug(r[0]),
      name: r[0],
      ability: abilitiesIn(r[1])[0],
    }));
  }

  // ---------- Talentos ----------

  const FEAT_CATEGORIES = {
    "talentos de origem": "origin",
    "talentos gerais": "general",
    "talentos de estilo de luta": "fighting-style",
    "talentos de dadiva epica": "epic-boon",
  };

  /*
    Exemplo: "Nível 8 ou superior, Força ou Destreza 15 ou superior" →
    { level: 8, abilities: { any: ["str","dex"], min: 15 }, other: [] }.
    O que não for nível nem atributo (treinamento com armadura,
    característica de conjuração…) fica em "other", como texto.
  */
  function parsePrerequisite(text) {
    const pre = { text };
    let rest = text;
    const lv = /Nível (\d+)(?: ou superior)?/i.exec(rest);
    if (lv) {
      pre.level = Number(lv[1]);
      rest = rest.replace(lv[0], "");
    }
    const ab =
      /((?:Força|Destreza|Constituição|Inteligência|Sabedoria|Carisma)(?:,\s*|\s+ou\s+|\s+e\s+)?)+\s*(\d+)(?: ou superior)?/i.exec(
        rest,
      );
    if (ab) {
      pre.abilities = {
        [/\se\s/.test(ab[0]) ? "all" : "any"]: abilitiesIn(ab[0]),
        min: Number(ab[2]),
      };
      rest = rest.replace(ab[0], "");
    }
    pre.other = rest
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return pre;
  }

  /*
    Escolhas que um talento dá, lidas do texto:
    "aprende <N> truques … na lista de magias de <classe>, <classe> ou <classe>"
    + "Escolha uma magia de 1º Círculo" → spells;
    "proficiência em <N> perícias ou ferramentas" (qualquer combinação)
    → proficiencies { count, kinds }.
  */
  const KINDS = [
    [/perícias ou ferramentas/i, ["skill", "tool"]],
    [/ferramentas de artesão/i, ["artisan"]],
    [/instrumentos musicais/i, ["instrument"]],
    [/perícias/i, ["skill"]],
  ];
  function featGrants(text) {
    const all = text.map((p) => p.text).join(" ");
    const out = {};
    const c = /aprende (\S+) truques/i.exec(all);
    if (c) {
      const lists = /lista de magias de ([^.]+?)\./i.exec(all);
      out.spells = {
        cantrips: WORDS[DND.norm(c[1])] || 0,
        level1: /magia de 1º círculo/i.test(all) ? 1 : 0,
        lists: lists
          ? lists[1].split(/,\s*|\s+ou\s+/).map((n) => slug(n.trim()))
          : [],
      };
    }
    const pr =
      /proficiência (?:em|com) (?:qualquer combinação de )?(\S+) ((?:perícias ou ferramentas|ferramentas de artesão|instrumentos musicais|perícias))/i.exec(
        all,
      );
    if (pr && WORDS[DND.norm(pr[1])])
      out.proficiencies = {
        count: WORDS[DND.norm(pr[1])],
        kinds: KINDS.find(([re]) => re.test(pr[2]))[1],
      };
    // Bônus fixo de CA vestindo armadura (estilo Defensivo).
    const ac =
      /usando armadura[^.]*bônus de \+(\d) na Classe de Armadura/i.exec(all);
    if (ac) out.ac = { bonus: Number(ac[1]), armored: true };
    return out;
  }

  // Formato: "Aumente <atributo> ou <atributo> em 1, até no máximo 20."
  function parseAsi(text) {
    const from = abilitiesIn(text);
    return {
      from: from.length ? from : Object.values(ABILITIES),
      amounts: [...text.matchAll(/\bem (\d)\b/g)].map((m) => Number(m[1])),
      max: Number((/máximo (?:de )?(\d+)/.exec(text) || [, 20])[1]),
    };
  }

  function extractFeats(book, outline) {
    const chapter = chapterOf(outline, "Talentos");
    const section = chapter?.children.find((n) =>
      /^descricoes dos talentos/.test(DND.norm(n.title)),
    );
    if (!section) return [];
    const out = [];
    for (const group of section.children) {
      const category = FEAT_CATEGORIES[DND.norm(group.title)];
      if (!category) continue; // "Partes de um Talento" etc.: explicação
      for (const node of group.children) {
        const body = DND.body(book, node, { own: false });
        // Tabelas primeiro (Fabricação Rápida…), para não virarem texto.
        const tables = body
          .filter((l) => isTableTitle(l) && !l.inTable)
          .map((l) => DND.table(book, l, { font: TABLE_FONT }))
          .filter(Boolean);
        const lines = body.filter((l) => !isNoise(l));
        // Linha(s) em itálico logo abaixo do título: categoria e pré-requisito.
        let k = 0;
        let kind = "";
        for (; k < lines.length && lines[k].italic && !lines[k].bold; k++)
          kind = DND.join(kind, lines[k].text);
        const pre = /\(Pré-requisito:\s*(.+)\)$/.exec(kind);
        const text = DND.paragraphs(lines.slice(k));
        const benefits = text.filter((p) => p.lead);
        const asiP = text.find(
          (p) =>
            /^aumento no valor de atributo/.test(DND.norm(p.lead || "")) ||
            /^Aumente/.test(p.text),
        );
        out.push({
          id: slug(node.title),
          name: node.title,
          source: "phb2024",
          page: node.page,
          category,
          categoryName: kind.replace(/\s*\(Pré-requisito.*$/, ""),
          ...(pre && { prerequisite: parsePrerequisite(pre[1]) }),
          repeatable: benefits.some((p) => /^repetivel/.test(DND.norm(p.lead))),
          ...(asiP && { asi: parseAsi(asiP.text) }),
          ...featGrants(text),
          text,
          ...(tables.length && { tables }),
        });
      }
    }
    return out;
  }

  // ---------- Magias ----------

  /*
    Cabeçalho em itálico: "3º Círculo, Evocação (Feiticeiro, Mago)" ou
    "Truque de Evocação (Feiticeiro, Mago)". As classes viram ids (o
    mesmo slug das classes), para que uma expansão possa acrescentar
    magias à lista de uma classe da base só citando o nome dela.
  */
  function parseSpellHeader(text) {
    const lv = /^(\d)[º°o] Círculo,\s*([^(]+?)\s*\(([^)]*)\)/.exec(text);
    const cantrip = /^Truque de\s+([^(]+?)\s*\(([^)]*)\)/.exec(text);
    if (!lv && !cantrip) return null;
    const [level, school, classes] = lv
      ? [Number(lv[1]), lv[2], lv[3]]
      : [0, cantrip[1], cantrip[2]];
    return { level, school, classes: list(classes).map(slug) };
  }

  // Formato: "V, S, M (<material>, valor em PO, às vezes consumido)"
  function parseComponents(value) {
    const m = /\bM\s*\((.*)\)\s*$/.exec(value);
    const cost = m && /([\d.]+)(?:\+|\s+ou mais)?\s*PO/.exec(m[1]);
    return {
      verbal: /(^|,\s*)V\b/.test(value),
      somatic: /(^|,\s*)S\b/.test(value),
      ...(m && {
        material: m[1],
        ...(cost && { cost: Number(cost[1].replace(/\./g, "")) }),
        consumed: /consom|consumid/i.test(m[1]),
      }),
    };
  }

  function extractSpells(book, outline) {
    const chapter = chapterOf(outline, "Magias");
    const section = chapter?.children.find((n) =>
      /^descricoes da/.test(DND.norm(n.title)),
    );
    if (!section) return [];
    const out = [];
    for (const node of section.children) {
      const body = DND.body(book, node, { own: false });
      const tables = body
        .filter((l) => isTableTitle(l) && !l.inTable)
        .map((l) => DND.table(book, l, { font: TABLE_FONT }))
        .filter(Boolean);
      const lines = body.filter((l) => !isNoise(l));
      // Cabeçalho: tudo antes do bloco rotulado (quase sempre itálico,
      // mas o livro tem magias com ele em letra reta).
      let k = 0;
      let head = "";
      for (; k < lines.length && !TABLE_FONT.test(lines[k].font); k++)
        head = DND.join(head, lines[k].text);
      // Bloco rotulado (Tempo de Conjuração, Alcance…) logo depois.
      let j = k;
      while (j < lines.length && TABLE_FONT.test(lines[j].font)) j++;
      const fields = DND.labeled(lines.slice(k, j));
      const text = DND.paragraphs(lines.slice(j).filter((l) => !l.inTable));
      const field = (re) =>
        fields.find((f) => re.test(DND.norm(f.label)))?.value || "";
      const time = field(/^tempo/);
      const duration = field(/^duracao/);
      const higher = text.find((p) =>
        /^(usando um espaco de magia|aprimoramento de truque)/.test(
          DND.norm(p.lead || ""),
        ),
      );
      out.push({
        id: slug(node.title),
        name: node.title,
        source: "phb2024",
        page: node.page,
        ...parseSpellHeader(head),
        castingTime: time.replace(/\s*ou Ritual$/i, ""),
        ritual: /\bRitual\b/.test(time),
        range: field(/^alcance/),
        components: parseComponents(field(/^componentes/)),
        duration,
        concentration: /^Concentração/.test(duration),
        ...(higher && { higher: higher.text }),
        text,
        ...(tables.length && { tables }),
      });
    }
    return out;
  }

  // ---------- Equipamento ----------

  // "1.000 PO" → { amount: 1000, unit: "PO", cp: 100000 }; "Varia" → null.
  const COIN = { PC: 1, PP: 10, PE: 50, PO: 100, PL: 1000 };
  function parseCost(text) {
    const m = /([\d.]+)\s*(PC|PP|PE|PO|PL)\b/.exec(text || "");
    if (!m) return null;
    const amount = Number(m[1].replace(/\./g, ""));
    return { amount, unit: m[2], cp: amount * COIN[m[2]] };
  }
  // "0,5 kg" → 0.5; "150 g" → 0.15; "—" → 0. Sempre em quilos.
  function parseWeight(text) {
    const m = /([\d,]+)\s*(kg|g)\b/.exec(text || "");
    if (!m) return 0;
    const n = Number(m[1].replace(",", "."));
    return m[2] === "g" ? n / 1000 : n;
  }

  /*
    Tabela com subtítulos ("Armas Simples Corpo a Corpo", "Armadura Leve
    (1 Minuto…)"): a linha de uma célula só abre um grupo, e cada item
    leva o nome do grupo em que está.
  */
  function grouped(table) {
    const out = [];
    let group = "";
    for (const r of table.rows) {
      if (r.slice(1).every((c) => !c)) group = r[0];
      else out.push({ group, cells: r });
    }
    return out;
  }

  // Propriedades: "Arremesso (Alcance 6/18)" → { id, name, detail }.
  function parseProperties(text) {
    if (!text || text === "—") return [];
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of text + ",") {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    return out.map((p) => {
      const m = /^(.+?)\s*\((.+)\)$/.exec(p);
      const name = m ? m[1] : p;
      return { id: slug(name), name, ...(m && { detail: m[2] }) };
    });
  }

  function extractEquipment(book, outline) {
    const chapter = chapterOf(outline, "Equipamento");
    if (!chapter) return null;
    const all = [];
    (function walk(n) {
      for (const c of n.children) {
        all.push(c);
        walk(c);
      }
    })(chapter);
    const byTitle = (t) => all.find((n) => DND.norm(n.title) === DND.norm(t));
    const entries = (t) =>
      (byTitle(t)?.children || []).map((n) => ({
        id: slug(n.title),
        name: n.title,
        page: n.page,
        text: paragraphs(book, n, false),
      }));

    const weaponTable = tableNamed(book, "Armas");
    const weapons = weaponTable
      ? grouped(weaponTable).map(
          ({ group, cells: [name, dmg, props, mastery, weight, cost] }) => {
            const g = DND.norm(group);
            const d = /^(\d+(?:d\d+)?)\s+(.+?),?$/.exec(dmg) || [, dmg, ""];
            return {
              id: slug(name),
              name,
              source: "phb2024",
              category: g.includes("marcia") ? "martial" : "simple",
              ranged: g.includes("distancia"),
              group,
              damage: { dice: d[1], type: d[2] },
              properties: parseProperties(props.replace(/,$/, "")),
              mastery: slug(mastery),
              weight: parseWeight(weight),
              cost: parseCost(cost),
            };
          },
        )
      : [];

    const armorTable = tableNamed(book, "Armaduras");
    const armor = armorTable
      ? grouped(armorTable).map(
          ({ group, cells: [name, ac, str, stealth, weight, cost] }) => {
            const g = DND.norm(group);
            const category = g.startsWith("escudo")
              ? "shield"
              : g.includes("leve")
                ? "light"
                : g.includes("media")
                  ? "medium"
                  : "heavy";
            const max = /máx\.?\s*(\d+)/.exec(ac);
            return {
              id: slug(name),
              name,
              source: "phb2024",
              category,
              group,
              // CA: base + Des (com teto) ou fixa; o escudo soma (+2).
              ac: {
                base: Number((/\d+/.exec(ac) || [0])[0]),
                ...(category === "shield" && { bonus: true }),
                dex: /Des/i.test(ac),
                ...(max && { maxDex: Number(max[1]) }),
              },
              strength: Number((/\d+/.exec(str) || [0])[0]) || 0,
              stealthDisadvantage: /desvantagem/i.test(stealth),
              weight: parseWeight(weight),
              cost: parseCost(cost),
            };
          },
        )
      : [];

    // Ferramentas: o preço vem no próprio título ("… (8 PO)").
    const tool = (kind) => (e) => {
      const m = /^(.+?)\s*\(([^)]+)\)$/.exec(e.name);
      const node = byTitle(e.name);
      const fields = DND.labeled(
        DND.body(book, node, { own: false }).filter(
          (l) => TABLE_FONT.test(l.font) && !isNoise(l),
        ),
      );
      return {
        ...e,
        id: slug(m ? m[1] : e.name),
        name: m ? m[1] : e.name,
        source: "phb2024",
        kind,
        cost: parseCost(m?.[2]),
        ...(fields.length && { fields }),
        ability: abilitiesIn(
          fields.find((f) => /^atributo/.test(DND.norm(f.label)))?.value || "",
        ),
      };
    };
    const tools = [
      ...entries("Ferramentas de Artesão").map(tool("artisan")),
      ...entries("Outras Ferramentas").map(tool("other")),
    ];

    // Equipamento de aventura: peso e custo da tabela, texto do verbete.
    const gearTable = tableNamed(book, "Equipamento de Aventura");
    const descs = entries("Equipamento de Aventura");
    const gear = gearTable
      ? unfold(gearTable).rows.map(([name, weight, cost]) => {
          // A tabela e o verbete nem sempre escrevem igual ("Pote, Ferro"
          // × "Pote de Ferro", "Roupas, Fantasia" × "Fantasia"): compara
          // as palavras, sem preposições, e aceita o verbete contido.
          const words = (t) =>
            DND.norm(t.replace(/\s*\(.*\)$/, ""))
              .split(" ")
              .filter((w) => !/^(de|do|da|dos|das)$/.test(w));
          const mine = words(name);
          const d =
            descs.find((e) => words(e.name).join() === mine.join()) ||
            descs.find((e) => words(e.name).every((w) => mine.includes(w)));
          return {
            id: slug(name),
            name,
            source: "phb2024",
            weight: parseWeight(weight),
            cost: parseCost(cost),
            ...(d && { text: d.text, page: d.page }),
          };
        })
      : [];

    // Tabelas de variantes (focos, munição, símbolos sagrados).
    const variants = {};
    for (const [key, title] of [
      ["arcaneFocus", "Focos Arcanos"],
      ["druidicFocus", "Focos Druídicos"],
      ["ammunition", "Munição"],
      ["holySymbol", "Símbolos Sagrados"],
    ]) {
      const t = tableNamed(book, title);
      if (t)
        variants[key] = t.rows.map((r) => ({
          id: slug(r[0]),
          name: r[0],
          weight: parseWeight(r[r.length - 2]),
          cost: parseCost(r[r.length - 1]),
          ...(r.length > 3 && {
            values: Object.fromEntries(
              t.columns.slice(1, -2).map((c, k) => [c, r[k + 1]]),
            ),
          }),
        }));
    }

    return {
      weapons,
      armor,
      tools,
      gear,
      variants,
      properties: entries("Propriedades"),
      masteries: entries("Propriedades de Maestria"),
    };
  }

  DND.registerSource({
    id: "phb2024",
    name: "Livro do Jogador (2024)",
    // Versão do extrator: suba o número sempre que a leitura mudar, para
    // que os dados guardados no navegador (store.js) sejam relidos.
    version: 5,
    edition: "2024",
    lang: "pt-BR",
    sha256: [
      "55f530ae733992d95cf6c7a000b86b40a2166e98292347e76db4693941f7236c",
    ],
    tocPages: [9],
    skip: isFooter,

    extract(book) {
      fixDropCaps(book);
      markStatBlocks(book);
      const outline = DND.outline(book, { headings, skip: isFooter });
      return {
        source: this.id,
        offset: pageOffset(book),
        outline,
        toc: DND.parseToc(book, this.tocPages),
        classes: extractClasses(book, outline),
        backgrounds: extractBackgrounds(book, outline),
        species: extractSpecies(book, outline),
        feats: extractFeats(book, outline),
        languages: extractLanguages(book),
        skills: extractSkills(book),
        spells: extractSpells(book, outline),
        equipment: extractEquipment(book, outline),
      };
    },
  });
})(globalThis);
