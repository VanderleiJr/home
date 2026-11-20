/*
  d&d.exe — por enquanto só recebe o PDF (clicando ou arrastando) e
  mostra o nome e o tamanho. A leitura do livro chega nas próximas etapas.
*/

const input = document.querySelector("[data-book-input]");
const dropzone = document.querySelector(".dropzone");
const status = document.querySelector("[data-book-status]");

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
  status.textContent = i18n.t("dnd.received", {
    name: file.name,
    size: formatSize(file.size),
  });
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
