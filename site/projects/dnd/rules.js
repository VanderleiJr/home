/*
  Motor de regras do d&d.exe: só a matemática genérica do D&D 2024.
  Nenhum número de classe, magia ou item mora aqui: tudo isso vem dos
  dados extraídos do livro. Estas funções são "puras" (mesma entrada →
  mesma saída, sem mexer na página), o que deixa testá-las no Node
  (tools/dnd/check.js) sem navegador.
*/
(function (root) {
  "use strict";

  const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

  // Mesmo "normalizar" do extract.js: sem acento, minúsculas, espaço único.
  const norm = (s) =>
    String(s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  // ---------- Atributos ----------

  // Modificador: a cada 2 pontos acima (ou abaixo) de 10, ±1.
  // Math.floor arredonda para baixo também nos negativos (9 → −1).
  const mod = (score) => Math.floor((score - 10) / 2);

  // Bônus de proficiência: +2 no nível 1, +1 a cada 4 níveis (até +6).
  const proficiency = (level) => 2 + Math.floor((level - 1) / 4);

  const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

  // Idiomas iniciais: Comum + dois à escolha da tabela de idiomas padrão.
  const LANGUAGES = 2;

  // Compra de pontos: tudo começa em 8; os valores altos custam mais.
  const POINT_BUDGET = 27;
  const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

  function pointBuy(scores) {
    let spent = 0;
    for (const a of ABILITIES) {
      const cost = POINT_COST[scores[a]];
      if (cost === undefined) return { valid: false, spent: NaN, left: NaN };
      spent += cost;
    }
    return { valid: spent <= POINT_BUDGET, spent, left: POINT_BUDGET - spent };
  }

  // O conjunto padrão vale só se usar cada número da lista uma vez.
  function standardArrayValid(scores) {
    const got = ABILITIES.map((a) => scores[a]).sort((x, y) => y - x);
    return got.every((v, k) => v === STANDARD_ARRAY[k]);
  }

  /*
    4d6, descarta o menor. "random" pode ser trocado (testes usam uma
    sequência fixa); por padrão usa crypto, que é mais uniforme que
    Math.random para dados.
  */
  function d(sides, random) {
    if (random) return 1 + Math.floor(random() * sides);
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return 1 + (buf[0] % sides);
  }
  function roll4d6(random) {
    const dice = [0, 0, 0, 0].map(() => d(6, random));
    const sorted = [...dice].sort((x, y) => x - y);
    return { dice, total: sorted[1] + sorted[2] + sorted[3] };
  }

  /*
    Antecedente: +2 num atributo e +1 em outro, ou +1 em três — sempre
    entre os três que o antecedente lista. bonus = { str: 2, con: 1 }.
  */
  function backgroundBonusValid(bonus, allowed) {
    const entries = Object.entries(bonus).filter(([, v]) => v);
    if (entries.some(([a]) => !allowed.includes(a))) return false;
    const values = entries.map(([, v]) => v).sort();
    return (
      (values.length === 2 && values[0] === 1 && values[1] === 2) ||
      (values.length === 3 && values.every((v) => v === 1))
    );
  }

  /*
    Soma os aumentos na ordem em que foram ganhos. Cada aumento tem o
    seu teto (20 para antecedente e ASI; 30 para Dádivas Épicas): o
    teto limita aquele aumento, não apaga os anteriores.
  */
  function scoresWith(base, increases) {
    const out = { ...base };
    for (const { ability, amount, max = 20 } of increases)
      out[ability] = Math.max(
        out[ability],
        Math.min(max, out[ability] + amount),
      );
    return out;
  }

  // ---------- Combate ----------

  // PV: nível 1 = dado cheio; depois média (metade + 1) ou a rolagem.
  // Cada nível dá no mínimo 1 PV, mesmo com Constituição negativa.
  function hitPoints({ hitDie, level, con, rolls = [], perLevel = 0 }) {
    const avg = hitDie / 2 + 1;
    let hp = Math.max(1, hitDie + con) + perLevel;
    for (let lv = 2; lv <= level; lv++)
      hp += Math.max(1, (rolls[lv - 2] || avg) + con) + perLevel;
    return hp;
  }

  /*
    CA. Com armadura: base + Destreza (limitada pela armadura média).
    Sem armadura: 10 + Destreza, ou a "Defesa sem Armadura" da classe
    (10 + Des + outro atributo) quando ela existir. Escudo soma por cima.
  */
  function armorClass({ armor, shield, scores, unarmored, bonus = 0 }) {
    const dex = mod(scores.dex);
    let ac;
    if (armor) {
      const { base, dex: useDex, maxDex } = armor.ac;
      ac = base + (useDex ? Math.min(dex, maxDex ?? Infinity) : 0);
    } else {
      ac = 10 + dex;
      if (unarmored && (!shield || unarmored.shield !== false))
        ac = Math.max(
          ac,
          10 +
            dex +
            unarmored.abilities.reduce((s, a) => s + mod(scores[a]), 0),
        );
    }
    if (shield) ac += shield.ac.base; // no escudo, "base" é o bônus (+2)
    return ac + bonus;
  }

  // Iniciativa = modificador de Destreza (o talento Alerta soma a proficiência).
  const initiative = (scores, extra = 0) => mod(scores.dex) + extra;

  const spellSaveDC = (prof, abilityMod) => 8 + prof + abilityMod;
  const spellAttack = (prof, abilityMod) => prof + abilityMod;

  /*
    Treinamento lido do texto da classe ("Armas Simples e Marciais",
    "Armaduras Leves, Médias e Escudos"). Vira um conjunto de categorias.
  */
  function armorTraining(text = "") {
    const t = norm(text);
    const set = new Set();
    if (/\bleve/.test(t)) set.add("light");
    if (/\bmedia/.test(t)) set.add("medium");
    if (/\bpesada/.test(t)) set.add("heavy");
    if (/escudo/.test(t)) set.add("shield");
    return set;
  }

  // "Armas Marciais que têm a propriedade Leve": marciais só com aquela
  // propriedade (ou uma delas, "Acuidade ou Leve").
  function weaponProficient(text = "", weapon) {
    const t = norm(text);
    if (weapon.category === "simple") return /simples/.test(t);
    if (!/marcia/.test(t)) return false;
    const m = /propriedade (.+)$/.exec(t);
    if (!m) return true;
    const wanted = m[1].split(/ ou | e |,/).map((s) => s.trim());
    return weapon.properties.some((p) => wanted.includes(norm(p.name)));
  }

  /*
    Ataque com arma: corpo a corpo usa Força; à distância, Destreza;
    Acuidade deixa escolher o maior. A proficiência só soma se o
    personagem for treinado naquela arma.
  */
  function weaponAttack(weapon, scores, prof, proficient) {
    const finesse = weapon.properties.some((p) => p.id === "acuidade");
    const ability = weapon.ranged
      ? "dex"
      : finesse && mod(scores.dex) > mod(scores.str)
        ? "dex"
        : "str";
    const m = mod(scores[ability]);
    return {
      ability,
      attack: m + (proficient ? prof : 0),
      damage: `${weapon.damage.dice}${m ? (m > 0 ? "+" : "") + m : ""}`,
      type: weapon.damage.type,
    };
  }

  // ---------- Progressão da classe ----------

  /*
    A tabela da classe tem colunas diferentes em cada classe ("Fúrias",
    "Truques", "Espaços…"). Aqui cada coluna vira uma chave pelo nome,
    e as de magia viram números: { cantrips, prepared, slots: [...] }.
    "—" conta como 0.
  */
  function num(v) {
    const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  }
  function progressionAt(progression, level) {
    const row = progression.rows.find((r) => r.level === level);
    if (!row) return null;
    const out = { level, proficiency: row.proficiency, features: row.features };
    const values = {};
    progression.columns.forEach((c, k) => (values[c] = row.values[k]));
    out.values = values;
    const slots = [];
    for (const [c, v] of Object.entries(values)) {
      const n = norm(c);
      const circle = /circulo de magia (\d)$/.exec(n);
      if (/^truques/.test(n)) out.cantrips = num(v);
      else if (/magias preparadas/.test(n)) out.prepared = num(v);
      else if (circle) slots[circle[1] - 1] = num(v);
    }
    // Magia de Pacto: "Espaço de Magia" (quantos) + "Círculo de Magia" (qual).
    const pactCount = Object.keys(values).find((c) =>
      /^espacos? de magia$/.test(norm(c)),
    );
    const pactLevel = Object.keys(values).find(
      (c) => norm(c) === "circulo de magia",
    );
    if (pactCount && pactLevel) {
      out.pact = {
        slots: num(values[pactCount]),
        level: num(values[pactLevel]),
      };
      for (let k = 0; k < out.pact.level; k++) slots[k] = 0;
      slots[out.pact.level - 1] = out.pact.slots;
    }
    if (slots.length) out.slots = Array.from(slots, (s) => s || 0);
    return out;
  }

  // Maior círculo com algum espaço: até onde dá para preparar magias.
  const maxSpellLevel = (slots = []) =>
    slots.reduce((m, s, k) => (s > 0 ? k + 1 : m), 0);

  /*
    Conjuração do personagem: da classe ou da subclasse (Cavaleiro
    Místico, Trapaceiro Arcano), com os limites do nível atual.
  */
  function casting(cls, sub, level) {
    if (cls.spellcasting) {
      const at = progressionAt(cls.progression, level);
      return {
        ...cls.spellcasting,
        cantrips: at.cantrips || 0,
        prepared: at.prepared || 0,
        slots: at.slots || [],
        pact: at.pact,
        maxLevel: maxSpellLevel(at.slots),
      };
    }
    const sc = sub?.spellcasting;
    if (!sc) return null;
    const row = [...sc.progression].reverse().find((r) => r.level <= level);
    if (!row) return null;
    // Truques da subclasse: o texto dá o número inicial; a tabela às
    // vezes não tem coluna de truques.
    return {
      ...sc,
      cantrips: row.cantrips ?? sc.cantrips ?? 0,
      prepared: row.prepared,
      slots: row.slots,
      maxLevel: maxSpellLevel(row.slots),
    };
  }

  // Magias sempre preparadas da subclasse até o nível atual (não contam
  // no limite). Listas com vários títulos (Círculo da Terra) usam "pick".
  function grantedSpells(sub, level, pick) {
    const lists = sub?.spellLists || [];
    const list =
      lists.length > 1 ? lists.find((l) => l.title === pick) : lists[0];
    return (list?.rows || [])
      .filter((r) => r.level <= level)
      .flatMap((r) => r.spells.map((s) => s.id));
  }

  /*
    Marcos da classe pelo nome da característica na tabela: em que
    níveis ela ganha subclasse, aumento de atributo, dádiva épica,
    estilo de luta. Os nomes vêm do livro; aqui só o padrão de busca.
  */
  const MILESTONES = {
    subclass: /^subclasse/,
    asi: /^aumento no valor de atributo/,
    epic: /^dadiva epica/,
    style: /^estilo de luta/,
  };
  function milestones(progression) {
    const out = { subclass: [], asi: [], epic: [], style: [] };
    for (const r of progression.rows)
      for (const f of r.features)
        for (const [k, re] of Object.entries(MILESTONES))
          if (re.test(norm(f))) out[k].push(r.level);
    return out;
  }

  // ---------- Escolhas e pré-requisitos ----------

  /*
    Talento: confere nível e atributo mínimo. Outros requisitos em texto
    ("Característica Conjuração") não dá para checar sem interpretar o
    livro: voltam em "notes" para a interface mostrar.
  */
  function featAllowed(feat, { level, scores, taken = [] }) {
    const reasons = [];
    const pre = feat.prerequisite;
    if (taken.includes(feat.id) && !feat.repeatable) reasons.push("taken");
    if (pre?.level && level < pre.level) reasons.push("level");
    if (pre?.abilities) {
      const { any, all, min } = pre.abilities;
      const ok = all
        ? all.every((a) => scores[a] >= min)
        : any.some((a) => scores[a] >= min);
      if (!ok) reasons.push("ability");
    }
    return { ok: !reasons.length, reasons, notes: pre?.other || [] };
  }

  // Perícias da classe: nomes do livro → ids das perícias extraídas.
  function skillIds(names, skills) {
    return names
      .map((n) => skills.find((s) => norm(s.name) === norm(n))?.id)
      .filter(Boolean);
  }

  // Limite de escolha: quantas faltam ou sobram (0 = ok).
  const remaining = (chosen, limit) => limit - chosen.length;

  // ---------- Equipamento inicial ----------

  /*
    Catálogo único de tudo que se compra: armas, armaduras, ferramentas,
    itens e variantes (focos, munição, símbolos). Cada item lembra o seu
    tipo ("kind") para a interface saber o que dá para equipar.
  */
  function catalog(equipment) {
    const out = [];
    const add = (list, kind, group) =>
      (list || []).forEach((i) =>
        out.push({ ...i, kind, ...(group && { group }) }),
      );
    add(equipment.weapons, "weapon");
    add(equipment.armor, "armor");
    add(equipment.tools, "tool");
    add(equipment.gear, "gear");
    for (const [group, list] of Object.entries(equipment.variants || {}))
      add(list, "variant", group);
    return out;
  }

  /*
    O texto do equipamento e o catálogo nem sempre usam o mesmo nome:
    "Roupas de Viagem" × "Roupas, Viagem", "Armadura de Couro" × "Couro",
    "Machadinhas" × "Machadinha". Por isso cada nome vira um conjunto de
    palavras no singular, sem preposições nem o que vem entre parênteses.
  */
  const STOP = new Set(["de", "da", "do", "das", "dos", "e", "a", "o"]);
  const singular = (w) => w.replace(/(oes|aes)$/, "ao").replace(/s$/, "");
  const words = (s) =>
    new Set(
      norm(s.replace(/\(.*?\)/g, ""))
        .replace(/[^a-z0-9 ]/g, " ")
        .split(" ")
        .filter((w) => w && !STOP.has(w))
        .map(singular),
    );
  const contains = (big, small) => [...small].every((w) => big.has(w));

  /*
    "4 Machadinhas, Machado Grande, Kit de Aventureiro e 15 PO" →
    { items: [{ item, qty: 4, text }, …], gold: 15 }. Ordem de busca:
    nome igual; o texto contém o nome inteiro de um item (o maior vence:
    "Couro Batido" antes de "Couro"); uma palavra só dentro de um nome
    ("Fantasias"). "Foco Arcano (orbe)" procura "orbe" nas variantes.
    O que não casar volta com item: null e o texto original.
  */
  function itemsFrom(text, items) {
    const parts = text
      .split(/,\s*|\s+e\s+(?=\d|[A-ZÀ-Ú])/)
      .map((p) => p.trim())
      .filter(Boolean);
    const indexed = items
      .map((i) => ({ i, w: words(i.name) }))
      .sort((x, y) => y.w.size - x.w.size);
    const result = { items: [], gold: 0 };
    for (const part of parts) {
      const gold = /^(\d+)\s*PO$/i.exec(part);
      if (gold) {
        result.gold += Number(gold[1]);
        continue;
      }
      const m = /^(\d+)\s+(.+)$/.exec(part);
      const qty = m ? Number(m[1]) : 1;
      const name = (m ? m[2] : part).replace(/\s+à sua escolha.*$/i, "");
      const inner = /\((.+?)\)/.exec(name)?.[1];
      const w = words(name);
      const same = (want) => (x) =>
        x.w.size === want.size && contains(x.w, want);
      const variants = indexed.filter((x) => x.i.kind === "variant");
      const iw = inner && words(inner);
      const found =
        (iw &&
          (variants.find(same(iw)) ||
            variants.find((x) => contains(x.w, iw)))) ||
        indexed.find(same(w)) ||
        indexed.find((x) => x.w.size && contains(w, x.w)) ||
        (w.size === 1 && indexed.find((x) => contains(x.w, w)));
      result.items.push({ item: found ? found.i : null, qty, text: part });
    }
    return result;
  }

  const api = {
    ABILITIES,
    STANDARD_ARRAY,
    LANGUAGES,
    POINT_BUDGET,
    POINT_COST,
    norm,
    mod,
    proficiency,
    pointBuy,
    standardArrayValid,
    roll4d6,
    backgroundBonusValid,
    scoresWith,
    hitPoints,
    armorClass,
    initiative,
    spellSaveDC,
    spellAttack,
    armorTraining,
    weaponProficient,
    weaponAttack,
    progressionAt,
    maxSpellLevel,
    casting,
    grantedSpells,
    milestones,
    featAllowed,
    skillIds,
    remaining,
    catalog,
    itemsFrom,
  };
  root.Rules = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
