/*
  d&d.exe — recebe o PDF (clicando ou arrastando), abre com o leitor
  próprio (pdf.js), reconhece a versão do livro pelo hash, extrai os
  dados com a fonte correspondente (sources/*.js) e guarda o resultado
  no navegador (store.js). Na visita seguinte, abre direto do cache.
*/

const input = document.querySelector("[data-book-input]");
const dropzone = document.querySelector(".dropzone");
const status = document.querySelector("[data-book-status]");
const progress = document.querySelector("[data-book-progress]");
const bookMap = document.querySelector("[data-book-map]");
const bookTree = document.querySelector("[data-book-tree]");
const booksBox = document.querySelector("[data-books]");
const booksList = document.querySelector("[data-books-list]");
// Livros carregados: id da fonte → registro { source, name, savedAt, data }.
const loaded = new Map();

// Intl.NumberFormat com unit: "36,7 MB" formatado no idioma da página.
function formatSize(bytes) {
  return new Intl.NumberFormat(document.documentElement.lang, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1e6);
}

// Resumo do que foi extraído, para a barra de status.
const summary = (data) =>
  i18n.t("dnd.summary", {
    classes: data.classes.length,
    species: data.species.length,
    backgrounds: data.backgrounds.length,
    feats: data.feats.length,
    spells: data.spells.length,
  });

async function receive(file) {
  await i18n.ready;
  // file.type pode vir vazio em alguns sistemas; a extensão é o plano B.
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    status.textContent = i18n.t("dnd.notPdf");
    return;
  }
  status.textContent = i18n.t("dnd.reading", { name: file.name });
  try {
    // arrayBuffer() lê o arquivo inteiro na memória, sem enviar nada.
    const started = performance.now();
    const buffer = await file.arrayBuffer();
    /*
      O hash SHA-256 é a "impressão digital" do arquivo: qualquer byte
      diferente muda tudo. Assim sabemos qual extrator usar, e uma versão
      desconhecida não gera dados errados em silêncio.
    */
    const source = DND.identify(await PDF.sha256(buffer));
    if (!source) {
      status.textContent = i18n.t("dnd.unknownBook", { name: file.name });
      return;
    }
    const doc = await PDF.open(buffer);
    progress.hidden = false;
    progress.max = doc.pageCount;
    const book = await DND.readBook(doc, (done) => {
      progress.value = done;
      status.textContent = i18n.t("dnd.progress", {
        done,
        total: doc.pageCount,
      });
    });
    const record = {
      source: source.id,
      name: source.name,
      version: source.version,
      savedAt: Date.now(),
      data: source.extract(book),
    };
    progress.hidden = true;
    status.textContent = i18n.t("dnd.opened", {
      name: source.name,
      size: formatSize(file.size),
      pages: doc.pageCount,
      ms: Math.round(performance.now() - started),
      summary: summary(record.data),
    });
    loaded.set(record.source, record);
    render();
    /*
      Guardar pode falhar (aba anônima, cota cheia): o livro continua
      valendo nesta visita, só não fica para a próxima.
    */
    try {
      await Store.save(record);
    } catch (error) {
      status.textContent +=
        " · " + i18n.t("dnd.noStore", { error: error.message });
    }
  } catch (error) {
    console.error(error);
    progress.hidden = true;
    status.textContent = i18n.t("dnd.readError", { error: error.message });
  }
}

// Redesenha tudo a partir dos livros carregados (zero, um ou vários).
function render() {
  const records = [...loaded.values()];
  showBooks(records);
  const empty = records.length === 0;
  document.querySelector("[data-waiting]").hidden = !empty;
  bookMap.hidden = empty;
  // Sem livro, o assistente fica desabilitado (mas o rascunho continua guardado).
  if (empty) return Wizard.start(null);
  Wizard.start(DND.merge(records.map((r) => r.data)));
  // O mapa é de um livro só: mostra o do último carregado.
  showMap(records.at(-1).data.outline);
}

// Data e hora curtas ("20/11/2026, 19:21") no idioma da página.
const dateFormat = () =>
  new Intl.DateTimeFormat(document.documentElement.lang, {
    dateStyle: "short",
    timeStyle: "short",
  });

// Lista dos livros guardados, cada um com o botão de esquecer.
function showBooks(records) {
  const date = dateFormat();
  booksList.replaceChildren(
    ...records.map((r) =>
      el(
        "li",
        { className: "book" },
        el("span", {}, `${r.name} · ${date.format(r.savedAt)}`),
        el(
          "button",
          {
            type: "button",
            className: "btn",
            title: i18n.t("dnd.forgetHint", { name: r.name }),
            onclick: () => forget(r),
          },
          i18n.t("dnd.forget"),
        ),
      ),
    ),
  );
  booksBox.hidden = records.length === 0;
}

async function forget(record) {
  try {
    await Store.forget(record.source);
  } catch (error) {
    console.error(error); // sem banco, não havia nada guardado
  }
  loaded.delete(record.source);
  render();
  status.textContent = i18n.t("dnd.forgotten", { name: record.name });
}

/*
  Ao abrir a página: recupera o que já foi lido antes. Só vale o
  registro cuja fonte ainda existe e cuja versão do extrator é a
  atual; um registro velho é apagado e o livro precisa ser relido.
*/
async function restore() {
  await i18n.ready;
  let records = [];
  try {
    records = await Store.all();
  } catch (error) {
    console.warn("cache indisponível:", error.message);
    return;
  }
  for (const r of records) {
    const source = DND.sources.find((s) => s.id === r.source);
    if (!source || r.version !== source.version) {
      status.textContent = i18n.t("dnd.outdated", { name: r.name });
      Store.forget(r.source).catch(() => {});
      continue;
    }
    loaded.set(r.source, r);
  }
  if (!loaded.size) return;
  render();
  const last = [...loaded.values()].at(-1);
  status.textContent = i18n.t("dnd.cached", {
    name: last.name,
    date: dateFormat().format(last.savedAt),
    summary: summary(DND.merge([...loaded.values()].map((r) => r.data))),
  });
}

// Desenha a árvore de títulos como listas aninhadas (até 2 níveis de fundo).
function showMap(outline) {
  const build = (nodes, depth) =>
    nodes.map((node) => {
      const li = document.createElement("li");
      const page = document.createElement("span");
      page.className = "page";
      page.textContent = node.page;
      li.append(page, node.title);
      if (depth < 1 && node.children.length) {
        const ul = document.createElement("ul");
        ul.append(...build(node.children, depth + 1));
        li.append(ul);
      }
      return li;
    });
  bookTree.replaceChildren(...build(outline.children, 0));
}

input.addEventListener("change", () => {
  if (input.files[0]) receive(input.files[0]);
});

/*
  Arrastar e soltar: sem preventDefault no dragover o navegador recusa o
  drop e, no drop, abriria o PDF em vez de entregá-lo à página.
*/
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});
dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-dragging");
});
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  const file = event.dataTransfer.files[0];
  if (file) receive(file);
});

restore();
