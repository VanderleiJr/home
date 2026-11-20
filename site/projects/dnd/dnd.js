/*
  d&d.exe — recebe o PDF (clicando ou arrastando), abre com o leitor
  próprio (pdf.js), reconhece a versão do livro pelo hash e monta o
  mapa do livro com a fonte correspondente (sources/*.js).
*/

const input = document.querySelector("[data-book-input]");
const dropzone = document.querySelector(".dropzone");
const status = document.querySelector("[data-book-status]");
const preview = document.querySelector("[data-preview]");
const previewPage = document.querySelector("[data-preview-page]");
const previewText = document.querySelector("[data-preview-text]");
const progress = document.querySelector("[data-book-progress]");
const bookMap = document.querySelector("[data-book-map]");
const bookTree = document.querySelector("[data-book-tree]");
let doc = null;

// Intl.NumberFormat com unit: "36,7 MB" formatado no idioma da página.
function formatSize(bytes) {
  return new Intl.NumberFormat(document.documentElement.lang, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: 1,
  }).format(bytes / 1e6);
}

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
    doc = await PDF.open(buffer);
    progress.hidden = false;
    progress.max = doc.pageCount;
    const book = await DND.readBook(doc, (done) => {
      progress.value = done;
      status.textContent = i18n.t("dnd.progress", {
        done,
        total: doc.pageCount,
      });
    });
    const data = source.extract(book);
    progress.hidden = true;
    status.textContent = i18n.t("dnd.opened", {
      name: source.name,
      size: formatSize(file.size),
      pages: doc.pageCount,
      ms: Math.round(performance.now() - started),
    });
    showMap(data.outline);
    previewPage.max = doc.pageCount;
    preview.hidden = false;
    showPage();
  } catch (error) {
    console.error(error);
    progress.hidden = true;
    status.textContent = i18n.t("dnd.readError", { error: error.message });
  }
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
  bookMap.hidden = false;
}

// Texto da página escolhida, uma linha do PDF por linha.
async function showPage() {
  const n = Math.min(
    Math.max(1, previewPage.valueAsNumber || 1),
    doc.pageCount,
  );
  const lines = PDF.toLines(await doc.pageItems(n));
  previewText.textContent = lines.map((l) => l.text).join("\n");
}

previewPage.addEventListener("input", () => {
  if (doc) showPage();
});

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
