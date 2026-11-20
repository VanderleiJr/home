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

    // Por enquanto devolve só o mapa; as etapas seguintes acrescentam
    // classes, origens, talentos, magias e equipamento.
    extract(book) {
      const outline = DND.outline(book, { headings, skip: isFooter });
      return {
        source: this.id,
        offset: pageOffset(book),
        outline,
        toc: DND.parseToc(book, this.tocPages),
      };
    },
  });
})(globalThis);
