/*
  d&d.exe — recebe o PDF (clicando ou arrastando), abre com o leitor
  próprio (pdf.js) e mostra o texto extraído de cada página. A montagem
  dos dados do livro (classes, magias…) chega nas próximas etapas.
*/

const input = document.querySelector("[data-book-input]");
const dropzone = document.querySelector(".dropzone");
const status = document.querySelector("[data-book-status]");
const preview = document.querySelector("[data-preview]");
const previewPage = document.querySelector("[data-preview-page]");
const previewText = document.querySelector("[data-preview-text]");
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
    doc = await PDF.open(await file.arrayBuffer());
    status.textContent = i18n.t("dnd.opened", {
      name: file.name,
      size: formatSize(file.size),
      pages: doc.pageCount,
      ms: Math.round(performance.now() - started),
    });
    previewPage.max = doc.pageCount;
    preview.hidden = false;
    showPage();
  } catch (error) {
    console.error(error);
    status.textContent = i18n.t("dnd.readError", { error: error.message });
  }
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
