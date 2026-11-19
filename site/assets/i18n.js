/*
  Tradução das páginas (i18n = "internationalization": i + 18 letras + n).

  Cada página existe uma vez só. No HTML, os textos traduzíveis são
  marcados com chaves:
    <h2 data-i18n="home.about.hi">Oi!</h2>          → troca o texto
    <p data-i18n-html="home.welcome.intro">…</p>    → troca o HTML (com <strong> etc.)
    <button data-i18n-attr="aria-label:home.close"> → troca atributos
  As traduções ficam em site/i18n/<idioma>.json, e a lista de idiomas
  em site/i18n/languages.json. Um idioma novo é só mais um arquivo JSON.

  O texto escrito no HTML é o português: a página funciona mesmo sem
  JavaScript ou se o JSON não carregar.

  Para os scripts das páginas, fica disponível o objeto global i18n:
    i18n.ready  → Promise resolvida quando os textos já foram trocados
    i18n.t(chave, { variavel }) → o texto no idioma atual
    i18n.lang   → o código do idioma atual (ex.: "en")

  Este arquivo roda no <head>, sem defer: assim ele esconde os textos
  ANTES da primeira pintura e ninguém vê o português "piscar".
*/

/*
  IIFE (função que se executa na hora): tudo aqui dentro fica privado.
  Um bloco { } simples não basta — em scripts comuns, "function x()"
  dentro de um bloco vaza para o escopo global e colidiria com nomes
  das páginas (o kana.js também tem um "t", por exemplo).
*/
(() => {
  const DEFAULT = "pt-BR";
  const STORE_KEY = "lang";
  const root = document.documentElement;

  // document.currentScript: o próprio <script>. A pasta i18n/ é vizinha de assets/.
  const base = new URL("../i18n/", document.currentScript.src);

  const readStore = () => {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch {
      return null;
    }
  };
  const writeStore = (value) => {
    try {
      localStorage.setItem(STORE_KEY, value);
    } catch {
      // Sem armazenamento: o idioma vale só para esta página.
    }
  };

  /*
    Preferências, da mais forte para a mais fraca:
    1. ?lang= na URL (link compartilhado);
    2. a escolha salva no seletor de idiomas;
    3. os idiomas configurados no navegador (navigator.languages);
    4. o idioma padrão.
  */
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (fromUrl) writeStore(fromUrl);
  const wishes = [fromUrl, readStore(), ...navigator.languages, DEFAULT].filter(
    Boolean,
  );

  /*
    Palpite rápido: se o primeiro desejo não é português, escondemos os
    textos marcados até a tradução chegar (veja .i18n-pending no
    scene.css). O cenário continua visível — só as palavras esperam.
  */
  const primary = (code) => code.toLowerCase().split("-")[0];
  if (primary(wishes[0]) !== primary(DEFAULT)) {
    root.classList.add("i18n-pending");
  }

  // Encontra o melhor idioma disponível: código exato ou mesmo idioma base ("en-US" → "en").
  function choose(languages) {
    const codes = languages.map((l) => l.code);
    for (const wish of wishes) {
      const exact = codes.find((c) => c.toLowerCase() === wish.toLowerCase());
      if (exact) return exact;
      const sameBase = codes.find((c) => primary(c) === primary(wish));
      if (sameBase) return sameBase;
    }
    return DEFAULT;
  }

  const getJson = (file) =>
    fetch(new URL(file, base)).then((response) => {
      if (!response.ok) throw new Error(`${file}: ${response.status}`);
      return response.json();
    });

  let languages = [];
  let dict = {};
  let fallback = {};

  // Chave com pontos ("home.about.hi") → caminho dentro do objeto JSON.
  const lookup = (object, key) =>
    key.split(".").reduce((node, part) => node?.[part], object);

  // Procura no idioma atual; se faltar a tradução, usa o padrão; se não, a própria chave.
  function t(key, vars = {}) {
    const text = lookup(dict, key) ?? lookup(fallback, key) ?? key;
    // Variáveis no texto: "Nível {n}" com { n: 3 } vira "Nível 3".
    return String(text).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
  }

  // Troca os textos de tudo que tem data-i18n* dentro de "scope".
  function apply(scope = document) {
    for (const el of scope.querySelectorAll("[data-i18n]")) {
      el.textContent = t(el.dataset.i18n);
    }
    // innerHTML só com textos dos nossos próprios arquivos — nunca com texto de usuário.
    for (const el of scope.querySelectorAll("[data-i18n-html]")) {
      el.innerHTML = t(el.dataset.i18nHtml);
    }
    // Formato: "atributo:chave, outro-atributo:outra.chave".
    for (const el of scope.querySelectorAll("[data-i18n-attr]")) {
      for (const pair of el.dataset.i18nAttr.split(",")) {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        el.setAttribute(attr, t(key));
      }
    }
  }

  // Seletor de idiomas: um <select data-lang-select> montado a partir da lista.
  function buildSelectors() {
    for (const select of document.querySelectorAll("[data-lang-select]")) {
      select.replaceChildren(
        ...languages.map(({ code, name }) => {
          const option = new Option(name, code, false, code === i18n.lang);
          option.lang = code;
          return option;
        }),
      );
      select.addEventListener("change", () => {
        writeStore(select.value);
        // Recarrega com ?lang=: a URL fica pronta para compartilhar.
        const url = new URL(location.href);
        url.searchParams.set("lang", select.value);
        location.href = url;
      });
    }
  }

  const domReady = new Promise((resolve) => {
    if (document.readyState !== "loading") resolve();
    else document.addEventListener("DOMContentLoaded", resolve);
  });

  const i18n = { lang: DEFAULT, t, apply };
  window.i18n = i18n;

  i18n.ready = getJson("languages.json")
    .then(async (list) => {
      languages = list;
      i18n.lang = choose(list);
      // Os dois dicionários em paralelo: o atual e o padrão (para chaves faltando).
      [dict, fallback] = await Promise.all([
        getJson(`${i18n.lang}.json`),
        i18n.lang === DEFAULT ? {} : getJson(`${DEFAULT}.json`),
      ]);
      if (i18n.lang === DEFAULT) fallback = dict;
      await domReady;
      root.lang = i18n.lang;
      apply();
      buildSelectors();
    })
    .catch((error) => {
      // Sem tradução (arquivo faltando, página aberta via file://): fica o português do HTML.
      console.warn("i18n:", error);
    })
    .finally(() => root.classList.remove("i18n-pending"));
})();
