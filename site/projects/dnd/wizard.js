/*
  Assistente do d&d.exe: guarda as escolhas do personagem e desenha uma
  etapa por vez. O livro nunca aparece "cru": os dados extraídos viram
  opções (o que dá para escolher), limites (quantas) e números (PV, CA).
  Texto de regra só sob demanda, dentro de um <details>.

  Fluxo: toda mudança passa por update() → recalcula tudo (derive) →
  redesenha a etapa e o resumo. Recalcular do zero é simples e barato
  aqui, e evita que um número fique desatualizado.
*/

/*
  Monta elementos com uma função curta: el("p", { className: "x" }, "texto").
  Tudo vira nó do DOM com textContent, nunca innerHTML: o texto vem de um
  PDF, e assim nada nele pode ser interpretado como HTML.
*/
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const [k, v] of Object.entries(props))
    if (k.startsWith("data-") || k.startsWith("aria-")) node.setAttribute(k, v);
  node.append(
    ...children.flat(Infinity).filter((c) => c != null && c !== false),
  );
  return node;
}

const Wizard = (() => {
  const R = Rules;
  const t = (k, v) => i18n.t(`dnd.w.${k}`, v);
  const DRAFT = "dnd-exe:draft";
  const STEPS = [
    "class",
    "origin",
    "abilities",
    "level",
    "spells",
    "equipment",
  ];

  let data = null; // livros juntados (DND.merge)
  let step = "class";
  let c = blank(); // o personagem: só escolhas, nada calculado
  let panel, summaryBox, stepButtons;

  function blank() {
    return {
      class: null,
      subclass: null,
      level: 1,
      skills: [],
      background: null,
      bonusMode: "2-1",
      bonus: {},
      bgOption: null, // opção fixada pelo antecedente ("Clérigo")
      featPicks: {}, // escolhas dentro de talentos: { "<onde>": [...] }
      species: null,
      size: null,
      traits: {},
      speciesFeat: null,
      speciesSkills: [],
      languages: [],
      method: "standard",
      assign: {}, // atributo → índice no conjunto (padrão ou rolagens)
      points: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
      rolls: [],
      feats: {}, // nível → { id, asi: ["str", "str"] }
      style: null,
      masteries: [],
      options: {}, // grupo (invocações…) → [ids]
      hpMethod: "average",
      hpRolls: {},
      landList: null,
      cantrips: [],
      spells: [],
      classGear: "A",
      bgGear: "A",
      bought: [],
      armor: null,
      shield: false,
    };
  }

  // ---------- Guardar o rascunho (só neste navegador) ----------

  // localStorage pode faltar (aba anônima, bloqueado): sem ele o
  // assistente funciona igual, só não lembra na próxima visita.
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT, JSON.stringify({ step, c }));
    } catch {}
  }
  function loadDraft() {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT));
      if (saved?.c) {
        c = { ...blank(), ...saved.c };
        step = STEPS.includes(saved.step) ? saved.step : "class";
      }
    } catch {}
  }

  // ---------- Cálculo: das escolhas para a ficha ----------

  const byId = (list, id) => list.find((x) => x.id === id);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

  function baseScores() {
    if (c.method === "pointbuy") return { ...c.points };
    const pool = c.method === "roll" ? c.rolls : R.STANDARD_ARRAY;
    const out = {};
    for (const a of R.ABILITIES) out[a] = pool[c.assign[a]] ?? 8;
    return out;
  }

  // Talentos ganhos em ordem: origem (antecedente), espécie, nível a nível.
  function featList(d) {
    const out = [];
    if (d.bg?.feat)
      out.push({ where: "bg", id: d.bg.feat.id, option: d.bg.feat.option });
    if (c.speciesFeat) out.push({ where: "species", id: c.speciesFeat });
    for (const lv of d.featLevels)
      if (c.feats[lv]?.id)
        out.push({ where: lv, id: c.feats[lv].id, asi: c.feats[lv].asi });
    if (c.style) out.push({ where: "style", id: c.style });
    return out
      .map((f) => ({ ...f, feat: byId(data.feats, f.id) }))
      .filter((f) => f.feat);
  }

  function derive() {
    const d = {};
    d.cls = byId(data.classes, c.class);
    d.sub = d.cls && byId(d.cls.subclasses, c.subclass);
    d.bg = byId(data.backgrounds, c.background);
    d.sp = byId(data.species, c.species);
    d.ms = d.cls
      ? R.milestones(d.cls.progression)
      : { subclass: [], asi: [], epic: [], style: [] };
    d.featLevels = [...d.ms.asi, ...d.ms.epic]
      .filter((lv) => lv <= c.level)
      .sort((a, b) => a - b);
    d.base = baseScores();
    // Aumentos na ordem: antecedente (até 20), depois talentos.
    const inc = Object.entries(c.bonus)
      .filter(([, v]) => v)
      .map(([ability, amount]) => ({ ability, amount, max: 20 }));
    d.scoresAt = {}; // atributos antes de cada nível de talento (pré-requisitos)
    let running = R.scoresWith(d.base, inc);
    for (const lv of d.featLevels) {
      d.scoresAt[lv] = running;
      const pick = c.feats[lv];
      const feat = pick && byId(data.feats, pick.id);
      if (feat?.asi)
        running = R.scoresWith(
          running,
          (pick.asi || [])
            .filter(Boolean)
            .map((ability) => ({ ability, amount: 1, max: feat.asi.max })),
        );
    }
    d.scores = running;
    d.mods = Object.fromEntries(
      R.ABILITIES.map((a) => [a, R.mod(d.scores[a])]),
    );
    d.prof = R.proficiency(c.level);
    d.feats = featList(d);
    d.at = d.cls && R.progressionAt(d.cls.progression, c.level);
    d.casting = d.cls && R.casting(d.cls, d.sub, c.level);
    if (d.casting) {
      d.casting.dc = R.spellSaveDC(d.prof, d.mods[d.casting.ability]);
      d.casting.attack = R.spellAttack(d.prof, d.mods[d.casting.ability]);
    }
    d.granted = d.sub ? R.grantedSpells(d.sub, c.level, c.landList) : [];
    d.hp =
      d.cls &&
      R.hitPoints({
        hitDie: d.cls.hitDie,
        level: c.level,
        con: d.mods.con,
        rolls:
          c.hpMethod === "roll"
            ? Array.from({ length: c.level - 1 }, (_, k) => c.hpRolls[k + 2])
            : [],
      });
    // Perícias: classe + antecedente + escolhas de talento/espécie.
    d.skills = new Set([
      ...c.skills,
      ...(d.bg?.skills || []),
      ...c.speciesSkills,
      ...Object.values(c.featPicks)
        .flat()
        .filter((id) => data.skills.some((s) => s.id === id)),
    ]);
    // Equipamento: opção da classe + do antecedente + compras.
    d.catalog = R.catalog(data.equipment);
    const gear = (owner, opt) => {
      const o = owner?.equipment?.find((e) => e.option === opt);
      return o ? R.itemsFrom(o.text, d.catalog) : { items: [], gold: 0 };
    };
    const cg = gear(d.cls, c.classGear);
    const bgg = gear(d.bg, c.bgGear);
    const bought = c.bought
      .map((id) => d.catalog.find((i) => i.id === id))
      .filter(Boolean);
    d.items = [
      ...cg.items,
      ...bgg.items,
      ...bought.map((item) => ({
        item,
        qty: 1,
        text: item.name,
        bought: true,
      })),
    ];
    d.gold = cg.gold + bgg.gold;
    d.spent = bought.reduce((s, i) => s + (i.cost?.cp || 0), 0) / 100;
    d.owned = (kind) =>
      d.items.filter((x) => x.item?.kind === kind).map((x) => x.item);
    d.trained = R.armorTraining(d.cls?.armor);
    const armor = d
      .owned("armor")
      .find((a) => a.id === c.armor && a.category !== "shield");
    const shield =
      c.shield && d.owned("armor").find((a) => a.category === "shield");
    d.armor = armor;
    d.ac = R.armorClass({
      armor,
      shield,
      scores: d.scores,
      unarmored: d.cls?.unarmored,
      // Talentos com bônus de CA (Defensivo: só vestindo armadura).
      bonus: d.feats.reduce(
        (n, f) =>
          n +
          (f.feat.ac && (!f.feat.ac.armored || armor) ? f.feat.ac.bonus : 0),
        0,
      ),
    });
    d.attacks = [
      ...new Map(d.owned("weapon").map((w) => [w.id, w])).values(),
    ].map((w) => ({
      weapon: w,
      ...R.weaponAttack(
        w,
        d.scores,
        d.prof,
        R.weaponProficient(d.cls?.weapons, w),
      ),
    }));
    d.pending = pending(d);
    return d;
  }

  // Quantos itens de cada grupo de opções (invocações…) a tabela permite.
  function optionLimit(d, group) {
    if (!d.at) return null;
    const first = R.norm(group.name).split(" ")[0];
    const col = Object.keys(d.at.values).find((k) =>
      R.norm(k).startsWith(first),
    );
    return col ? parseInt(d.at.values[col], 10) || 0 : null;
  }

  function masteryLimit(d) {
    if (!d.at) return 0;
    const col = Object.keys(d.at.values).find((k) =>
      /^maestria/.test(R.norm(k)),
    );
    return col ? parseInt(d.at.values[col], 10) || 0 : 0;
  }

  // Listas de magias de um talento (Iniciado em Magia): o antecedente
  // pode fixar uma ("Clérigo"); senão, a pessoa escolhe.
  function featSpellList(f) {
    if (f.option) return R.norm(f.option).replace(/\s+/g, "-");
    return c.featPicks[`${f.where}:list`]?.[0] || null;
  }

  /*
    Pendências: o que falta escolher (ou passou do limite). Cada uma
    aponta a etapa, para o resumo virar uma lista de atalhos.
  */
  function pending(d) {
    const out = [];
    const need = (stepId, text) => out.push({ step: stepId, text });
    const limit = (stepId, label, chosen, max) => {
      const left = R.remaining(chosen, max);
      if (left > 0) need(stepId, t("pickMore", { n: left, what: label }));
      if (left < 0) need(stepId, t("pickLess", { n: -left, what: label }));
    };
    if (!d.cls) need("class", t("needClass"));
    else limit("class", t("skills"), c.skills, d.cls.skills.choose);
    if (!d.bg) need("origin", t("needBackground"));
    else if (!R.backgroundBonusValid(c.bonus, d.bg.abilities))
      need("origin", t("needBonus"));
    if (!d.sp) need("origin", t("needSpecies"));
    else {
      if (d.sp.sizes.length > 1 && !c.size) need("origin", t("needSize"));
      for (const tr of d.sp.traits)
        if (tr.options && !c.traits[tr.name])
          need("origin", t("needTrait", { name: tr.name }));
      for (const tr of d.sp.traits) {
        if (tr.grants?.feat && !c.speciesFeat)
          need("origin", t("needFeat", { name: tr.name }));
        if (tr.grants?.skills)
          limit("origin", tr.name, c.speciesSkills, tr.grants.skills);
      }
    }
    limit("origin", t("languages"), c.languages, R.LANGUAGES);
    for (const f of d.feats.filter(
      (f) => f.where === "bg" || f.where === "species",
    )) {
      const p = f.feat.proficiencies;
      if (p)
        limit(
          "origin",
          f.feat.name,
          c.featPicks[`${f.where}:prof`] || [],
          p.count,
        );
    }
    if (c.method === "pointbuy") {
      const pb = R.pointBuy(c.points);
      if (!pb.valid) need("abilities", t("overBudget"));
    } else {
      const pool = c.method === "roll" ? c.rolls : R.STANDARD_ARRAY;
      const used = R.ABILITIES.map((a) => c.assign[a]);
      if (pool.length < 6) need("abilities", t("needRolls"));
      else if (used.some((k) => k == null) || new Set(used).size < 6)
        need("abilities", t("needAssign"));
    }
    if (d.cls) {
      if (d.ms.subclass[0] <= c.level && !d.sub)
        need("level", t("needSubclass"));
      for (const lv of d.featLevels) {
        const pick = c.feats[lv];
        const feat = pick && byId(data.feats, pick.id);
        if (!feat) need("level", t("needLevelFeat", { level: lv }));
        else if (
          feat.asi &&
          (pick.asi || []).filter(Boolean).length < asiCount(feat)
        )
          need("level", t("needAsi", { level: lv }));
      }
      if (d.ms.style[0] <= c.level && !c.style) need("level", t("needStyle"));
      const ml = masteryLimit(d);
      if (ml) limit("level", t("masteries"), c.masteries, ml);
      for (const g of d.cls.optionGroups || []) {
        const max = optionLimit(d, g);
        if (max != null) limit("level", g.name, c.options[g.id] || [], max);
      }
      if (c.hpMethod === "roll")
        for (let lv = 2; lv <= c.level; lv++)
          if (!c.hpRolls[lv]) {
            need("level", t("needHpRolls"));
            break;
          }
    }
    if (d.casting) {
      limit("spells", t("cantrips"), c.cantrips, d.casting.cantrips);
      limit("spells", t("prepared"), c.spells, d.casting.prepared);
      if ((d.sub?.spellLists?.length || 0) > 1 && !c.landList)
        need("spells", t("needLand"));
    }
    for (const f of d.feats.filter((f) => f.feat.spells)) {
      if (!featSpellList(f))
        need("spells", t("needFeatList", { name: f.feat.name }));
      limit(
        "spells",
        `${f.feat.name}: ${t("cantrips")}`,
        c.featPicks[`${f.where}:cantrips`] || [],
        f.feat.spells.cantrips,
      );
      limit(
        "spells",
        `${f.feat.name}: ${t("level1")}`,
        c.featPicks[`${f.where}:spells`] || [],
        f.feat.spells.level1,
      );
    }
    if (d.spent > d.gold) need("equipment", t("overGold"));
    if (d.armor && !d.trained.has(d.armor.category))
      need("equipment", t("untrained", { name: d.armor.name }));
    return out;
  }

  // Quantos aumentos +1 um talento dá: [2,1] = dois +1 (ou +2 num só).
  const asiCount = (feat) =>
    feat.asi.amounts.includes(2) ? 2 : feat.asi.amounts[0];

  // ---------- Peças de interface ----------

  let uid = 0;
  const nextId = () => `w-${++uid}`;

  // <select> com rótulo; options = [{ value, label, disabled }].
  function choice(label, options, value, onChange, { id, empty = true } = {}) {
    const sel = el(
      "select",
      { id: id || nextId(), onchange: (e) => onChange(e.target.value || null) },
      empty ? el("option", { value: "" }, t("choose")) : null,
      options.map((o) =>
        el(
          "option",
          {
            value: o.value,
            disabled: !!o.disabled,
            selected: o.value === value,
          },
          o.label,
        ),
      ),
    );
    return el("label", { className: "w-field" }, el("span", {}, label), sel);
  }

  /*
    Caixas de marcar com limite: ao atingir o limite, as não marcadas
    ficam desabilitadas (o limite aparece também na legenda).
  */
  function checks(legend, items, chosen, max, onChange, { name } = {}) {
    const full = max != null && chosen.length >= max;
    return el(
      "fieldset",
      { className: "w-checks" },
      el(
        "legend",
        {},
        legend,
        max != null ? ` (${chosen.length}/${max})` : ` (${chosen.length})`,
      ),
      el(
        "div",
        { className: "w-grid" },
        items.map((it) => {
          const on = chosen.includes(it.value);
          const box = el("input", {
            type: "checkbox",
            id: `${name || "c"}-${it.value}`,
            checked: on,
            disabled: it.disabled || (full && !on),
            onchange: (e) =>
              onChange(
                e.target.checked
                  ? [...chosen, it.value]
                  : chosen.filter((v) => v !== it.value),
              ),
          });
          const row = el("label", { className: "w-check" }, box, " ", it.label);
          return it.more
            ? el("div", { className: "w-item" }, row, it.more)
            : row;
        }),
      ),
    );
  }

  function radios(legend, items, value, onChange, name) {
    return el(
      "fieldset",
      { className: "w-radios" },
      el("legend", {}, legend),
      items.map((it) =>
        el(
          "label",
          { className: "w-check" },
          el("input", {
            type: "radio",
            name,
            id: `${name}-${it.value}`,
            value: it.value,
            checked: it.value === value,
            onchange: () => onChange(it.value),
          }),
          " ",
          it.label,
        ),
      ),
    );
  }

  // Texto do livro só sob demanda: um <details> que abre sem JS.
  const paragraph = (p) =>
    el(
      "p",
      {},
      p.lead ? el("strong", {}, p.lead + " ") : null,
      p.bullet ? "• " : "",
      p.text,
    );
  function more(paragraphs, label = t("details")) {
    if (!paragraphs?.length) return null;
    return el(
      "details",
      { className: "w-more" },
      el("summary", {}, label),
      paragraphs.map(paragraph),
    );
  }

  const signed = (n) => (n >= 0 ? `+${n}` : `−${-n}`);
  const abilityName = (a) => i18n.t(`dnd.ability.${a}`);
  const abilityShort = (a) => i18n.t(`dnd.abilityShort.${a}`);

  // ---------- Etapa 1: classe ----------

  function stepClass(d) {
    const out = [
      el(
        "div",
        { className: "w-cards" },
        data.classes.map((cl) =>
          el(
            "label",
            { className: `w-card${cl.id === c.class ? " is-on" : ""}` },
            el("input", {
              type: "radio",
              name: "class",
              id: `class-${cl.id}`,
              checked: cl.id === c.class,
              onchange: () =>
                update(() => {
                  c.class = cl.id;
                  c.subclass = null;
                  c.skills = [];
                  c.feats = {};
                  c.style = null;
                  c.masteries = [];
                  c.options = {};
                  c.cantrips = [];
                  c.spells = [];
                  c.classGear = "A";
                  c.armor = null;
                }),
            }),
            el("strong", {}, cl.name),
            el(
              "small",
              {},
              `d${cl.hitDie} · ${cl.primaryAbility.map(abilityShort).join("/")}`,
            ),
          ),
        ),
      ),
    ];
    if (!d.cls) return out;
    const cl = d.cls;
    const skillPool = cl.skills.any
      ? data.skills.map((s) => s.id)
      : R.skillIds(cl.skills.from, data.skills);
    out.push(
      el("p", { className: "w-tagline" }, cl.tagline),
      el(
        "dl",
        { className: "w-facts" },
        el("dt", {}, t("hitDie")),
        el("dd", {}, `d${cl.hitDie}`),
        el("dt", {}, t("primary")),
        el("dd", {}, cl.primaryAbility.map(abilityName).join(" / ")),
        el("dt", {}, t("saves")),
        el("dd", {}, cl.savingThrows.map(abilityName).join(", ")),
        el("dt", {}, t("weapons")),
        el("dd", {}, cl.weapons || "—"),
        el("dt", {}, t("armor")),
        el("dd", {}, cl.armor || "—"),
        cl.tools ? [el("dt", {}, t("tools")), el("dd", {}, cl.tools)] : null,
        cl.spellcasting
          ? [
              el("dt", {}, t("casting")),
              el("dd", {}, abilityName(cl.spellcasting.ability)),
            ]
          : null,
      ),
      more(cl.description),
      checks(
        t("classSkills"),
        skillPool.map((id) => {
          const s = byId(data.skills, id);
          const fromBg = d.bg?.skills.includes(id);
          return {
            value: id,
            label: `${s.name} (${abilityShort(s.ability)})${fromBg ? " · " + t("fromBackground") : ""}`,
            disabled: fromBg,
          };
        }),
        c.skills,
        cl.skills.choose,
        (v) => update(() => (c.skills = v)),
        { name: "skill" },
      ),
    );
    return out;
  }

  // ---------- Etapa 2: origem (antecedente, espécie, idiomas) ----------

  function stepOrigin(d) {
    const out = [];
    out.push(
      el("h3", {}, t("background")),
      choice(
        t("background"),
        data.backgrounds.map((b) => ({ value: b.id, label: b.name })),
        c.background,
        (v) =>
          update(() => {
            c.background = v;
            c.bonus = {};
            c.bgGear = "A";
            c.skills = c.skills.filter(
              (s) => !byId(data.backgrounds, v)?.skills.includes(s),
            );
            for (const k of Object.keys(c.featPicks))
              if (k.startsWith("bg:")) delete c.featPicks[k];
          }),
        { id: "bg" },
      ),
    );
    if (d.bg) {
      const bg = d.bg;
      out.push(
        el(
          "dl",
          { className: "w-facts" },
          el("dt", {}, t("feat")),
          el(
            "dd",
            {},
            bg.feat
              ? bg.feat.name + (bg.feat.option ? ` (${bg.feat.option})` : "")
              : "—",
          ),
          el("dt", {}, t("skills")),
          el(
            "dd",
            {},
            bg.skills.map((id) => byId(data.skills, id)?.name).join(", "),
          ),
          el("dt", {}, t("tools")),
          el("dd", {}, bg.tool || "—"),
        ),
        more(bg.description),
        bonusPicker(bg),
        ...featProficiencies(d, "bg"),
      );
    }
    out.push(
      el("h3", {}, t("species")),
      choice(
        t("species"),
        data.species.map((s) => ({ value: s.id, label: s.name })),
        c.species,
        (v) =>
          update(() => {
            c.species = v;
            c.size = null;
            c.traits = {};
            c.speciesFeat = null;
            c.speciesSkills = [];
            for (const k of Object.keys(c.featPicks))
              if (k.startsWith("species:")) delete c.featPicks[k];
          }),
        { id: "species" },
      ),
    );
    if (d.sp) {
      const sp = d.sp;
      out.push(
        el(
          "dl",
          { className: "w-facts" },
          el("dt", {}, t("type")),
          el("dd", {}, sp.creatureType),
          el("dt", {}, t("speed")),
          el("dd", {}, t("meters", { n: sp.speed })),
        ),
        more(sp.description),
      );
      if (sp.sizes.length > 1)
        out.push(
          choice(
            t("size"),
            sp.sizes.map((s) => ({ value: s, label: s })),
            c.size,
            (v) => update(() => (c.size = v)),
            { id: "size" },
          ),
        );
      for (const tr of sp.traits) {
        out.push(
          el(
            "div",
            { className: "w-trait" },
            el("strong", {}, tr.name),
            tr.options
              ? choice(
                  t("option"),
                  tr.options.map((o) => ({ value: o.name, label: o.name })),
                  c.traits[tr.name],
                  (v) => update(() => (c.traits[tr.name] = v)),
                  { id: `trait-${R.norm(tr.name).replace(/\W+/g, "-")}` },
                )
              : null,
            more(tr.text),
          ),
        );
        if (tr.grants?.feat)
          out.push(
            choice(
              t("originFeat"),
              data.feats
                .filter((f) => f.category === tr.grants.feat)
                .map((f) => ({
                  value: f.id,
                  label: f.name,
                  disabled: f.id === d.bg?.feat?.id && !f.repeatable,
                })),
              c.speciesFeat,
              (v) =>
                update(() => {
                  c.speciesFeat = v;
                  for (const k of Object.keys(c.featPicks))
                    if (k.startsWith("species:")) delete c.featPicks[k];
                }),
              { id: "species-feat" },
            ),
          );
        if (tr.grants?.skills)
          out.push(
            checks(
              tr.name,
              data.skills.map((s) => ({
                value: s.id,
                label: s.name,
                disabled: d.skills.has(s.id) && !c.speciesSkills.includes(s.id),
              })),
              c.speciesSkills,
              tr.grants.skills,
              (v) => update(() => (c.speciesSkills = v)),
              { name: "sp-skill" },
            ),
          );
      }
      out.push(...featProficiencies(d, "species"));
    }
    out.push(
      el("h3", {}, t("languages")),
      el("p", {}, t("languagesHint", { n: R.LANGUAGES })),
      checks(
        t("languages"),
        data.languages
          .filter((l) => !l.rare && l.id !== "comum")
          .map((l) => ({ value: l.id, label: l.name })),
        c.languages,
        R.LANGUAGES,
        (v) => update(() => (c.languages = v)),
        { name: "lang" },
      ),
    );
    return out;
  }

  // +2/+1 ou +1/+1/+1 nos três atributos do antecedente.
  function bonusPicker(bg) {
    const opts = bg.abilities.map((a) => ({ value: a, label: abilityName(a) }));
    const two = Object.keys(c.bonus).find((a) => c.bonus[a] === 2) || null;
    const one = Object.keys(c.bonus).find((a) => c.bonus[a] === 1) || null;
    return el(
      "div",
      { className: "w-bonus" },
      radios(
        t("bonus"),
        [
          { value: "2-1", label: t("bonus21") },
          { value: "1-1-1", label: t("bonus111") },
        ],
        c.bonusMode,
        (v) =>
          update(() => {
            c.bonusMode = v;
            c.bonus =
              v === "1-1-1"
                ? Object.fromEntries(bg.abilities.map((a) => [a, 1]))
                : {};
          }),
        "bonus",
      ),
      c.bonusMode === "2-1"
        ? [
            choice(
              "+2",
              opts.map((o) => ({ ...o, disabled: o.value === one })),
              two,
              (v) =>
                update(() => {
                  c.bonus = one && one !== v ? { [one]: 1 } : {};
                  if (v) c.bonus[v] = 2;
                }),
              { id: "bonus2" },
            ),
            choice(
              "+1",
              opts.map((o) => ({ ...o, disabled: o.value === two })),
              one,
              (v) =>
                update(() => {
                  c.bonus = two && two !== v ? { [two]: 2 } : {};
                  if (v) c.bonus[v] = 1;
                }),
              { id: "bonus1" },
            ),
          ]
        : el(
            "p",
            {},
            bg.abilities.map((a) => `${abilityName(a)} +1`).join(" · "),
          ),
    );
  }

  // Proficiências que um talento de origem dá (Habilidoso, Músico…).
  function featProficiencies(d, where) {
    const f = d.feats.find((x) => x.where === where);
    const p = f?.feat.proficiencies;
    if (!p) return [];
    const key = `${where}:prof`;
    const chosen = c.featPicks[key] || [];
    const items = [];
    if (p.kinds.includes("skill"))
      items.push(
        ...data.skills.map((s) => ({
          value: s.id,
          label: s.name,
          disabled: d.skills.has(s.id) && !chosen.includes(s.id),
        })),
      );
    if (p.kinds.includes("tool") || p.kinds.includes("artisan"))
      items.push(
        ...data.equipment.tools
          .filter((x) => p.kinds.includes("tool") || x.kind === "artisan")
          .map((x) => ({ value: x.id, label: x.name })),
      );
    if (p.kinds.includes("instrument"))
      items.push(
        ...(
          data.equipment.tools.find((x) => /instrumento/i.test(x.name))
            ?.variants || [
            {
              id: "instrumento-musical",
              name: data.equipment.tools.find((x) =>
                /instrumento/i.test(x.name),
              )?.name,
            },
          ]
        ).map((x) => ({ value: x.id, label: x.name })),
      );
    return [
      checks(
        f.feat.name,
        items,
        chosen,
        p.count,
        (v) => update(() => (c.featPicks[key] = v)),
        {
          name: key.replace(":", "-"),
        },
      ),
      more(f.feat.text),
    ];
  }

  // ---------- Etapa 3: atributos ----------

  function stepAbilities(d) {
    const out = [
      radios(
        t("method"),
        [
          {
            value: "standard",
            label: t("standard", { list: R.STANDARD_ARRAY.join(", ") }),
          },
          { value: "pointbuy", label: t("pointBuy", { n: R.POINT_BUDGET }) },
          { value: "roll", label: t("roll") },
        ],
        c.method,
        (v) =>
          update(() => {
            c.method = v;
            c.assign = {};
          }),
        "method",
      ),
    ];
    if (c.method === "roll")
      out.push(
        el(
          "p",
          { className: "w-row" },
          el(
            "button",
            {
              type: "button",
              className: "btn",
              id: "roll-btn",
              onclick: () =>
                update(() => {
                  c.rolls = Array.from({ length: 6 }, () => R.roll4d6().total);
                  c.assign = {};
                }),
            },
            t("rollButton"),
          ),
          " ",
          c.rolls.length ? t("rolled", { list: c.rolls.join(", ") }) : "",
        ),
      );
    if (c.method === "pointbuy") {
      const pb = R.pointBuy(c.points);
      out.push(
        el(
          "p",
          { className: pb.valid ? "" : "w-warn" },
          t("pointsLeft", { n: pb.left }),
        ),
      );
    }
    const pool = c.method === "roll" ? c.rolls : R.STANDARD_ARRAY;
    const used = Object.entries(c.assign);
    const rows = R.ABILITIES.map((a) => {
      let input;
      if (c.method === "pointbuy")
        input = el(
          "select",
          {
            id: `pb-${a}`,
            "aria-label": abilityName(a),
            onchange: (e) =>
              update(() => (c.points[a] = Number(e.target.value))),
          },
          Object.keys(R.POINT_COST).map((v) =>
            el(
              "option",
              { value: v, selected: Number(v) === c.points[a] },
              `${v} (${R.POINT_COST[v]})`,
            ),
          ),
        );
      else
        input = el(
          "select",
          {
            id: `as-${a}`,
            "aria-label": abilityName(a),
            disabled: !pool.length,
            onchange: (e) =>
              update(() => {
                if (e.target.value === "") delete c.assign[a];
                else c.assign[a] = Number(e.target.value);
              }),
          },
          el("option", { value: "" }, "—"),
          pool.map((v, k) =>
            el(
              "option",
              {
                value: k,
                selected: c.assign[a] === k,
                disabled: used.some(([b, j]) => j === k && b !== a),
              },
              String(v),
            ),
          ),
        );
      const bonus = d.scores[a] - d.base[a];
      return el(
        "tr",
        {},
        el("th", { scope: "row" }, abilityName(a)),
        el("td", {}, input),
        el("td", {}, bonus ? signed(bonus) : ""),
        el("td", {}, String(d.scores[a])),
        el("td", {}, el("strong", {}, signed(d.mods[a]))),
      );
    });
    out.push(
      el(
        "table",
        { className: "w-scores" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            [
              t("ability"),
              t("base"),
              t("bonusCol"),
              t("total"),
              t("modifier"),
            ].map((h) => el("th", { scope: "col" }, h)),
          ),
        ),
        el("tbody", {}, rows),
      ),
    );
    if (d.cls)
      out.push(
        el(
          "p",
          { className: "w-hint" },
          t("primaryHint", {
            class: d.cls.name,
            list: d.cls.primaryAbility.map(abilityName).join(" / "),
          }),
        ),
      );
    return out;
  }

  // ---------- Etapa 4: nível (subclasse, talentos, PV, escolhas) ----------

  function stepLevel(d) {
    if (!d.cls) return [el("p", { className: "w-hint" }, t("needClass"))];
    const cl = d.cls;
    const out = [
      choice(
        t("level"),
        Array.from({ length: 20 }, (_, k) => ({
          value: String(k + 1),
          label: String(k + 1),
        })),
        String(c.level),
        (v) => update(() => (c.level = Number(v) || 1)),
        { id: "level", empty: false },
      ),
    ];
    const subLevel = d.ms.subclass[0];
    if (subLevel <= c.level)
      out.push(
        el("h3", {}, t("subclass")),
        el(
          "div",
          { className: "w-cards" },
          cl.subclasses.map((s) =>
            el(
              "label",
              { className: `w-card${s.id === c.subclass ? " is-on" : ""}` },
              el("input", {
                type: "radio",
                name: "subclass",
                id: `sub-${s.id}`,
                checked: s.id === c.subclass,
                onchange: () =>
                  update(() => {
                    c.subclass = s.id;
                    c.landList = null;
                  }),
              }),
              el("strong", {}, s.name),
              el("small", {}, s.tagline || ""),
            ),
          ),
        ),
        d.sub ? more(d.sub.description) : null,
      );
    else
      out.push(
        el("p", { className: "w-hint" }, t("subclassAt", { level: subLevel })),
      );

    // Talentos: Aumento no Valor de Atributo, gerais e Dádiva Épica.
    for (const lv of d.featLevels) {
      const epic = d.ms.epic.includes(lv);
      const pick = c.feats[lv] || {};
      const taken = d.feats.filter((f) => f.where !== lv).map((f) => f.id);
      const pool = data.feats.filter((f) =>
        epic
          ? f.category === "epic-boon" || f.category === "general"
          : f.category === "general",
      );
      const feat = byId(data.feats, pick.id);
      const ctx = { level: lv, scores: d.scoresAt[lv], taken };
      out.push(
        el(
          "div",
          { className: "w-feat" },
          choice(
            t(epic ? "epicAt" : "featAt", { level: lv }),
            pool.map((f) => {
              const ok = R.featAllowed(f, ctx);
              return {
                value: f.id,
                label: f.name + (ok.ok ? "" : " ✗"),
                disabled: !ok.ok,
              };
            }),
            pick.id || null,
            (v) => update(() => (c.feats[lv] = { id: v, asi: [] })),
            { id: `feat-${lv}` },
          ),
          feat?.asi ? asiPicker(lv, feat) : null,
          feat?.prerequisite?.other?.length
            ? el(
                "p",
                { className: "w-hint" },
                t("checkPre", { text: feat.prerequisite.other.join(", ") }),
              )
            : null,
          feat ? more(feat.text) : null,
        ),
      );
    }

    if (d.ms.style[0] <= c.level)
      out.push(
        choice(
          t("style"),
          data.feats
            .filter((f) => f.category === "fighting-style")
            .map((f) => ({ value: f.id, label: f.name })),
          c.style,
          (v) => update(() => (c.style = v)),
          { id: "style" },
        ),
        c.style ? more(byId(data.feats, c.style).text) : null,
      );

    const ml = masteryLimit(d);
    if (ml)
      out.push(
        checks(
          t("masteries"),
          data.equipment.weapons
            .filter((w) => R.weaponProficient(cl.weapons, w))
            .map((w) => ({
              value: w.id,
              label: `${w.name} · ${data.equipment.masteries.find((m) => m.id === w.mastery)?.name || ""}`,
            })),
          c.masteries,
          ml,
          (v) => update(() => (c.masteries = v)),
          { name: "mastery" },
        ),
      );

    for (const g of cl.optionGroups || []) {
      const max = optionLimit(d, g);
      const chosen = c.options[g.id] || [];
      if (max === 0) continue;
      out.push(
        checks(
          g.name,
          g.options.map((o) => ({
            value: o.id,
            label:
              o.name + (o.level ? ` (${t("levelN", { level: o.level })})` : ""),
            disabled: o.level > c.level,
            more: more(o.text, "ⓘ"),
          })),
          chosen,
          max,
          (v) => update(() => (c.options[g.id] = v)),
          { name: `opt-${g.id}` },
        ),
      );
    }

    out.push(hpPicker(d));

    // Características ganhas até o nível: só os nomes; o texto abre sob demanda.
    const gained = [
      ...cl.features.filter((f) => f.level <= c.level),
      ...(d.sub?.features || []).filter((f) => (f.level || 0) <= c.level),
    ].sort((a, b) => (a.level || 0) - (b.level || 0));
    out.push(
      el("h3", {}, t("features")),
      el(
        "ul",
        { className: "w-features" },
        gained.map((f) =>
          el(
            "li",
            {},
            more(f.text, `${f.level || ""} · ${f.name}`) ||
              `${f.level} · ${f.name}`,
          ),
        ),
      ),
    );
    return out;
  }

  // Aumento de atributo dentro de um talento: um select por +1.
  function asiPicker(lv, feat) {
    const n = asiCount(feat);
    const pick = c.feats[lv];
    const asi = pick.asi || [];
    return el(
      "div",
      { className: "w-row" },
      Array.from({ length: n }, (_, k) =>
        choice(
          "+1",
          feat.asi.from.map((a) => ({ value: a, label: abilityName(a) })),
          asi[k] || null,
          (v) =>
            update(() => {
              const next = [...asi];
              next[k] = v;
              c.feats[lv] = { ...pick, asi: next };
            }),
          { id: `asi-${lv}-${k}` },
        ),
      ),
      n > 1 ? el("small", {}, t("asiHint")) : null,
    );
  }

  function hpPicker(d) {
    const cl = d.cls;
    const avg = cl.hitDie / 2 + 1;
    const out = [
      el("h3", {}, t("hp")),
      radios(
        t("hpMethod"),
        [
          { value: "average", label: t("hpAverage", { n: avg }) },
          { value: "roll", label: t("hpRoll", { die: cl.hitDie }) },
        ],
        c.hpMethod,
        (v) => update(() => (c.hpMethod = v)),
        "hp",
      ),
    ];
    if (c.hpMethod === "roll" && c.level > 1)
      out.push(
        el(
          "div",
          { className: "w-grid" },
          Array.from({ length: c.level - 1 }, (_, k) => {
            const lv = k + 2;
            return el(
              "label",
              { className: "w-field" },
              el("span", {}, t("levelN", { level: lv })),
              el("input", {
                type: "number",
                id: `hp-${lv}`,
                min: 1,
                max: cl.hitDie,
                value: c.hpRolls[lv] || "",
                onchange: (e) =>
                  update(() => {
                    const v = Math.min(
                      cl.hitDie,
                      Math.max(1, Number(e.target.value) || 0),
                    );
                    if (v) c.hpRolls[lv] = v;
                    else delete c.hpRolls[lv];
                  }),
              }),
            );
          }),
          el(
            "button",
            {
              type: "button",
              className: "btn",
              id: "hp-roll",
              onclick: () =>
                update(() => {
                  for (let lv = 2; lv <= c.level; lv++)
                    if (!c.hpRolls[lv])
                      c.hpRolls[lv] = 1 + Math.floor(Math.random() * cl.hitDie);
                }),
            },
            t("rollMissing"),
          ),
        ),
      );
    out.push(el("p", {}, el("strong", {}, t("hpTotal", { n: d.hp }))));
    return out;
  }

  // ---------- Etapa 5: magias ----------

  function spellItem(s, extra = {}) {
    const tags = [
      s.level ? t("circle", { n: s.level }) : t("cantrip"),
      s.school,
      s.ritual ? "Ⓡ" : null,
      s.concentration ? "Ⓒ" : null,
    ].filter(Boolean);
    return {
      value: s.id,
      label: `${s.name} · ${tags.join(" · ")}`,
      more: more(
        [
          { text: `${s.castingTime} · ${s.range} · ${s.duration}` },
          ...(s.text || []),
          ...(s.higher ? [{ lead: t("higher"), text: s.higher }] : []),
        ],
        "ⓘ",
      ),
      ...extra,
    };
  }

  function stepSpells(d) {
    const out = [];
    const sc = d.casting;
    if (sc) {
      const list = data.spells.filter((s) => s.classes.includes(sc.list));
      out.push(
        el(
          "dl",
          { className: "w-facts" },
          el("dt", {}, t("casting")),
          el("dd", {}, abilityName(sc.ability)),
          el("dt", {}, t("dc")),
          el("dd", {}, String(sc.dc)),
          el("dt", {}, t("spellAttack")),
          el("dd", {}, signed(sc.attack)),
          el("dt", {}, t("slots")),
          el(
            "dd",
            {},
            sc.pact
              ? t("pact", { n: sc.pact.slots, circle: sc.pact.level })
              : sc.slots
                  .map((n, k) => (n ? `${k + 1}º: ${n}` : null))
                  .filter(Boolean)
                  .join(" · ") || "—",
          ),
        ),
      );
      const lists = d.sub?.spellLists || [];
      if (lists.length > 1)
        out.push(
          choice(
            t("landList"),
            lists.map((l) => ({ value: l.title, label: l.title })),
            c.landList,
            (v) => update(() => (c.landList = v)),
            { id: "land" },
          ),
        );
      if (d.granted.length)
        out.push(
          el("h3", {}, t("granted")),
          el(
            "ul",
            { className: "w-features" },
            d.granted.map((id) => {
              const s = byId(data.spells, id);
              return el("li", {}, s ? s.name : id);
            }),
          ),
        );
      if (sc.cantrips)
        out.push(
          checks(
            t("cantrips"),
            list.filter((s) => s.level === 0).map((s) => spellItem(s)),
            c.cantrips,
            sc.cantrips,
            (v) => update(() => (c.cantrips = v)),
            { name: "cantrip" },
          ),
        );
      out.push(
        checks(
          t("preparedUpTo", { n: sc.maxLevel }),
          list
            .filter((s) => s.level >= 1 && s.level <= sc.maxLevel)
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
            .map((s) => spellItem(s, { disabled: d.granted.includes(s.id) })),
          c.spells,
          sc.prepared,
          (v) => update(() => (c.spells = v)),
          { name: "spell" },
        ),
      );
    }
    // Magias de talento (Iniciado em Magia): lista própria, sempre preparadas.
    for (const f of d.feats.filter((f) => f.feat.spells)) {
      const g = f.feat.spells;
      const listId = featSpellList(f);
      out.push(el("h3", {}, f.feat.name));
      if (!f.option)
        out.push(
          choice(
            t("featList"),
            g.lists.map((id) => ({
              value: id,
              label: byId(data.classes, id)?.name || id,
            })),
            listId,
            (v) =>
              update(() => {
                c.featPicks[`${f.where}:list`] = [v];
                c.featPicks[`${f.where}:cantrips`] = [];
                c.featPicks[`${f.where}:spells`] = [];
              }),
            { id: `fl-${f.where}` },
          ),
        );
      if (!listId) continue;
      const pool = data.spells.filter((s) => s.classes.includes(listId));
      for (const [k, lvl, max] of [
        ["cantrips", 0, g.cantrips],
        ["spells", 1, g.level1],
      ]) {
        if (!max) continue;
        const key = `${f.where}:${k}`;
        out.push(
          checks(
            t(lvl ? "level1" : "cantrips"),
            pool.filter((s) => s.level === lvl).map((s) => spellItem(s)),
            c.featPicks[key] || [],
            max,
            (v) => update(() => (c.featPicks[key] = v)),
            { name: key.replace(":", "-") },
          ),
        );
      }
    }
    if (!out.length) out.push(el("p", { className: "w-hint" }, t("noSpells")));
    return out;
  }

  // ---------- Etapa 6: equipamento ----------

  const money = (n) =>
    new Intl.NumberFormat(document.documentElement.lang, {
      maximumFractionDigits: 2,
    }).format(n);

  function stepEquipment(d) {
    const out = [];
    const optionRadios = (owner, value, set, name) =>
      owner?.equipment?.length
        ? radios(
            `${owner.name}`,
            owner.equipment.map((o) => ({
              value: o.option,
              label: `(${o.option}) ${o.text}`,
            })),
            value,
            (v) =>
              update(() => {
                set(v);
                c.armor = null;
                c.shield = false;
              }),
            name,
          )
        : null;
    out.push(
      optionRadios(d.cls, c.classGear, (v) => (c.classGear = v), "gear-class"),
      optionRadios(d.bg, c.bgGear, (v) => (c.bgGear = v), "gear-bg"),
    );
    // Inventário: o que veio das opções e das compras.
    const kindLabel = (i) => t(`kind.${i.kind}`);
    out.push(
      el("h3", {}, t("inventory")),
      el(
        "ul",
        { className: "w-features" },
        d.items.map((x, k) =>
          el(
            "li",
            {},
            x.qty > 1 ? `${x.qty}× ` : "",
            x.item ? x.item.name : x.text,
            x.item ? el("small", {}, ` · ${kindLabel(x.item)}`) : null,
            x.bought
              ? el(
                  "button",
                  {
                    type: "button",
                    className: "btn w-small",
                    id: `rm-${k}`,
                    onclick: () =>
                      update(() => {
                        const i = c.bought.indexOf(x.item.id);
                        if (i >= 0) c.bought.splice(i, 1);
                      }),
                  },
                  t("remove"),
                )
              : null,
          ),
        ),
      ),
      el(
        "p",
        { className: d.spent > d.gold ? "w-warn" : "" },
        t("gold", { left: money(d.gold - d.spent), total: money(d.gold) }),
      ),
    );
    // Loja: tudo que tem preço, agrupado por tipo; só o que cabe no ouro.
    const left = d.gold - d.spent;
    const shop = d.catalog.filter((i) => i.cost?.cp);
    const groups = ["weapon", "armor", "tool", "gear", "variant"];
    const select = el(
      "select",
      { id: "shop", "aria-label": t("shop") },
      groups.map((g) =>
        el(
          "optgroup",
          { label: t(`kind.${g}`) },
          shop
            .filter((i) => i.kind === g)
            .map((i) =>
              el(
                "option",
                { value: i.id, disabled: i.cost.cp / 100 > left },
                `${i.name} — ${money(i.cost.cp / 100)} PO`,
              ),
            ),
        ),
      ),
    );
    out.push(
      el(
        "div",
        { className: "w-row" },
        el(
          "label",
          { className: "w-field" },
          el("span", {}, t("shop")),
          select,
        ),
        el(
          "button",
          {
            type: "button",
            className: "btn",
            id: "buy",
            onclick: () => {
              const item = shop.find((i) => i.id === select.value);
              if (item && item.cost.cp / 100 <= left)
                update(() => c.bought.push(item.id));
            },
          },
          t("buy"),
        ),
      ),
    );
    // Vestir: só armaduras que o personagem tem.
    const armors = d.owned("armor").filter((a) => a.category !== "shield");
    const hasShield = d.owned("armor").some((a) => a.category === "shield");
    out.push(
      el("h3", {}, t("equipped")),
      choice(
        t("armor"),
        [
          { value: "", label: t("noArmor") },
          ...[...new Map(armors.map((a) => [a.id, a])).values()].map((a) => ({
            value: a.id,
            label: `${a.name} (${t("acValue", { n: a.ac.base })})${d.trained.has(a.category) ? "" : " ⚠"}`,
          })),
        ],
        c.armor || "",
        (v) => update(() => (c.armor = v || null)),
        { id: "armor", empty: false },
      ),
      hasShield
        ? el(
            "label",
            { className: "w-check" },
            el("input", {
              type: "checkbox",
              id: "shield",
              checked: c.shield,
              onchange: (e) => update(() => (c.shield = e.target.checked)),
            }),
            " ",
            t("useShield"),
          )
        : null,
      el("p", {}, el("strong", {}, t("acTotal", { n: d.ac }))),
    );
    if (d.attacks.length)
      out.push(
        el("h3", {}, t("attacks")),
        el(
          "table",
          { className: "w-scores" },
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              [t("weapon"), t("attack"), t("damage")].map((h) =>
                el("th", { scope: "col" }, h),
              ),
            ),
          ),
          el(
            "tbody",
            {},
            d.attacks.map((a) =>
              el(
                "tr",
                {},
                el("th", { scope: "row" }, a.weapon.name),
                el("td", {}, signed(a.attack)),
                el("td", {}, `${a.damage} ${a.type}`),
              ),
            ),
          ),
        ),
      );
    return out;
  }

  // ---------- Resumo (sempre à vista) ----------

  function showSummary(d) {
    const title = [
      d.cls ? `${d.cls.name} ${c.level}` : null,
      d.sub?.name,
      d.sp?.name,
      d.bg?.name,
    ]
      .filter(Boolean)
      .join(" · ");
    const stat = (label, value) =>
      el(
        "div",
        { className: "w-stat" },
        el("small", {}, label),
        el("strong", {}, value),
      );
    summaryBox.replaceChildren(
      el("h3", {}, title || t("newCharacter")),
      el(
        "div",
        { className: "w-stats" },
        stat(t("hpShort"), d.hp ? String(d.hp) : "—"),
        stat(t("acShort"), String(d.ac)),
        stat(t("initiative"), signed(R.initiative(d.scores))),
        stat(t("proficiency"), signed(d.prof)),
        stat(t("speed"), d.sp ? t("meters", { n: d.sp.speed }) : "—"),
        d.casting ? stat(t("dc"), String(d.casting.dc)) : null,
      ),
      el(
        "div",
        { className: "w-stats" },
        R.ABILITIES.map((a) =>
          stat(abilityShort(a), `${d.scores[a]} (${signed(d.mods[a])})`),
        ),
      ),
      d.pending.length
        ? el(
            "details",
            { className: "w-pending", open: true },
            el("summary", {}, t("pending", { n: d.pending.length })),
            el(
              "ul",
              {},
              d.pending.map((p) =>
                el(
                  "li",
                  {},
                  el(
                    "button",
                    {
                      type: "button",
                      className: "w-link",
                      onclick: () => go(p.step),
                    },
                    i18n.t(`dnd.step.${p.step}`),
                  ),
                  ": ",
                  p.text,
                ),
              ),
            ),
          )
        : el("p", { className: "w-ok" }, t("allDone")),
      el(
        "button",
        {
          type: "button",
          className: "btn",
          id: "reset",
          onclick: () => {
            if (confirm(t("resetConfirm")))
              update(() => (c = blank()), "class");
          },
        },
        t("reset"),
      ),
    );
  }

  // ---------- Desenho ----------

  const RENDER = {
    class: stepClass,
    origin: stepOrigin,
    abilities: stepAbilities,
    level: stepLevel,
    spells: stepSpells,
    equipment: stepEquipment,
  };

  function draw() {
    if (!data) return;
    const d = derive();
    // Redesenhar troca os elementos: guarda o foco pelo id e devolve.
    const focus = document.activeElement?.id;
    const scroll = panel.scrollTop;
    panel.replaceChildren(
      el("h3", { className: "w-step-title" }, i18n.t(`dnd.step.${step}`)),
      ...RENDER[step](d),
      nav(),
    );
    panel.scrollTop = scroll;
    showSummary(d);
    for (const b of stepButtons) {
      const s = b.dataset.step;
      b.setAttribute("aria-pressed", String(s === step));
      b.classList.toggle(
        "has-pending",
        d.pending.some((p) => p.step === s),
      );
    }
    if (focus) document.getElementById(focus)?.focus();
  }

  // Anterior / Próxima no fim de cada etapa.
  function nav() {
    const k = STEPS.indexOf(step);
    return el(
      "p",
      { className: "w-nav" },
      k > 0
        ? el(
            "button",
            {
              type: "button",
              className: "btn",
              id: "prev",
              onclick: () => go(STEPS[k - 1]),
            },
            `◀ ${i18n.t(`dnd.step.${STEPS[k - 1]}`)}`,
          )
        : null,
      k < STEPS.length - 1
        ? el(
            "button",
            {
              type: "button",
              className: "btn",
              id: "next",
              onclick: () => go(STEPS[k + 1]),
            },
            `${i18n.t(`dnd.step.${STEPS[k + 1]}`)} ▶`,
          )
        : null,
    );
  }

  function go(s) {
    if (!RENDER[s]) return;
    step = s;
    saveDraft();
    draw();
    panel.scrollTop = 0;
    panel.querySelector(".w-step-title")?.focus?.();
  }

  function update(change, nextStep) {
    change();
    if (nextStep) step = nextStep;
    saveDraft();
    draw();
  }

  /*
    Liga o assistente aos livros carregados. Escolhas que apontam para
    algo que não existe mais (livro esquecido) são simplesmente ignoradas
    pelo derive(): byId devolve undefined e a pendência aparece.
  */
  function start(merged) {
    data = merged;
    const wizard = document.querySelector("[data-wizard]");
    panel = document.querySelector("[data-panel]");
    summaryBox = document.querySelector("[data-summary]");
    stepButtons = [...wizard.querySelectorAll("[data-step]")];
    wizard.disabled = !data;
    panel.hidden = summaryBox.hidden = !data;
    if (!data) return;
    for (const b of stepButtons) b.onclick = () => go(b.dataset.step);
    draw();
  }

  loadDraft();
  return {
    start,
    derive: () => derive(),
    get character() {
      return c;
    },
  };
})();
