/*
  libras.exe: flashcards para aprender o alfabeto manual e os números
  da Libras (Língua Brasileira de Sinais).

  Este arquivo é só o jogo. Os sinais são feitos por um personagem 3D:
  - avatar.js: o motor (WebGL puro) — corpo, mão articulada, câmera;
  - signs.js: a receita de cada sinal (dedos, polegar, giro, movimento).
  Aqui, cada sinal na tela é um <canvas> que pede ao Avatar para
  desenhar aquele sinal (Avatar.show).

  Jornada, estrelas, recordes e repetição espaçada funcionam como no
  kana.exe (veja ../kana/kana.js), adaptados para dois sentidos:
  ver o sinal e dizer a letra, ou ver a letra e achar o sinal.
*/

// ---------- Textos ----------

// Atalho para as chaves "libras.*" de site/i18n/<idioma>.json.
const t = (key, vars) => i18n.t(`libras.${key}`, vars);

// ---------- Dados: níveis da jornada ----------

// Os níveis da jornada, grupo por grupo; cada grupo fecha com uma revisão.
const GROUPS = {
  static: ["A S E", "B C O", "D G L I", "U V W R", "M N Q", "F P T"],
  moving: ["H K X", "J Y Z Ç"],
  numbers: ["1 2 3 4 5", "6 7 8 9 0"],
};

const CARDS = [];
const LEVELS = [];
for (const [group, rows] of Object.entries(GROUPS)) {
  const groupCards = [];
  for (const row of rows) {
    const cards = row.split(" ").map((id) => ({
      id,
      group,
      kind: group === "numbers" ? "number" : "letter",
    }));
    CARDS.push(...cards);
    groupCards.push(...cards);
    LEVELS.push({ group, cards, review: false, id: row.replaceAll(" ", "") });
  }
  LEVELS.push({
    group,
    cards: groupCards,
    review: true,
    id: `${group}:review`,
  });
}
for (const level of LEVELS) level.questions = level.review ? 20 : 10;

/*
  Um sinal na tela: um <canvas> 2D que o Avatar preenche. "label" é o
  texto para leitores de tela; sem ele, o desenho é decorativo (o
  botão ou a legenda ao redor já dizem o que é).
*/
function signCanvas(
  cardData,
  { label, framing = "hand", interactive = false, canvas } = {},
) {
  if (!Avatar.supported) {
    const note = document.createElement("span");
    note.className = "no-gl";
    note.textContent = t("noWebgl");
    return note;
  }
  canvas ??= document.createElement("canvas");
  canvas.className = "sign";
  if (label) {
    canvas.setAttribute("role", "img");
    canvas.ariaLabel = label;
    canvas.removeAttribute("aria-hidden");
  } else {
    canvas.setAttribute("aria-hidden", "true");
  }
  Avatar.show(canvas, cardData.id, { framing, interactive });
  return canvas;
}

// ---------- Progresso salvo (localStorage) ----------

// Mesmo esquema do kana.exe: estrelas da jornada, recordes e últimas escolhas.
const STORE_KEY = "libras:progress";
let store = { journey: {}, best: {}, settings: null };

try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY));
  if (saved) store = { ...store, ...saved };
} catch {
  // Sem armazenamento (aba anônima, por exemplo): o progresso fica só em memória.
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Falhar em salvar não pode travar o jogo.
  }
}

const starsOf = (index) => store.journey[LEVELS[index].id] ?? 0;
const isUnlocked = (index) => index === 0 || starsOf(index - 1) > 0;
const starText = (stars) => "★".repeat(stars) + "☆".repeat(3 - stars);

function currentLevel() {
  const next = LEVELS.findIndex((_, i) => starsOf(i) === 0);
  return next === -1 ? LEVELS.length - 1 : next;
}

const levelName = (level) =>
  level.review
    ? `${t("review")}: ${t(`groups.${level.group}`)}`
    : level.cards.map((c) => c.id).join(" ");

// ---------- Elementos da página ----------

const $ = (selector) => document.querySelector(selector);
const menu = $(".screen-menu");
const game = $(".screen-game");
const end = $(".screen-end");
const card = $(".card");
const front = $(".card-front");
const back = $(".card-back");
const feedback = $(".feedback");
const choices = $(".choices");
const typing = $(".typing");
const typingInput = typing.querySelector("input");
const groupBoxes = menu.querySelectorAll('[name="groups"]');

/*
  Durante a partida o alfabeto.txt fica borrado (sem "cola"): uma classe
  no <html> liga o blur no CSS, e "inert" tira o conteúdo da janela do
  teclado, do mouse e dos leitores de tela enquanto isso. Só o corpo
  (.window-body): a barra de título segue ativa, então a janela ainda
  pode ser arrastada e minimizada.
*/
const tableWindow = $(".win-table");

function show(screen) {
  for (const s of [menu, game, end]) s.hidden = s !== screen;
  const playing = screen === game;
  document.documentElement.classList.toggle("is-playing", playing);
  tableWindow.querySelector(".window-body").inert = playing;
}

// ---------- Configurações do menu ----------

function readSettings() {
  const form = new FormData(menu);
  return {
    direction: form.get("direction"),
    groups: form.getAll("groups"),
    answer: form.get("answer"),
    lefty: form.has("lefty"),
    character: form.get("character"),
  };
}

if (store.settings) {
  const s = store.settings;
  for (const input of menu.querySelectorAll("input")) {
    if (input.name === "groups") input.checked = s.groups.includes(input.value);
    else if (input.name === "lefty") input.checked = s.lefty;
    else if (s[input.name]) input.checked = input.value === s[input.name];
  }
}

/*
  Personagem e mão: o Avatar troca o boneco de todas as vistas. Para
  canhotos, uma classe no <html> espelha todos os canvas com um único
  transform: scaleX(-1) no CSS — a mão direita vira a esquerda.
*/
function applyLook() {
  const { lefty, character } = readSettings();
  document.documentElement.classList.toggle("is-lefty", lefty);
  Avatar.character(character);
}
applyLook();

const recordKey = (s) => `${s.direction}|${[...s.groups].sort()}|${s.answer}`;

function showRecords() {
  const best = store.best[recordKey(readSettings())] ?? {};
  $("[data-best='timed']").textContent = best.timed ?? 0;
  $("[data-best='streak']").textContent = best.streak ?? 0;
}

menu.addEventListener("change", () => {
  groupBoxes[0].setCustomValidity(
    menu.querySelector('[name="groups"]:checked') ? "" : t("needGroup"),
  );
  applyLook();
  showRecords();
  store.settings = readSettings();
  save();
});

// ---------- O jogo ----------

const TIMED_MS = 60_000;
const PENALTY_MS = 3_000;
let session = null;

menu.addEventListener("submit", (event) => {
  event.preventDefault();
  const mode = event.submitter?.value ?? "journey";
  start(mode, mode === "journey" ? currentLevel() : null);
});

function start(mode, levelIndex = null) {
  const settings = readSettings();
  store.settings = settings;
  save();

  let pool;
  let queue = null;
  if (mode === "journey") {
    const level = LEVELS[levelIndex];
    pool = level.cards;
    queue = buildQueue(level.cards, level.questions);
  } else {
    pool = CARDS.filter((c) => settings.groups.includes(c.group));
  }

  // Ver a letra e achar o sinal só faz sentido com alternativas desenhadas.
  const typed = settings.answer === "type" && settings.direction === "read";

  session = {
    mode,
    settings,
    typed,
    pool,
    queue,
    levelIndex,
    boxes: new Map(),
    current: null,
    score: 0,
    streak: 0,
    maxStreak: 0,
    hits: 0,
    total: 0,
    missed: new Set(),
    locked: false,
    endsAt: performance.now() + TIMED_MS,
    over: false,
  };

  choices.hidden = typed;
  choices.classList.toggle("has-signs", settings.direction === "sign");
  typing.hidden = !typed;
  $(".hud-mode-label").textContent = {
    timed: t("time"),
    endless: t("streak"),
    journey: t("question"),
  }[mode];
  $(".timebar").hidden = mode !== "timed";
  $(".game-level").hidden = mode !== "journey";
  if (mode === "journey") {
    $(".game-level").textContent =
      `${t("level")} ${levelIndex + 1} · ${levelName(LEVELS[levelIndex])}`;
  }
  feedback.textContent = "";
  card.classList.remove("is-flipped", "is-hit", "is-miss");

  show(game);
  next();
  if (mode === "timed") requestAnimationFrame(tick);
}

function buildQueue(cards, size) {
  const queue = [];
  while (queue.length < size) {
    const round = shuffle([...cards]);
    if (round[0] === queue.at(-1)) round.push(round.shift());
    queue.push(...round);
  }
  return queue.slice(0, size);
}

// Sorteio ponderado pelo sistema de Leitner (explicado no kana.js).
function pick() {
  if (session.queue) return session.queue[session.total];
  const options = session.pool.filter((c) => c !== session.current);
  const weights = options.map((c) => 6 - (session.boxes.get(c) ?? 0));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    roll -= weights[i];
    if (roll < 0) return options[i];
  }
  return options.at(-1);
}

// Embaralhamento de Fisher–Yates.
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/*
  Alternativas erradas do mesmo tipo (letra com letra, número com
  número): um "7" entre três letras seria fácil demais. Na jornada,
  só sinais de níveis que você já alcançou.
*/
function distractors(answer) {
  let source = session.pool;
  if (session.mode === "journey") {
    source = LEVELS.slice(0, session.levelIndex + 1).flatMap((l) => l.cards);
  }
  source = [...new Set(source)].filter(
    (c) => c !== answer && c.kind === answer.kind,
  );
  /*
    No primeiro nível só há 2 sinais errados para escolher. Completa com
    os próximos da jornada (CARDS está na ordem dos níveis): o B aparece
    antes do Z, e já serve de prévia do que vem por aí.
  */
  const extra = CARDS.filter(
    (c) => c !== answer && c.kind === answer.kind && !source.includes(c),
  );
  return [...shuffle(source), ...extra].slice(0, 3);
}

/*
  As duas faces da carta reaproveitam sempre os mesmos dois canvas:
  o Avatar só troca o sinal, e a mão "derrete" de uma pose para a outra.
  Na carta dá para arrastar (girar a câmera) e alternar o enquadramento.
*/
const faceCanvas = new Map([
  [front, document.createElement("canvas")],
  [back, document.createElement("canvas")],
]);
let framing = "hand";

function face(target, cardData, showSign, label) {
  target.replaceChildren(
    showSign
      ? signCanvas(cardData, {
          label,
          framing,
          interactive: true,
          canvas: faceCanvas.get(target),
        })
      : document.createTextNode(cardData.id),
  );
}

// Botão 🔍: close na mão ou o personagem inteiro (para ver onde a mão fica).
function toggleFraming() {
  framing = framing === "hand" ? "body" : "hand";
  $("[data-action='zoom']").textContent = t(
    framing === "hand" ? "showBody" : "showHand",
  );
  for (const [target, canvas] of faceCanvas) {
    if (target.contains(canvas))
      signCanvas(
        { id: Avatar.signOf(canvas) },
        { framing, canvas, label: canvas.ariaLabel },
      );
  }
}

function next() {
  if (session.over) return;
  if (session.queue && session.total === session.queue.length) {
    finish();
    return;
  }
  session.current = pick();
  session.locked = false;
  updateHud();

  const reading = session.settings.direction === "read";
  // aria-label genérico: o leitor de tela não pode "soprar" a resposta.
  face(front, session.current, reading, t("signLabel"));
  card.classList.remove("is-flipped", "is-hit", "is-miss");

  if (session.typed) {
    typingInput.value = "";
    typingInput.focus();
    return;
  }
  const options = shuffle([session.current, ...distractors(session.current)]);
  choices.replaceChildren(
    ...options.map((option, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn choice";
      button.dataset.answer = option.id;
      // O número é o atalho de teclado (teclas 1 a 4).
      const key = document.createElement("kbd");
      key.textContent = i + 1;
      if (reading) {
        button.append(key, ` ${option.id}`);
      } else {
        button.ariaLabel = `${t("option")} ${i + 1}`;
        button.append(key, signCanvas(option));
      }
      return button;
    }),
  );
}

/*
  Sinais gêmeos: em Libras estes números usam a mesma mão da letra
  (o contexto é que diferencia), então ao digitar os dois valem. Nas
  alternativas eles nunca se encontram: letra só concorre com letra.
*/
const TWINS = {
  O: "0",
  0: "O",
  V: "2",
  2: "V",
  W: "3",
  3: "W",
  S: "8",
  8: "S",
};

// Aceita minúsculas e espaços sobrando: "ç " vale "Ç".
const accepts = (cardData, given) => {
  const typed = given.trim().toUpperCase();
  return typed === cardData.id || typed === TWINS[cardData.id];
};

function answer(given) {
  if (!session || session.locked || session.over) return;
  session.locked = true;

  const current = session.current;
  const hit = accepts(current, given);
  const box = session.boxes.get(current) ?? 0;

  session.total++;
  if (hit) {
    session.hits++;
    session.streak++;
    session.maxStreak = Math.max(session.maxStreak, session.streak);
    session.score += 10 * combo();
    session.boxes.set(current, Math.min(5, box + 1));
  } else {
    session.streak = 0;
    session.missed.add(current.id);
    if (session.mode === "timed") session.endsAt -= PENALTY_MS;
    session.boxes.set(current, 1);
  }

  // O verso mostra a resposta: a letra (lendo) ou o sinal (sinalizando).
  face(back, current, session.settings.direction === "sign", current.id);
  card.classList.add("is-flipped", hit ? "is-hit" : "is-miss");
  feedback.textContent = hit
    ? `${t("hit")} +${10 * combo()}`
    : `${t("miss")} “${current.id}”`;

  for (const button of choices.children) {
    if (button.dataset.answer === current.id) button.classList.add("is-hit");
    else if (button.dataset.answer === given) button.classList.add("is-miss");
  }

  $(".score").textContent = session.score;
  $(".combo").textContent = `×${combo()}`;
  // Errou? Mais tempo olhando a resposta — e o sinal com movimento roda mais uma vez.
  setTimeout(next, hit ? 650 : 1600);
}

const combo = () => 1 + Math.min(4, Math.floor(session.streak / 5));

function updateHud() {
  $(".score").textContent = session.score;
  $(".combo").textContent = `×${combo()}`;
  if (session.mode === "endless") $(".hud-mode").textContent = session.streak;
  if (session.mode === "journey") {
    $(".hud-mode").textContent = `${session.total + 1}/${session.queue.length}`;
  }
}

function tick(now) {
  if (session.over) return;
  const left = Math.max(0, session.endsAt - now);
  $(".hud-mode").textContent = Math.ceil(left / 1000);
  $(".timebar-fill").style.transform = `scaleX(${left / TIMED_MS})`;
  if (left === 0) finish(t("timeUp"));
  else requestAnimationFrame(tick);
}

// Estrelas pela precisão: 100% = 3, 90% = 2, 70% = 1 (o mínimo para passar).
function rate(hits, total) {
  const accuracy = hits / total;
  if (accuracy === 1) return 3;
  if (accuracy >= 0.9) return 2;
  if (accuracy >= 0.7) return 1;
  return 0;
}

function quit() {
  if (session.mode === "journey") {
    session.over = true;
    show(menu);
  } else {
    finish();
  }
}

function finish(title = t("gameOver")) {
  if (!session || session.over) return;
  session.over = true;

  const isJourney = session.mode === "journey";
  let note = "";
  let canAdvance = false;

  if (isJourney) {
    const i = session.levelIndex;
    const stars = rate(session.hits, session.total);
    const wasLocked = i + 1 < LEVELS.length && !isUnlocked(i + 1);
    store.journey[LEVELS[i].id] = Math.max(starsOf(i), stars);
    save();
    title = stars ? t("levelDone") : t("levelFail");
    canAdvance = stars > 0 && i + 1 < LEVELS.length;
    if (stars && i + 1 === LEVELS.length) note = t("journeyDone");
    else if (wasLocked && stars) note = t("unlocked");
    $(".end-stars").textContent = starText(stars);
    $(".end-stars").ariaLabel = `${stars} ${t("starsOf")}`;
  } else {
    const key = recordKey(session.settings);
    const best = store.best[key] ?? { timed: 0, streak: 0 };
    const newRecord =
      (session.mode === "timed" && session.score > best.timed) ||
      session.maxStreak > best.streak;
    if (session.mode === "timed") {
      best.timed = Math.max(best.timed, session.score);
    }
    best.streak = Math.max(best.streak, session.maxStreak);
    store.best[key] = best;
    save();
    if (newRecord) note = t("newRecord");
  }

  $(".end-title").textContent = title;
  $(".end-stars").hidden = !isJourney;
  $(".end-note").textContent = note;
  $(".end-note").hidden = !note;
  $("[data-action='next-level']").hidden = !canAdvance;
  $("[data-result='score']").textContent = session.score;
  $("[data-result='hits']").textContent = `${session.hits} / ${session.total}`;
  $("[data-result='accuracy']").textContent = session.total
    ? `${Math.round((session.hits / session.total) * 100)}%`
    : "—";
  $("[data-result='streak']").textContent = session.maxStreak;

  // Para revisar: cada sinal errado desenhado com sua letra embaixo.
  const missed = CARDS.filter((c) => session.missed.has(c.id));
  $(".missed").replaceChildren(
    ...(missed.length ? missed.map(signTile) : [t("noneMissed")]),
  );

  show(end);
  showRecords();
  renderJourney();
  $(
    canAdvance ? "[data-action='next-level']" : "[data-action='again']",
  ).focus();
}

// <figure> + <figcaption>: o desenho e a legenda que o identifica.
function signTile(cardData) {
  const figure = document.createElement("figure");
  figure.className = "tile";
  const caption = document.createElement("figcaption");
  caption.textContent = cardData.id;
  figure.append(signCanvas(cardData), caption);
  return figure;
}

// ---------- Entradas: cliques, teclado e digitação ----------

choices.addEventListener("click", (event) => {
  const button = event.target.closest(".choice");
  if (button) answer(button.dataset.answer);
});

typing.addEventListener("submit", (event) => {
  event.preventDefault();
  if (typingInput.value.trim()) answer(typingInput.value);
});

document.addEventListener("keydown", (event) => {
  if (game.hidden) return;
  if (event.key === "Escape") quit();
  const index = Number(event.key) - 1;
  if (!choices.hidden && index >= 0 && index < choices.children.length) {
    choices.children[index].click();
  }
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action], [data-level]");
  if (!target) return;
  if (target.dataset.level) start("journey", Number(target.dataset.level));
  const action = target.dataset.action;
  if (action === "quit") quit();
  if (action === "again") start(session.mode, session.levelIndex);
  if (action === "next-level") start("journey", session.levelIndex + 1);
  if (action === "menu") show(menu);
  if (action === "zoom") toggleFraming();
});

// ---------- Janelas da jornada e do alfabeto ----------

function renderJourney() {
  const sections = [];
  let list;

  LEVELS.forEach((level, i) => {
    if (level.group !== LEVELS[i - 1]?.group) {
      const title = document.createElement("h3");
      title.textContent = t(`groups.${level.group}`);
      list = document.createElement("ol");
      list.className = "levels";
      sections.push(title, list);
    }

    const stars = starsOf(i);
    const unlocked = isUnlocked(i);
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn level";
    button.disabled = !unlocked;
    button.dataset.level = i;
    if (level.review) button.classList.add("is-review");
    if (i === currentLevel()) button.classList.add("is-current");
    button.ariaLabel = `${t("level")} ${i + 1}: ${levelName(level)}, ${
      unlocked ? `${stars} ${t("starsOf")}` : t("locked")
    }`;
    button.innerHTML = `
      <span class="level-number">${i + 1}</span>
      <span class="level-name">${
        level.review ? "📖 " + t("review") : levelName(level)
      }</span>
      <span class="level-stars">${unlocked ? starText(stars) : "🔒"}</span>`;
    item.append(button);
    list.append(item);
  });
  $(".level-map").replaceChildren(...sections);

  const passed = LEVELS.filter((_, i) => starsOf(i) > 0).length;
  const stars = LEVELS.reduce((sum, _, i) => sum + starsOf(i), 0);
  $(".journey-summary").textContent =
    `${t("levelsPassed")}: ${passed} ${t("of")} ${LEVELS.length} · ` +
    `${t("stars")}: ${stars} ${t("of")} ${LEVELS.length * 3}`;

  const current = currentLevel();
  $(".journey-next").textContent =
    `${t("level")} ${current + 1} · ${levelName(LEVELS[current])}`;
}

// Tabela de consulta: todos os sinais, na ordem do alfabeto e dos números.
function renderReference() {
  const order = (c) => (c.kind === "number" ? `~${c.id}` : c.id);
  const sorted = [...CARDS].sort((a, b) =>
    order(a).localeCompare(order(b), "pt-BR"),
  );
  $(".sign-table").replaceChildren(...sorted.map(signTile));
}
renderReference();

i18n.ready.then(() => {
  renderJourney();
  showRecords();
});
