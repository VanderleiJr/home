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

/* ---------- Carro 3D em wireframe ---------- */

/*
  O carro é um modelo 3D simples: uma lista de faces (polígonos) com
  vértices em metros, no sistema do próprio carro:
    x = lateral (direita +), y = altura, z = para frente.
  A cada quadro o JS gira o carro (curva), posiciona na estrada e projeta
  cada vértice na tela com a MESMA perspectiva que o CSS aplica no chão.
  Por isso o carro "senta" na estrada em qualquer posição.
*/
const carSvg = document.querySelector(".car");
const floor = document.querySelector(".floor");
const road = document.querySelector(".road");
const taskbar = document.querySelector(".taskbar");
const SVG_NS = "http://www.w3.org/2000/svg";

// Caixa: trás, frente, laterais e tampa (o fundo nunca aparece para a câmera).
function box(x1, x2, y1, y2, z1, z2) {
  return [
    [
      [x1, y1, z1],
      [x2, y1, z1],
      [x2, y2, z1],
      [x1, y2, z1],
    ],
    [
      [x1, y1, z2],
      [x2, y1, z2],
      [x2, y2, z2],
      [x1, y2, z2],
    ],
    [
      [x1, y1, z1],
      [x1, y2, z1],
      [x1, y2, z2],
      [x1, y1, z2],
    ],
    [
      [x2, y1, z1],
      [x2, y2, z1],
      [x2, y2, z2],
      [x2, y1, z2],
    ],
    [
      [x1, y2, z1],
      [x2, y2, z1],
      [x2, y2, z2],
      [x1, y2, z2],
    ],
  ];
}

// Espelha uma face para o outro lado do carro (x → −x).
const mirror = (face) => face.map(([x, y, z]) => [-x, y, z]);

const HALF = 0.96; // meia largura total (com aerofólio e rodas)
const LENGTH = 4.2;
/*
  Licença artística: o chão visível representa só uns 10 m de estrada,
  então um carro de 4,2 m ocuparia metade dele e pareceria visto de cima.
  Como nos jogos de corrida dos anos 80, comprimimos a profundidade do
  carro (o eixo z) e mantemos largura e altura reais.
*/
const DEPTH = 0.4;
const hoodY = (z) => 0.73 - (0.17 * z) / LENGTH; // capô inclinado (cunha anos 80)
const sideBody = [
  [-0.9, 0.25, 0],
  [-0.9, 0.72, 0],
  [-0.9, 0.55, LENGTH],
  [-0.9, 0.3, LENGTH],
];
const sideGlass = [
  [-0.78, 0.68, 1.1],
  [-0.66, 1.1, 1.6],
  [-0.66, 1.1, 2.6],
  [-0.78, 0.6, 3],
];
const lamp = [
  [-0.75, hoodY(3.6), 3.6],
  [-0.35, hoodY(3.6), 3.6],
  [-0.35, hoodY(3.95), 3.95],
  [-0.75, hoodY(3.95), 3.95],
];
const back = (x, y1, y2) => [
  [-x, y1, -0.01],
  [x, y1, -0.01],
  [x, y2, -0.01],
  [-x, y2, -0.01],
];

/*
  Grupos desenhados nesta ordem (rodas → carroceria → vidros → teto →
  detalhes). Como a câmera está sempre atrás e acima, essa ordem já
  resolve quase toda a sobreposição; dentro de cada grupo as faces são
  ordenadas pela distância (ver render).
*/
const MODEL = [
  [
    "car-wheel",
    [
      ...box(-0.92, -0.6, 0, 0.62, 0.5, 1.2),
      ...box(0.6, 0.92, 0, 0.62, 0.5, 1.2),
      ...box(-0.92, -0.6, 0, 0.62, 3, 3.7),
      ...box(0.6, 0.92, 0, 0.62, 3, 3.7),
    ],
  ],
  [
    "car-body",
    [
      [
        [-0.9, 0.25, 0],
        [0.9, 0.25, 0],
        [0.9, 0.72, 0],
        [-0.9, 0.72, 0],
      ], // traseira
      [
        [-0.9, 0.72, 0],
        [0.9, 0.72, 0],
        [0.9, 0.55, LENGTH],
        [-0.9, 0.55, LENGTH],
      ], // tampa + capô
      [
        [-0.9, 0.3, LENGTH],
        [0.9, 0.3, LENGTH],
        [0.9, 0.55, LENGTH],
        [-0.9, 0.55, LENGTH],
      ], // frente
      sideBody,
      mirror(sideBody),
    ],
  ],
  [
    "car-glass",
    [
      [
        [-0.78, 0.68, 1.1],
        [0.78, 0.68, 1.1],
        [0.66, 1.1, 1.6],
        [-0.66, 1.1, 1.6],
      ], // vidro traseiro
      [
        [-0.78, 0.6, 3],
        [0.78, 0.6, 3],
        [0.66, 1.1, 2.6],
        [-0.66, 1.1, 2.6],
      ], // para-brisa
      sideGlass,
      mirror(sideGlass),
    ],
  ],
  [
    "car-body",
    [
      [
        [-0.66, 1.1, 1.6],
        [0.66, 1.1, 1.6],
        [0.66, 1.1, 2.6],
        [-0.66, 1.1, 2.6],
      ],
    ],
  ], // teto
  ["car-line", [back(0.22, 0.3, 0.42), lamp, mirror(lamp)]], // placa e faróis escamoteáveis
  ["car-light", [back(0.84, 0.5, 0.62)]], // lanterna em faixa
  [
    "car-body",
    [
      // aerofólio
      ...box(-0.65, -0.58, 0.72, 0.9, 0.15, 0.3),
      ...box(0.58, 0.65, 0.72, 0.9, 0.15, 0.3),
      ...box(-HALF, HALF, 0.9, 0.96, 0.02, 0.38),
    ],
  ],
];

// Cria um <polygon> SVG por face, agrupados em <g> com a classe de estilo.
/* ---------- Rastro dos pneus ---------- */

/*
  Cada roda traseira deixa marcas no plano da estrada. Como a estrada
  "vem" na nossa direção (a mesma animação da grade), as marcas já
  deixadas andam junto com ela — o rastro fica para trás e desenha as
  curvas feitas. Ele fica no começo do SVG, para ser pintado sob o carro.
*/
const trailGroup = document.createElementNS(SVG_NS, "g");
trailGroup.setAttribute("class", "car-trail");
trailGroup.innerHTML = `
  <defs>
    <linearGradient id="trail-fade" gradientUnits="userSpaceOnUse" x1="0" x2="0">
      <stop offset="0" style="stop-color: var(--pink)" stop-opacity="0.9" />
      <stop offset="1" style="stop-color: var(--pink)" stop-opacity="0" />
    </linearGradient>
  </defs>
  <polyline /><polyline />`;
carSvg.prepend(trailGroup);
const trailFade = trailGroup.querySelector("linearGradient");
const trailLines = trailGroup.querySelectorAll("polyline");

const WHEELS = [-0.76, 0.76]; // centro lateral das rodas traseiras (m)
const REAR_AXLE = 0.85; // posição do eixo traseiro, para frente (m)
const trails = WHEELS.map(() => []); // marcas {x, d} de cada roda, da mais antiga à mais nova

function updateTrails(dt) {
  const move = view.roadSpeed * dt;
  trails.forEach((points, i) => {
    for (const point of points) point.d += move; // a estrada traz as marcas
    // Descarta as que já passaram da borda de baixo do chão.
    while (points.length && points[0].d > view.dEnd) points.shift();
    // Uma marca nova a cada ~4px de deslocamento (e não a cada quadro).
    const wheel = onRoad(WHEELS[i], REAR_AXLE);
    const last = points.at(-1);
    if (!last || Math.hypot(wheel.x - last.x, wheel.d - last.d) > 4) {
      points.push(wheel);
    }
  });
}

function renderTrails() {
  trails.forEach((points, i) => {
    const wheel = onRoad(WHEELS[i], REAR_AXLE);
    const screen = [...points, wheel].map((p) => toScreen(p.x, p.d));
    trailLines[i].setAttribute(
      "points",
      screen.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(" "),
    );
  });
  // O gradiente começa opaco nas rodas e some na borda de baixo do chão.
  trailFade.setAttribute("y1", toScreen(0, state.d).sy.toFixed(1));
}

const groups = MODEL.map(([cls, faces]) => {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", cls);
  carSvg.append(g);
  const items = faces.map((face) => {
    const el = document.createElementNS(SVG_NS, "polygon");
    g.append(el);
    return { face, el, dist: 0 };
  });
  return { g, items };
});

// Geometria da cena (medida no CSS) e estado do carro (em px do plano do chão).
const view = { P: 500, cos: 1, sin: 0, k: 1, roadHalf: 0, dMin: 0, dMax: 0 };
const state = { x: 0, d: 0, yaw: 0 }; // lateral, distância até o horizonte, giro (rad)
let tiltTarget = null; // -1..1 vindo do giroscópio; null = usando o teclado
const keys = new Set();
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function measure() {
  const css = getComputedStyle(document.documentElement);
  const tilt =
    (parseFloat(css.getPropertyValue("--floor-tilt")) * Math.PI) / 180;
  // O valor calculado (computed) já vem em px, mesmo vindo de max(500px, 60vh).
  view.P = parseFloat(getComputedStyle(floor).perspective);
  view.cos = Math.cos(tilt);
  view.sin = Math.sin(tilt);

  // Origem do desenho (0,0) no centro do horizonte — o mesmo ponto de fuga
  // (perspective-origin) do chão.
  const { clientWidth: w, clientHeight: h } = carSvg;
  carSvg.setAttribute("viewBox", `${-w / 2} ${-floor.offsetTop} ${w} ${h}`);

  const roadW = road.clientWidth; // largura interna, em px do plano
  view.roadHalf = roadW / 2;
  view.k = (roadW * 0.27) / (2 * HALF); // px por metro: carro ≈ 27% da estrada

  /*
    Até onde o carro pode descer: a traseira não pode passar da barra de
    tarefas. Invertendo a projeção de um ponto do chão (altura 0)
      yTela = d·cos(θ)·P / (P − d·sen(θ))
    descobrimos a distância d no plano que aparece na altura yMax da tela.
  */
  const yMax = floor.offsetHeight - taskbar.offsetHeight - 10;
  view.dMax = (yMax * view.P) / (view.cos * view.P + yMax * view.sin);
  view.dMin = Math.max(LENGTH * DEPTH * view.k + 20, view.dMax * 0.55);
  // Começa um pouco acima do limite de baixo, para o rastro aparecer.
  state.d = state.d
    ? clamp(state.d, view.dMin, view.dMax)
    : view.dMin + (view.dMax - view.dMin) * 0.8;

  // Distância (no plano) da borda de baixo do chão: o rastro termina ali.
  const H = floor.offsetHeight;
  view.dEnd = (H * view.P) / (view.cos * view.P + H * view.sin);
  // Velocidade da estrada, em px do plano por segundo, lida do próprio CSS.
  view.roadSpeed =
    parseFloat(css.getPropertyValue("--grid")) /
    parseFloat(css.getPropertyValue("--loop"));
  trailFade.setAttribute("y2", toScreen(0, view.dEnd).sy.toFixed(1));
}

/*
  Projeção de um vértice do carro na tela, em três passos:
  1) onRoad: gira no eixo vertical (curva) e posiciona no plano da estrada;
  2) toScreen: inclina junto com o chão — o mesmo rotateX(θ) do CSS;
  3) toScreen: perspectiva — quanto mais perto do observador (Z → P), maior.
*/
function onRoad(lx, f) {
  const c = Math.cos(state.yaw);
  const s = Math.sin(state.yaw);
  const fz = f * DEPTH;
  return {
    x: state.x + (lx * c + fz * s) * view.k,
    d: state.d - (fz * c - lx * s) * view.k,
  };
}

function toScreen(x, d, h = 0) {
  const { cos, sin, P } = view;
  const Y = d * cos - h * sin;
  const Z = d * sin + h * cos;
  const scale = P / (P - Z);
  return { sx: x * scale, sy: Y * scale, dist: Math.hypot(x, Y, P - Z) };
}

function project([lx, h, f]) {
  const { x, d } = onRoad(lx, f);
  return toScreen(x, d, h * view.k);
}

function render() {
  for (const { g, items } of groups) {
    for (const item of items) {
      const pts = item.face.map(project);
      item.el.setAttribute(
        "points",
        pts.map((p) => `${p.sx.toFixed(1)},${p.sy.toFixed(1)}`).join(" "),
      );
      item.dist = pts.reduce((sum, p) => sum + p.dist, 0) / pts.length;
    }
    // Algoritmo do pintor: desenha do mais longe para o mais perto, e as
    // faces da frente (preenchidas) cobrem as de trás.
    items.sort((a, b) => b.dist - a.dist);
    g.append(...items.map((item) => item.el));
  }
}

/*
  Quanto o carro (girado) se estende para cada lado do próprio centro,
  em px do plano. Com o carro virado, a quina da frente vai mais longe —
  então o limite lateral muda durante a curva e ele nunca sai da estrada.
*/
function sideExtents() {
  const c = Math.cos(state.yaw);
  const s = Math.sin(state.yaw);
  const xs = [-HALF, HALF].flatMap((lx) =>
    [0, LENGTH * DEPTH].map((f) => (lx * c + f * s) * view.k),
  );
  return [Math.min(...xs), Math.max(...xs)];
}

/*
  requestAnimationFrame chama a função antes de cada quadro da tela
  (~60 vezes por segundo). Usamos o tempo entre quadros (dt) para que a
  velocidade seja a mesma em telas de 60 Hz, 120 Hz, etc.
*/
const MAX_YAW = (14 * Math.PI) / 180;
let lastFrame = performance.now();

function drive(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const before = state.x;
  const speed = view.roadHalf * 1.4; // px do plano por segundo

  if (tiltTarget !== null) {
    // Giroscópio: aproxima suavemente da posição pedida pela inclinação.
    state.x += (tiltTarget * view.roadHalf - state.x) * Math.min(1, dt * 8);
  } else {
    const steer =
      (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
    state.x += steer * speed * dt;
    // ↑ afasta (rumo ao horizonte), ↓ aproxima.
    const throttle =
      (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
    state.d = clamp(
      state.d + throttle * (view.dMax - view.dMin) * dt,
      view.dMin,
      view.dMax,
    );
  }

  const [left, right] = sideExtents();
  state.x = clamp(state.x, -view.roadHalf - left, view.roadHalf - right);

  // Curva: o carro gira conforme a velocidade lateral (até 14°) e
  // volta a ficar reto quando para de virar ou encosta na borda.
  const lateral = clamp((state.x - before) / dt / speed, -1, 1);
  state.yaw += (lateral * MAX_YAW - state.yaw) * Math.min(1, dt * 10);

  updateTrails(dt);
  renderTrails();
  render();
  requestAnimationFrame(drive);
}

const ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
document.addEventListener("keydown", (event) => {
  if (!ARROWS.includes(event.key)) return;
  event.preventDefault(); // evita rolar a página com as setas
  keys.add(event.key);
});
document.addEventListener("keyup", (event) => keys.delete(event.key));
// Se a janela perde o foco com a tecla apertada, o keyup nunca chega.
window.addEventListener("blur", () => keys.clear());
window.addEventListener("resize", measure);

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

measure();
requestAnimationFrame(drive);

/* ---------- Estado inicial ---------- */

focusWindow(document.getElementById("win-welcome"));
