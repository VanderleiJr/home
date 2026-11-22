/*
  kana.exe: flashcards para aprender hiragana e katakana.

  Ideias principais deste arquivo:
  - Os dados são só texto: o katakana é gerado a partir do hiragana
    com uma conta simples sobre o código Unicode de cada caractere.
  - Jornada: os kana são divididos em níveis (uma linha da tabela por
    vez). Cada nível precisa de pelo menos 1 estrela para liberar o
    próximo, e esse progresso fica salvo para sempre no localStorage.
  - Modos livres (contra o tempo e infinito): usam repetição espaçada
    (sistema de Leitner) só durante a partida — cada jogo recomeça do zero.
*/

// ---------- Textos ----------

/*
  Os textos vêm de site/i18n/<idioma>.json, carregados pelo assets/i18n.js.
  Este atalho só acrescenta o prefixo "kana.": t("hit") lê "kana.hit".
*/
const t = (key, vars) => i18n.t(`kana.${key}`, vars);

// ---------- Dados: a tabela de kana ----------

/*
  Cada linha: os kana separados por espaço e a leitura (romaji, sistema
  Hepburn) na mesma ordem. "-" marca uma casa vazia na tabela tradicional
  (não existe "yi" nem "ye" no japonês moderno, por exemplo).
*/
const ROWS = {
  base: [
    ["あ い う え お", "a i u e o"],
    ["か き く け こ", "ka ki ku ke ko"],
    ["さ し す せ そ", "sa shi su se so"],
    ["た ち つ て と", "ta chi tsu te to"],
    ["な に ぬ ね の", "na ni nu ne no"],
    ["は ひ ふ へ ほ", "ha hi fu he ho"],
    ["ま み む め も", "ma mi mu me mo"],
    ["や - ゆ - よ", "ya - yu - yo"],
    ["ら り る れ ろ", "ra ri ru re ro"],
    ["わ - - - を", "wa - - - wo"],
    ["ん - - - -", "n - - - -"],
  ],
  dakuten: [
    ["が ぎ ぐ げ ご", "ga gi gu ge go"],
    ["ざ じ ず ぜ ぞ", "za ji zu ze zo"],
    ["だ ぢ づ で ど", "da ji zu de do"],
    ["ば び ぶ べ ぼ", "ba bi bu be bo"],
    ["ぱ ぴ ぷ ぺ ぽ", "pa pi pu pe po"],
  ],
  yoon: [
    ["きゃ きゅ きょ", "kya kyu kyo"],
    ["しゃ しゅ しょ", "sha shu sho"],
    ["ちゃ ちゅ ちょ", "cha chu cho"],
    ["にゃ にゅ にょ", "nya nyu nyo"],
    ["ひゃ ひゅ ひょ", "hya hyu hyo"],
    ["みゃ みゅ みょ", "mya myu myo"],
    ["りゃ りゅ りょ", "rya ryu ryo"],
    ["ぎゃ ぎゅ ぎょ", "gya gyu gyo"],
    ["じゃ じゅ じょ", "ja ju jo"],
    ["びゃ びゅ びょ", "bya byu byo"],
    ["ぴゃ ぴゅ ぴょ", "pya pyu pyo"],
  ],
};

// Grafias alternativas aceitas no modo digitar (sistemas Kunrei e "de teclado").
const ALT = {
  shi: ["si"],
  chi: ["ti"],
  tsu: ["tu"],
  fu: ["hu"],
  ji: ["zi", "di"],
  zu: ["du"],
  wo: ["o"],
  n: ["nn"],
  sha: ["sya"],
  shu: ["syu"],
  sho: ["syo"],
  cha: ["tya", "cya"],
  chu: ["tyu", "cyu"],
  cho: ["tyo", "cyo"],
  ja: ["zya", "jya"],
  ju: ["zyu", "jyu"],
  jo: ["zyo", "jyo"],
};

/*
  No Unicode, o bloco do katakana é uma cópia do hiragana deslocada
  0x60 (96) posições: あ é U+3042 e ア é U+30A2. Basta somar 0x60
  ao código de cada caractere — inclusive os pequenos ゃゅょ.
*/
const toKatakana = (text) =>
  [...text].map((c) => String.fromCharCode(c.charCodeAt(0) + 0x60)).join("");

/*
  Monta duas listas a partir das linhas:
  - CARDS: todas as cartas, { kana, romaji, script, group };
  - LEVELS: os níveis da jornada, na ordem em que são liberados.
  Linhas curtas se juntam até formar pelo menos 3 kana (わ を + ん viram
  um nível só), e cada grupo termina com um nível de revisão completo.
*/
const CARDS = [];
const LEVELS = [];
for (const script of ["hiragana", "katakana"]) {
  for (const [group, rows] of Object.entries(ROWS)) {
    const groupCards = [];
    let pending = [];
    for (const [kanaRow, romajiRow] of rows) {
      const romaji = romajiRow.split(" ");
      kanaRow.split(" ").forEach((kana, i) => {
        if (kana === "-") return;
        const card = {
          kana: script === "katakana" ? toKatakana(kana) : kana,
          romaji: romaji[i],
          script,
          group,
        };
        CARDS.push(card);
        groupCards.push(card);
        pending.push(card);
      });
      if (pending.length >= 3) {
        LEVELS.push({ script, group, cards: pending, review: false });
        pending = [];
      }
    }
    if (pending.length) {
      LEVELS.push({ script, group, cards: pending, review: false });
    }
    LEVELS.push({ script, group, cards: groupCards, review: true });
  }
}
// Um id estável por nível, usado como chave do progresso salvo.
for (const level of LEVELS) {
  level.id = level.review
    ? `${level.script}:${level.group}:review`
    : level.cards.map((c) => c.kana).join("");
  level.questions = level.review ? 20 : 10;
}

// ---------- Progresso salvo (localStorage) ----------

/*
  localStorage só guarda texto: JSON.stringify transforma o objeto em
  texto e JSON.parse faz o caminho inverso. O try/catch protege contra
  navegadores que bloqueiam o armazenamento (aba anônima, por exemplo):
  o jogo continua funcionando, só não lembra de nada depois.

  O que fica salvo:
  - journey: estrelas de cada nível da jornada (nunca é apagado);
  - best: recordes dos modos livres;
  - settings: as últimas escolhas do menu.
*/
const STORE_KEY = "kana:progress";
let store = { journey: {}, best: {}, settings: null };

try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY));
  if (saved) store = { ...store, ...saved };
  // Versões antigas guardavam o aprendizado dos modos livres; não mais.
  delete store.stats;
} catch {
  // Sem armazenamento: segue com o progresso só em memória.
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Idem: falhar em salvar não pode travar o jogo.
  }
}

const starsOf = (index) => store.journey[LEVELS[index].id] ?? 0;
// O primeiro nível está sempre liberado; os outros, se o anterior tem estrela.
const isUnlocked = (index) => index === 0 || starsOf(index - 1) > 0;
const starText = (stars) => "★".repeat(stars) + "☆".repeat(3 - stars);

// Nível que o botão "continuar" abre: o primeiro ainda sem estrelas.
function currentLevel() {
  const next = LEVELS.findIndex((_, i) => starsOf(i) === 0);
  return next === -1 ? LEVELS.length - 1 : next;
}

// Nome curto do nível: os próprios kana, ou "Revisão: Básicos".
const levelName = (level) =>
  level.review
    ? `${t("review")}: ${t(`groups.${level.group}`)}`
    : level.cards.map((c) => c.kana).join(" ");

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
const drawBox = $(".draw");

/*
  Durante a partida as tabelas de kana ficam borradas (sem "cola"): uma
  classe no <html> liga o blur no CSS, e "inert" tira as janelas do
  teclado e dos leitores de tela enquanto isso.
*/
const kanaWindows = document.querySelectorAll(".win-kana");

function show(screen) {
  for (const s of [menu, game, end]) s.hidden = s !== screen;
  const playing = screen === game;
  document.documentElement.classList.toggle("is-playing", playing);
  for (const win of kanaWindows) win.inert = playing;
}

// ---------- Configurações do menu ----------

function readSettings() {
  const form = new FormData(menu);
  return {
    script: form.get("script"),
    groups: form.getAll("groups"),
    answer: form.get("answer"),
    difficulty: form.get("difficulty"),
  };
}

// Restaura as escolhas da última visita marcando os campos do formulário.
if (store.settings) {
  const { script, groups, answer, difficulty } = store.settings;
  for (const input of menu.querySelectorAll("input")) {
    if (input.name === "groups") input.checked = groups.includes(input.value);
    else if (input.name === "script") input.checked = input.value === script;
    else if (input.name === "answer") input.checked = input.value === answer;
    else if (input.name === "difficulty" && difficulty) {
      input.checked = input.value === difficulty;
    }
  }
}

// Cada combinação de configurações tem seus próprios recordes.
// O desenho não usa o tipo de resposta: guarda por dificuldade.
const recordKey = (s, mode) =>
  `${s.script}|${[...s.groups].sort()}|${
    mode === "draw" ? `draw:${s.difficulty}` : s.answer
  }`;

function showRecords() {
  const best = store.best[recordKey(readSettings())] ?? {};
  $("[data-best='timed']").textContent = best.timed ?? 0;
  $("[data-best='streak']").textContent = best.streak ?? 0;
  const drawn = store.best[recordKey(readSettings(), "draw")] ?? {};
  $("[data-best='draw']").textContent = drawn.streak ?? 0;
}

menu.addEventListener("change", () => {
  // Validação nativa: setCustomValidity marca o campo como inválido.
  groupBoxes[0].setCustomValidity(
    menu.querySelector('[name="groups"]:checked') ? "" : t("needGroup"),
  );
  showRecords();
});

// ---------- O jogo ----------

const TIMED_MS = 60_000;
const PENALTY_MS = 3_000;
let session = null;

/*
  "submit" dispara tanto pelo clique quanto pelo Enter. event.submitter
  diz qual dos botões de modo foi usado. O botão da jornada tem
  formnovalidate: ela não depende dos grupos marcados no modo livre.
*/
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
    pool = CARDS.filter(
      (c) =>
        (settings.script === "both" || c.script === settings.script) &&
        settings.groups.includes(c.group),
    );
  }

  session = {
    mode,
    settings,
    pool,
    queue,
    levelIndex,
    // Repetição espaçada só desta partida: some quando ela acaba.
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

  // No desenho não há carta nem resposta: o quadro toma o lugar delas.
  const drawing = mode === "draw";
  choices.hidden = drawing || settings.answer !== "choice";
  typing.hidden = drawing || settings.answer !== "type";
  card.hidden = drawing;
  drawBox.hidden = !drawing;
  game.classList.toggle("is-drawing", drawing);
  $(".hud-mode-label").textContent = {
    timed: t("time"),
    endless: t("streak"),
    draw: t("streak"),
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

/*
  Fila de perguntas da jornada: o nível inteiro embaralhado, repetido
  até completar o número de questões — assim todo kana aparece e
  nenhum se repete duas vezes seguidas.
*/
function buildQueue(cards, size) {
  const queue = [];
  while (queue.length < size) {
    const round = shuffle([...cards]);
    if (round[0] === queue.at(-1)) round.push(round.shift());
    queue.push(...round);
  }
  return queue.slice(0, size);
}

/*
  Sorteio ponderado (modos livres): cada carta recebe um peso
  (6 − caixa), então um kana novo ou errado sai até 6× mais que um que
  você já acertou várias vezes nesta partida. Somamos os pesos,
  sorteamos um número nesse total e andamos pela lista até ele "cair".
*/
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

// Embaralhamento de Fisher–Yates: troca cada posição com outra aleatória.
function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/*
  Três alternativas erradas com leituras diferentes da certa (じ e ぢ
  são ambos "ji"). Na jornada, vêm do nível atual e dos anteriores do
  mesmo alfabeto: nunca aparece um kana que você ainda não estudou.
*/
function distractors(answer) {
  let source = session.pool;
  if (session.mode === "journey") {
    source = LEVELS.slice(0, session.levelIndex + 1)
      .filter((l) => l.script === answer.script)
      .flatMap((l) => l.cards);
  }
  const used = new Set([answer.romaji]);
  const result = [];
  for (const c of shuffle([...source])) {
    if (used.has(c.romaji)) continue;
    used.add(c.romaji);
    result.push(c.romaji);
    if (result.length === 3) break;
  }
  return result;
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

  /*
    A frente da carta só muda enquanto o verso está virado para nós;
    quando ela desvira, o kana novo já está lá.
  */
  front.textContent = session.current.kana;
  card.classList.remove("is-flipped", "is-hit", "is-miss");

  if (session.mode === "draw") {
    setupDrawing(session.current);
  } else if (session.settings.answer === "choice") {
    const options = shuffle([
      session.current.romaji,
      ...distractors(session.current),
    ]);
    choices.replaceChildren(
      ...options.map((romaji, i) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn choice";
        button.dataset.romaji = romaji;
        // O número é o atalho de teclado (teclas 1 a 4).
        button.innerHTML = `<kbd>${i + 1}</kbd> ${romaji}`;
        return button;
      }),
    );
  } else {
    typingInput.value = "";
    typingInput.focus();
  }
}

function accepts(cardData, given) {
  const answer = given.trim().toLowerCase();
  return (
    answer === cardData.romaji || (ALT[cardData.romaji] ?? []).includes(answer)
  );
}

function answer(given) {
  if (!session || session.locked || session.over) return;
  session.locked = true;

  const current = session.current;
  const hit = accepts(current, given);
  score(hit);

  // Vira a carta: o verso mostra a leitura, verde ou vermelho.
  back.textContent = current.romaji;
  card.classList.add("is-flipped", hit ? "is-hit" : "is-miss");
  feedback.textContent = hit
    ? `${t("hit")} +${10 * combo()}`
    : `${t("miss")} “${current.romaji}”`;

  for (const button of choices.children) {
    if (button.dataset.romaji === current.romaji)
      button.classList.add("is-hit");
    else if (button.dataset.romaji === given) button.classList.add("is-miss");
  }

  $(".score").textContent = session.score;
  $(".combo").textContent = `×${combo()}`;
  // Errou? A carta fica virada por mais tempo, para dar tempo de memorizar.
  setTimeout(next, hit ? 550 : 1300);
}

/*
  Conta um acerto ou um erro: pontos, sequência e a caixa de Leitner.
  Serve para todos os modos (a resposta escrita ou o kana desenhado).
*/
function score(hit) {
  const current = session.current;
  const box = session.boxes.get(current) ?? 0;

  session.total++;
  if (hit) {
    session.hits++;
    session.streak++;
    session.maxStreak = Math.max(session.maxStreak, session.streak);
    session.score += 10 * combo();
    // Leitner: acertou, a carta sobe uma caixa (até a 5)…
    session.boxes.set(current, Math.min(5, box + 1));
  } else {
    session.streak = 0;
    session.missed.add(current.kana);
    if (session.mode === "timed") session.endsAt -= PENALTY_MS;
    // …errou, volta para a caixa 1 e passa a aparecer mais.
    session.boxes.set(current, 1);
  }
}

// Multiplicador: sobe 1 a cada 5 acertos seguidos, até ×5.
const combo = () => 1 + Math.min(4, Math.floor(session.streak / 5));

function updateHud() {
  $(".score").textContent = session.score;
  $(".combo").textContent = `×${combo()}`;
  if (session.mode === "endless" || session.mode === "draw") {
    $(".hud-mode").textContent = session.streak;
  }
  if (session.mode === "journey") {
    $(".hud-mode").textContent = `${session.total + 1}/${session.queue.length}`;
  }
}

/*
  O relógio usa requestAnimationFrame (que roda a cada quadro de tela)
  e compara com performance.now(): a conta é feita pela hora real, então
  o tempo não "atrasa" mesmo se o navegador pular quadros.
*/
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

// Sair no meio de um nível não conta: nada é salvo, volta ao menu.
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
    // Guarda só a melhor nota: jogar de novo nunca piora o progresso.
    store.journey[LEVELS[i].id] = Math.max(starsOf(i), stars);
    save();
    title = stars ? t("levelDone") : t("levelFail");
    canAdvance = stars > 0 && i + 1 < LEVELS.length;
    if (stars && i + 1 === LEVELS.length) note = t("journeyDone");
    else if (wasLocked && stars) note = t("unlocked");
    $(".end-stars").textContent = starText(stars);
    $(".end-stars").ariaLabel = `${stars} ${t("starsOf")}`;
  } else {
    // Recordes: só sobrescreve se o novo valor for maior.
    const key = recordKey(session.settings, session.mode);
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
  $(".missed").textContent = session.missed.size
    ? [...session.missed].join(" ")
    : t("noneMissed");

  show(end);
  showRecords();
  renderJourney();
  $(
    canAdvance ? "[data-action='next-level']" : "[data-action='again']",
  ).focus();
}

// ---------- Entradas: cliques, teclado e digitação ----------

choices.addEventListener("click", (event) => {
  const button = event.target.closest(".choice");
  if (button) answer(button.dataset.romaji);
});

typing.addEventListener("submit", (event) => {
  event.preventDefault();
  if (typingInput.value.trim()) answer(typingInput.value);
});

document.addEventListener("keydown", (event) => {
  if (game.hidden) return;
  if (event.key === "Escape") quit();
  // Ctrl+Z (ou ⌘+Z no Mac) desfaz o último traço, como num editor.
  const hard = !drawBox.hidden && session.settings.difficulty === "hard";
  // Enter confere o kana (ou passa para o próximo, depois de conferir).
  if (hard && event.key === "Enter") {
    event.preventDefault();
    $("[data-action='next-kana']").hidden ? checkHard() : next();
  }
  if (hard && (event.ctrlKey || event.metaKey) && event.key === "z") {
    event.preventDefault();
    undoStroke();
  }
  // Teclas 1–4 escolhem a alternativa correspondente.
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
  if (action === "replay") animateStrokes($(".draw-ref-svg svg"));
  if (action === "undo") undoStroke();
  if (action === "check") checkHard();
  if (action === "next-kana") next();
  if (action === "clear") clearStrokes();
  // Pular conta como erro: o kana vai para a lista "para revisar".
  if (action === "skip" && !session.locked) {
    session.locked = true;
    score(false);
    feedback.textContent = `${t("miss")} “${session.current.kana}”`;
    updateHud();
    setTimeout(next, 1200);
  }
});

// ---------- Janela da jornada: o mapa de níveis ----------

function renderJourney() {
  const map = $(".level-map");
  const sections = [];
  let section;
  let list;

  LEVELS.forEach((level, i) => {
    // Um título a cada troca de alfabeto e uma lista a cada troca de grupo.
    const previous = LEVELS[i - 1];
    if (level.script !== previous?.script) {
      const title = document.createElement("h3");
      title.textContent = t(`scripts.${level.script}`);
      sections.push(title);
    }
    if (level.group !== previous?.group || level.script !== previous?.script) {
      section = document.createElement("section");
      const title = document.createElement("h4");
      title.textContent = t(`groups.${level.group}`);
      // <ol>: a ordem dos níveis importa, então a lista é numerada.
      list = document.createElement("ol");
      list.className = "levels";
      section.append(title, list);
      sections.push(section);
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
      <span class="level-name" lang="ja">${
        level.review ? "📖 " + t("review") : levelName(level)
      }</span>
      <span class="level-stars">${unlocked ? starText(stars) : "🔒"}</span>`;
    item.append(button);
    list.append(item);
  });
  map.replaceChildren(...sections);

  const passed = LEVELS.filter((_, i) => starsOf(i) > 0).length;
  const stars = LEVELS.reduce((sum, _, i) => sum + starsOf(i), 0);
  $(".journey-summary").textContent =
    `${t("levelsPassed")}: ${passed} ${t("of")} ${LEVELS.length} · ` +
    `${t("stars")}: ${stars} ${t("of")} ${LEVELS.length * 3}`;

  // Botão "continuar" do menu aponta para o nível atual.
  const current = currentLevel();
  $(".journey-next").textContent =
    `${t("level")} ${current + 1} · ${levelName(LEVELS[current])}`;
}

// ---------- Referência dos traços (modo desenho) ----------

/*
  Os traços vêm de strokes.js (KanjiVG): cada um é o "d" de um <path>
  numa caixa de 109×109. SVG é vetor: a mesma referência fica nítida em
  qualquer tamanho de tela, e o CSS consegue animar cada traço.
*/
const SVG_NS = "http://www.w3.org/2000/svg";
const BOX = 109;

// SVG não é HTML: precisa de createElementNS com o "namespace" do SVG.
function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    node.setAttribute(name, value);
  }
  return node;
}

/*
  Monta a referência de um kana (ou dois, nos combinados: き + ゃ ficam em
  células lado a lado). Duas camadas: embaixo o kana inteiro em cinza,
  em cima os mesmos traços que a animação "escreve" um por um.
  pathLength="1" faz todo traço medir 1, seja curto ou longo; assim
  stroke-dasharray/stroke-dashoffset de 1 servem para todos (veja o CSS).
*/
function strokeSvg(text) {
  const chars = [...text];
  const svg = svgEl("svg", {
    viewBox: `0 0 ${BOX * chars.length} ${BOX}`,
    class: "strokes",
    role: "img",
    "aria-label": text,
  });
  // Dois kana = SVG reduzido à metade: o CSS compensa nos números.
  svg.style.setProperty("--cells", chars.length);
  let order = 0;
  chars.forEach((char, cell) => {
    const ghost = svgEl("g", { class: "strokes-ghost" });
    const ink = svgEl("g", { class: "strokes-ink" });
    const numbers = svgEl("g", { class: "strokes-numbers" });
    for (const g of [ghost, ink, numbers]) {
      g.setAttribute("transform", `translate(${cell * BOX} 0)`);
    }
    STROKES[char].forEach(([d, x, y], i) => {
      ghost.append(svgEl("path", { d }));
      const path = svgEl("path", { d, pathLength: 1 });
      // --i: posição na fila da animação (continua contando no 2º kana).
      path.style.setProperty("--i", order++);
      ink.append(path);
      // x, y: onde o KanjiVG põe o número, sem encavalar com os traços.
      const label = svgEl("text", { x, y });
      label.textContent = i + 1;
      numbers.append(label);
    });
    svg.append(ghost, ink, numbers);
  });
  return svg;
}

/*
  Recomeça a animação: tirar a classe, forçar o navegador a recalcular o
  estilo (ler um tamanho faz isso) e pôr de volta.
*/
function animateStrokes(svg) {
  svg.classList.remove("is-animating");
  svg.getBoundingClientRect();
  svg.classList.add("is-animating");
}

// ---------- Modo desenho: captura da escrita ----------

/*
  O quadro é um <canvas>: uma imagem em que o JS pinta pixel a pixel.
  Os traços ficam guardados como listas de pontos nas mesmas unidades
  do KanjiVG (cada célula mede 109×109). Assim eles não dependem do
  tamanho do quadro na tela e podem ser comparados direto com a
  referência (etapa 3).
*/
const canvas = $(".draw-canvas");
const ctx = canvas.getContext("2d");
const ink = {
  cells: 1, // 1 kana, ou 2 nos combinados (き + ゃ)
  strokes: [], // traços prontos: [[x, y, espessura], …]
  current: null, // traço sendo feito: { id do ponteiro, pontos }
  expected: [], // traços da referência, já em pontos (draw.js)
  accepted: [], // traços aceitos: { points, index }
  flash: null, // traço errado, pintado de vermelho por um instante
  misses: 0, // erros neste kana (fácil: 0 = acerto)
  tries: [], // erros em cada traço (3 seguidos = mostra a dica)
  colors: [], // difícil: cor de cada traço depois de conferir
  penSeen: false, // já apareceu uma caneta? (rejeição da palma)
};

function setupDrawing(cardData) {
  ink.cells = [...cardData.kana].length;
  ink.strokes = [];
  ink.current = null;
  ink.expected = Draw.expectedStrokes(cardData.kana, STROKES);
  ink.accepted = [];
  ink.flash = null;
  ink.misses = 0;
  ink.tries = ink.expected.map(() => 0);
  // --cells muda a proporção do quadro (aspect-ratio) no CSS.
  drawBox.style.setProperty("--cells", ink.cells);
  $(".draw-romaji").textContent = cardData.romaji;
  $(".draw-ref-svg").replaceChildren(strokeSvg(cardData.kana));
  const hard = session.settings.difficulty === "hard";
  ink.colors = [];
  $("[data-action='undo']").hidden = !hard;
  $("[data-action='clear']").hidden = !hard;
  $("[data-action='check']").hidden = !hard;
  $("[data-action='next-kana']").hidden = true;
  $("[data-action='skip']").hidden = false;
  resizeCanvas();
}

/*
  O canvas tem dois tamanhos: o do CSS (na tela) e o interno, em pixels.
  Telas de tablet e celular têm mais pixels físicos que pixels CSS
  (devicePixelRatio 2 ou 3): o interno é multiplicado por ele para o
  traço sair nítido, e não borrado.
*/
function resizeCanvas() {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width) return;
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  redraw();
}

// ResizeObserver avisa quando o quadro muda de tamanho (girar o tablet).
new ResizeObserver(resizeCanvas).observe(canvas);

function redraw() {
  /*
    setTransform aplica uma escala a tudo o que for pintado depois:
    o código desenha em unidades do KanjiVG e o canvas converte.
  */
  const scale = canvas.width / (BOX * ink.cells);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, BOX * ink.cells, BOX);
  drawGuides();
  ink.strokes.forEach((points, i) => drawStroke(points, ink.colors[i]));
  if (ink.flash) drawStroke(ink.flash, "#d0216b");
}

function drawStroke(points, color = "#000") {
  drawDot(points[0], color);
  for (let i = 1; i < points.length; i++) {
    drawSegment(points[i - 1], points[i], color);
  }
}

/*
  Guias do papel quadriculado japonês (genkō yōshi): uma cruz
  tracejada no meio de cada célula ajuda a acertar proporção e posição.
*/
function drawGuides() {
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = "#d8c4f0";
  for (let cell = 0; cell < ink.cells; cell++) {
    const left = cell * BOX;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(left + BOX / 2, 0);
    ctx.lineTo(left + BOX / 2, BOX);
    ctx.moveTo(left, BOX / 2);
    ctx.lineTo(left + BOX, BOX / 2);
    ctx.stroke();
    if (cell) {
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(left, 0);
      ctx.lineTo(left, BOX);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
}

// Cada pedaço do traço tem a espessura média das duas pontas.
function drawSegment([x1, y1, w1], [x2, y2, w2], color = "#000") {
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = (w1 + w2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Um toque sem arrastar ainda deixa uma marca: um ponto redondo.
function drawDot([x, y, w], color = "#000") {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, w / 2, 0, Math.PI * 2);
  ctx.fill();
}

/*
  Posição do ponteiro em unidades do KanjiVG, mais a espessura. Só a
  caneta mede a força de verdade (pressure de 0 a 1); mouse e dedo
  ficam no meio-termo, 0.5.
*/
function toPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const pressure = event.pointerType === "pen" ? event.pressure : 0.5;
  return [
    ((event.clientX - rect.left) / rect.width) * BOX * ink.cells,
    ((event.clientY - rect.top) / rect.height) * BOX,
    3 + 4 * pressure,
  ];
}

/*
  Pointer Events: um só conjunto de eventos para mouse, dedo e caneta
  (event.pointerType diz qual). No CSS, touch-action: none impede que
  o navegador use o arraste para rolar ou dar zoom na página.
*/
canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "pen") ink.penSeen = true;
  /*
    Rejeição da palma: quem escreve com caneta apoia a mão na tela, e
    cada apoio vira um toque. Depois que a caneta aparece, toques de
    dedo são ignorados.
  */
  if (ink.penSeen && event.pointerType === "touch") return;
  // locked: entre um kana e outro o quadro não aceita traços.
  if (ink.current || event.button > 0 || session.locked) return;
  event.preventDefault();
  // A captura mantém os eventos aqui mesmo se o traço sair do quadro.
  canvas.setPointerCapture(event.pointerId);
  const point = toPoint(event);
  ink.current = { id: event.pointerId, points: [point] };
  ink.strokes.push(ink.current.points);
  drawDot(point);
});

canvas.addEventListener("pointermove", (event) => {
  if (ink.current?.id !== event.pointerId) return;
  /*
    O navegador entrega no máximo um pointermove por quadro de tela,
    mas a caneta mede bem mais vezes por segundo. getCoalescedEvents()
    devolve as medidas do meio: o traço fica liso, sem "quinas".
  */
  const events = event.getCoalescedEvents?.() ?? [];
  const { points } = ink.current;
  for (const e of events.length ? events : [event]) {
    const point = toPoint(e);
    drawSegment(points.at(-1), point);
    points.push(point);
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (ink.current?.id !== event.pointerId) return;
  const { points } = ink.current;
  ink.current = null;
  if (session.settings.difficulty === "easy") checkEasy(points);
});

/*
  Modo fácil: cada traço é conferido assim que a caneta sai da tela.
  Certo, fica; errado, pisca em vermelho e some, e o aviso diz o
  motivo. Três erros no mesmo traço: a referência mostra só ele.
*/
function checkEasy(points) {
  const index = ink.accepted.length;
  const check = Draw.checkStroke(points, ink.expected, index, ink.accepted);
  if (check.result === "ok") {
    ink.accepted.push({ points, index });
    feedback.textContent = "";
    hintStroke(null);
    if (ink.accepted.length === ink.expected.length) drawingDone();
    return;
  }

  ink.misses++;
  ink.tries[index]++;
  ink.strokes.pop();
  ink.flash = points;
  redraw();
  setTimeout(() => {
    if (ink.flash !== points) return;
    ink.flash = null;
    redraw();
  }, 500);
  feedback.textContent = t(`stroke.${check.result}`, {
    n: index + 1,
    other: (check.other ?? 0) + 1,
  });
  if (ink.tries[index] >= 3) hintStroke(index);
}

// Destaca (e repete a animação de) um traço da referência; null apaga.
function hintStroke(index) {
  const paths = drawBox.querySelectorAll(".strokes-ink path");
  paths.forEach((path, i) => path.classList.toggle("is-hint", i === index));
}

/*
  Kana completo. No fácil é acerto só se não houve nenhum erro; com
  erros ele conta como errado e vai para a lista "para revisar".
*/
function drawingDone() {
  session.locked = true;
  const hit = ink.misses === 0;
  score(hit);
  feedback.textContent = hit
    ? `${t("hit")} +${10 * combo()}`
    : t("drawMisses", { n: ink.misses });
  updateHud();
  setTimeout(next, hit ? 700 : 1500);
}

// O sistema cancelou o traço (um gesto, uma notificação): ele é descartado.
canvas.addEventListener("pointercancel", (event) => {
  if (ink.current?.id !== event.pointerId) return;
  ink.strokes.pop();
  ink.current = null;
  redraw();
});

/*
  Modo difícil: nada é conferido durante a escrita. Em "Conferir", o
  kana inteiro é comparado de uma vez (Draw.checkAll): cada traço fica
  verde ou vermelho e o aviso lista o que deu errado — quantidade de
  traços, ordem, direção, forma.
*/
function checkHard() {
  if (session.locked || ink.current || !ink.strokes.length) return;
  session.locked = true;
  const check = Draw.checkAll(ink.strokes, ink.expected);
  ink.colors = check.results.map((r) =>
    r.result === "ok" ? "#0a8f5a" : "#d0216b",
  );
  redraw();
  score(check.ok);
  updateHud();
  // Conferido, não dá mais para mexer: só ver o resultado.
  for (const action of ["check", "undo", "clear"]) {
    $(`[data-action='${action}']`).hidden = true;
  }

  if (check.ok) {
    feedback.textContent = `${t("hit")} +${10 * combo()}`;
    setTimeout(next, 900);
    return;
  }
  const [drawn, wanted] = check.count;
  const problems = check.results.flatMap((r, i) =>
    r.result === "ok"
      ? []
      : [t(`report.${r.result}`, { n: i + 1, other: (r.other ?? 0) + 1 })],
  );
  if (drawn !== wanted) {
    problems.unshift(t("report.count", { drawn, wanted }));
  }
  feedback.textContent = `✘ ${problems.join(" · ")}`;
  // Errou: espera a pessoa comparar com a referência e pedir o próximo.
  $("[data-action='skip']").hidden = true;
  $("[data-action='next-kana']").hidden = false;
  $("[data-action='next-kana']").focus();
}

function undoStroke() {
  if (ink.current || session.locked) return;
  const points = ink.strokes.pop();
  ink.accepted = ink.accepted.filter((a) => a.points !== points);
  redraw();
}

function clearStrokes() {
  if (ink.current || session.locked) return;
  ink.strokes = [];
  ink.accepted = [];
  redraw();
}

// ---------- Janelas dos alfabetos: tabelas de consulta ----------

/*
  Cada grupo vira uma grade com uma coluna por vogal (5 nos básicos e
  dakuten, 3 nos combinados). As casas vazias ("-") continuam lá, só
  que invisíveis: é isso que mantém や ゆ よ nas colunas de a, u e o.
*/
function renderTable(win) {
  const script = win.dataset.script;
  const sections = Object.entries(ROWS).map(([group, rows]) => {
    const section = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = t(`groups.${group}`);
    const grid = document.createElement("div");
    grid.className = "kana-grid";
    // Variável CSS por elemento: o mesmo CSS serve para 5 ou 3 colunas.
    grid.style.setProperty("--columns", rows[0][0].split(" ").length);
    for (const [kanaRow, romajiRow] of rows) {
      const romaji = romajiRow.split(" ");
      kanaRow.split(" ").forEach((kana, i) => {
        const cell = document.createElement("p");
        cell.className = "kana-cell";
        if (kana === "-") {
          cell.classList.add("is-empty");
          cell.ariaHidden = "true";
        } else {
          const glyph = script === "katakana" ? toKatakana(kana) : kana;
          cell.innerHTML = `<span lang="ja">${glyph}</span> <small>${romaji[i]}</small>`;
        }
        grid.append(cell);
      });
    }
    section.append(title, grid);
    return section;
  });
  win.querySelector(".kana-table").replaceChildren(...sections);
}

// Só monta o que tem texto depois que a tradução estiver pronta.
i18n.ready.then(() => {
  renderJourney();
  showRecords();
  kanaWindows.forEach(renderTable);
});
