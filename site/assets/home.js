/*
  Comportamento da página inicial: janelas, barra de tarefas, menu
  Iniciar, relógio e contador. Só a API do navegador (DOM), sem bibliotecas.
  O atributo "defer" no <script> garante que o HTML já foi lido quando
  este código roda — por isso podemos buscar elementos logo de cara.
*/

const desktop = document.querySelector(".desktop");
const windows = [...document.querySelectorAll(".window")];
const tasks = document.querySelector(".tasks");
const startButton = document.querySelector(".start-button");
const startMenu = document.getElementById("start-menu");

// z-index sempre crescente: a última janela clicada fica na frente das outras.
let topZ = 10;

/* ---------- Janelas ---------- */

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

// Barra de tarefas: recriada a cada mudança, com um botão por janela aberta.
// aria-pressed informa a leitores de tela qual janela está em foco.
function updateTasks() {
  const buttons = windows
    .filter((win) => !win.hidden)
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
*/
const canDrag = window.matchMedia("(min-width: 720px)");

windows.forEach((win) => {
  win.addEventListener("pointerdown", () => focusWindow(win));

  const bar = win.querySelector(".titlebar");
  bar.addEventListener("pointerdown", (event) => {
    if (!canDrag.matches || event.target.closest("button")) return;

    // Distância entre o ponteiro e o canto da janela, para ela não "pular".
    const offsetX = event.clientX - win.offsetLeft;
    const offsetY = event.clientY - win.offsetTop;
    bar.setPointerCapture(event.pointerId);

    const move = (e) => {
      // Limita a posição para a janela não sair da área de trabalho.
      const maxX = desktop.clientWidth - win.offsetWidth;
      const maxY = desktop.clientHeight - bar.offsetHeight;
      win.style.left = `${Math.max(0, Math.min(e.clientX - offsetX, maxX))}px`;
      win.style.top = `${Math.max(0, Math.min(e.clientY - offsetY, maxY))}px`;
    };

    bar.addEventListener("pointermove", move);
    bar.addEventListener(
      "pointerup",
      () => bar.removeEventListener("pointermove", move),
      { once: true },
    );
  });
});

/* ---------- Menu Iniciar ---------- */

function setStartMenu(open) {
  startMenu.hidden = !open;
  startButton.setAttribute("aria-expanded", String(open));
}

/*
  Delegação de eventos: um único "ouvinte" no documento trata os cliques
  de todos os ícones e botões, lendo os atributos data-* de cada um.
  Assim, elementos novos funcionam sem precisar de código extra.
*/
document.addEventListener("click", (event) => {
  const target = event.target;

  if (target.closest(".start-button")) {
    setStartMenu(startMenu.hidden);
    return;
  }

  const opener = target.closest("[data-open]");
  if (opener) openWindow(document.getElementById(opener.dataset.open));

  const control = target.closest("[data-action]");
  if (control) {
    const action = control.dataset.action;
    const win = control.closest(".window");
    if (action === "close") closeWindow(win);
    if (action === "minimize") minimizeWindow(win);
    if (action === "close-all") windows.forEach(closeWindow);
  }

  // Qualquer clique fora do menu (ou em um item dele) fecha o menu.
  if (
    !startMenu.hidden &&
    (opener || control || !target.closest("#start-menu"))
  ) {
    setStartMenu(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setStartMenu(false);
});

/* ---------- Relógio da bandeja ---------- */

// Intl.DateTimeFormat formata a hora no idioma da página (<html lang>).
const clock = document.querySelector(".clock");
const timeFormat = new Intl.DateTimeFormat(document.documentElement.lang, {
  hour: "2-digit",
  minute: "2-digit",
});

function tick() {
  const now = new Date();
  clock.textContent = timeFormat.format(now);
  clock.dateTime = now.toISOString();
}

tick();
setInterval(tick, 15_000);

/* ---------- Contador de visitas ---------- */

/*
  Os sites dos anos 90 tinham contadores de visitantes no servidor.
  Aqui não há servidor: localStorage guarda um número no próprio navegador,
  então o contador é honesto — mostra só as SUAS visitas.
  try/catch porque o armazenamento pode estar bloqueado (aba anônima, etc.).
*/
let visits = 1;
try {
  visits = Number(localStorage.getItem("home:visits") || 0) + 1;
  localStorage.setItem("home:visits", String(visits));
} catch {
  // Sem armazenamento: fica 1.
}
document.querySelector(".counter").textContent = String(visits).padStart(
  6,
  "0",
);

/* ---------- Contagem de projetos ---------- */

// A barra de status conta os links da lista — atualiza sozinha a cada projeto novo.
document.querySelector(".count").textContent = String(
  document.querySelectorAll(".file-list a").length,
);

/* ---------- Carro: direção pelo teclado ou giroscópio ---------- */

const car = document.querySelector(".car");
const floor = document.querySelector(".floor");
const road = document.querySelector(".road");

let carX = 0; // deslocamento lateral em px (0 = centro da estrada)
let limit = 0; // quanto o carro pode ir para cada lado sem sair da estrada
let tiltTarget = null; // -1..1 vindo do giroscópio; null = usando o teclado
const keys = new Set();

/*
  A estrada está num plano inclinado em 3D, então sua largura na TELA
  depende da altura: perto do horizonte é estreita, embaixo é larga.
  Para saber a largura exatamente na altura das rodas, invertemos a
  projeção em perspectiva que o próprio CSS faz:
    altura na tela:  yTela = y·cos(θ) · P / (P − y·sen(θ))
    ampliação:       escala = P / (P − y·sen(θ))
  onde y é a distância no plano, θ a inclinação e P o perspective.
*/
function measureRoad() {
  const css = getComputedStyle(document.documentElement);
  const depth = parseFloat(css.getPropertyValue("--floor-depth"));
  const tilt =
    (parseFloat(css.getPropertyValue("--floor-tilt")) * Math.PI) / 180;

  // offsetTop/offsetHeight ignoram transforms: medem o layout "puro".
  const yScreen = car.offsetTop + car.offsetHeight - floor.offsetTop;
  const y =
    (yScreen * depth) / (Math.cos(tilt) * depth + yScreen * Math.sin(tilt));
  const scale = depth / (depth - y * Math.sin(tilt));

  const roadHalf = (road.clientWidth * scale) / 2; // clientWidth: sem as bordas
  limit = Math.max(0, roadHalf - car.offsetWidth / 2);
}

/*
  requestAnimationFrame chama a função antes de cada quadro da tela
  (~60 vezes por segundo). Usamos o tempo entre quadros (dt) para que a
  velocidade seja a mesma em telas de 60 Hz, 120 Hz, etc.
*/
let lastFrame = performance.now();

function drive(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const before = carX;

  if (tiltTarget !== null) {
    // Giroscópio: aproxima suavemente da posição pedida pela inclinação.
    carX += (tiltTarget * limit - carX) * Math.min(1, dt * 8);
  } else {
    const steer =
      (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    carX += steer * limit * 1.4 * dt; // atravessa meia estrada em ~0,7s
  }

  carX = Math.max(-limit, Math.min(limit, carX));

  // Inclina o carro conforme a velocidade lateral, como numa curva.
  const lean = ((carX - before) / dt / (limit || 1)) * 4;
  car.style.setProperty("--car-x", `${carX}px`);
  car.style.setProperty("--car-tilt", `${Math.max(-6, Math.min(6, lean))}deg`);

  requestAnimationFrame(drive);
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault(); // evita rolar a página com as setas
  keys.add(event.key);
});
document.addEventListener("keyup", (event) => keys.delete(event.key));
// Se a janela perde o foco com a tecla apertada, o keyup nunca chega.
window.addEventListener("blur", () => keys.clear());
window.addEventListener("resize", measureRoad);

/*
  Giroscópio: o evento deviceorientation informa a inclinação do aparelho.
  gamma = inclinação lateral com o celular em pé; em paisagem, a inclinação
  lateral passa a ser o beta. ±25° de inclinação = estrada inteira.
  Regras do navegador: só funciona em HTTPS, e o iPhone exige que o
  usuário toque num botão e autorize (DeviceOrientationEvent.requestPermission).
*/
const gyroButton = document.querySelector(".gyro");

function onTilt(event) {
  const angle = screen.orientation ? screen.orientation.angle : 0;
  const degrees =
    angle === 90 ? event.beta : angle === 270 ? -event.beta : event.gamma;
  if (degrees === null) return;
  tiltTarget = Math.max(-1, Math.min(1, degrees / 25));
}

function setGyro(on) {
  gyroButton.setAttribute("aria-pressed", String(on));
  if (on) {
    window.addEventListener("deviceorientation", onTilt);
  } else {
    window.removeEventListener("deviceorientation", onTilt);
    tiltTarget = null;
  }
}

if (
  "DeviceOrientationEvent" in window &&
  matchMedia("(pointer: coarse)").matches
) {
  gyroButton.hidden = false;
}

gyroButton.addEventListener("click", async () => {
  if (gyroButton.getAttribute("aria-pressed") === "true") return setGyro(false);
  try {
    if (!window.isSecureContext) throw new Error("precisa de HTTPS");
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const answer = await DeviceOrientationEvent.requestPermission();
      if (answer !== "granted") throw new Error("permissão negada");
    }
    setGyro(true);
    // Rola até o fim para a estrada aparecer abaixo das janelas.
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } catch {
    gyroButton.title = gyroButton.dataset.unavailable;
    gyroButton.setAttribute("aria-label", gyroButton.dataset.unavailable);
  }
});

measureRoad();
requestAnimationFrame(drive);

/* ---------- Estado inicial ---------- */

focusWindow(document.getElementById("win-welcome"));
