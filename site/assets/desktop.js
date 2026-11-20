/*
  desktop.js: o comportamento de "área de trabalho" compartilhado por
  todas as páginas (o visual fica no win98.css):
  - arrastar as janelas pela barra de título (só em telas largas);
  - trazer para a frente a janela clicada;
  - minimizar, fechar e reabrir pela barra de tarefas;
  - o relógio da bandeja.

  Tudo é ligado por atributos no HTML, então uma página nova não precisa
  de código: basta usar as mesmas classes e data-*.
    .window                      → janela (arrastável)
    [data-action="minimize"]     → minimiza; a janela ganha um botão em .tasks
    [data-action="close"]        → fecha (esconde com hidden)
    [data-open="id-da-janela"]   → reabre uma janela (ícones, menus)
    <time class="clock">         → relógio

  Para os scripts das páginas, fica o objeto global desktop:
    desktop.open(win), desktop.close(win), desktop.minimize(win)

  As posições não são salvas: ao recarregar, cada janela volta ao lugar.
*/

// IIFE: os nomes daqui de dentro não colidem com os dos scripts das páginas.
(() => {
  const windows = [...document.querySelectorAll(".window")];
  const tasks = document.querySelector(".tasks");

  // z-index sempre crescente: a última janela clicada fica na frente das outras.
  let topZ = 10;

  function focusWindow(win) {
    windows.forEach((w) => w.classList.remove("is-active"));
    win.classList.add("is-active");
    win.style.zIndex = ++topZ;
    updateTasks();
  }

  function openWindow(win) {
    win.hidden = false;
    win.classList.remove("is-minimized");
    focusWindow(win);
  }

  function closeWindow(win) {
    win.hidden = true;
    win.classList.remove("is-active");
    updateTasks();
  }

  function minimizeWindow(win) {
    win.classList.add("is-minimized");
    win.classList.remove("is-active");
    updateTasks();
  }

  /*
    Barra de tarefas: recriada a cada mudança, com um botão por janela
    aberta que pode ser minimizada (as outras não têm como sumir, então
    não precisam de botão). aria-pressed diz qual janela está em foco.
  */
  function updateTasks() {
    if (!tasks) return;
    const buttons = windows
      .filter(
        (win) => !win.hidden && win.querySelector("[data-action=minimize]"),
      )
      .map((win) => {
        const active = win.classList.contains("is-active");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn task";
        button.textContent = win.querySelector(".titlebar-text").textContent;
        button.setAttribute("aria-pressed", String(active));
        button.addEventListener("click", () =>
          active ? minimizeWindow(win) : openWindow(win),
        );
        return button;
      });
    tasks.replaceChildren(...buttons);
  }

  /*
    Arrastar pela barra de título com Pointer Events, que funcionam igual
    para mouse, caneta e toque. setPointerCapture mantém os eventos chegando
    mesmo se o ponteiro sair da barra durante o movimento rápido.

    A janela não muda de lugar no layout: só ganha um deslocamento
    (--drag-x/--drag-y, usados pelo "translate" do win98.css). Assim o
    mesmo código serve para janelas soltas (página inicial) e para as que
    seguem o fluxo da página (projetos).
  */
  const canDrag = window.matchMedia("(min-width: 720px)");

  windows.forEach((win) => {
    /*
      Em telas grandes, focamos já no pointerdown (antes de arrastar).
      No celular, só no click: o Safari do iPhone cancela o toque se a
      página muda visualmente no começo dele — ele interpreta como "hover"
      e espera um segundo toque. Focar a janela muda cores e a barra de
      tarefas, então isso fazia os botões de fechar/minimizar falharem.
    */
    win.addEventListener(
      "pointerdown",
      () => canDrag.matches && focusWindow(win),
    );
    win.addEventListener("click", () => !canDrag.matches && focusWindow(win));

    const bar = win.querySelector(".titlebar");
    bar.addEventListener("pointerdown", (event) => {
      if (!canDrag.matches || event.target.closest("button, a, select")) {
        return;
      }

      const startX = event.clientX;
      const startY = event.clientY;
      const dragX = parseFloat(win.style.getPropertyValue("--drag-x")) || 0;
      const dragY = parseFloat(win.style.getPropertyValue("--drag-y")) || 0;
      // Retângulos na tela (getBoundingClientRect) antes de mover.
      const start = win.getBoundingClientRect();
      const area = win.parentElement.getBoundingClientRect();
      bar.setPointerCapture(event.pointerId);

      const move = (e) => {
        /*
          Limita o deslocamento para a janela não sair da área de
          trabalho: nem para os lados, nem acima, e a barra de título
          sempre visível embaixo (senão não teria como puxá-la de volta).
        */
        const dx = Math.max(
          area.left - start.left,
          Math.min(e.clientX - startX, area.right - start.right),
        );
        const dy = Math.max(
          area.top - start.top,
          Math.min(
            e.clientY - startY,
            area.bottom - start.top - bar.offsetHeight,
          ),
        );
        win.style.setProperty("--drag-x", `${dragX + dx}px`);
        win.style.setProperty("--drag-y", `${dragY + dy}px`);
      };

      bar.addEventListener("pointermove", move);
      bar.addEventListener(
        "pointerup",
        () => bar.removeEventListener("pointermove", move),
        { once: true },
      );
    });
  });

  /*
    Delegação de eventos: um único "ouvinte" no documento trata os cliques
    de todos os botões, lendo os atributos data-* de cada um. Assim,
    elementos novos funcionam sem precisar de código extra.
  */
  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-open]");
    if (opener) openWindow(document.getElementById(opener.dataset.open));

    const control = event.target.closest("[data-action]");
    const win = control?.closest(".window");
    if (!win) return;
    if (control.dataset.action === "close") closeWindow(win);
    if (control.dataset.action === "minimize") minimizeWindow(win);
  });

  // Começa com a primeira janela visível em foco (barra colorida).
  const first = windows.find((w) => !w.hidden);
  if (first) focusWindow(first);
  // Os botões da barra de tarefas copiam o título das janelas: refaz após a tradução.
  i18n.ready.then(updateTasks);

  /* ---------- Relógio da bandeja ---------- */

  // toLocaleTimeString formata a hora no idioma escolhido (i18n.lang).
  const clock = document.querySelector(".clock");

  function updateClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString(i18n.lang, {
      hour: "2-digit",
      minute: "2-digit",
    });
    clock.dateTime = now.toISOString();
  }

  if (clock) {
    // O idioma só é conhecido depois que o i18n.js termina de carregar.
    i18n.ready.then(updateClock);
    setInterval(updateClock, 15_000);
  }

  window.desktop = {
    open: openWindow,
    close: closeWindow,
    minimize: minimizeWindow,
  };
})();
