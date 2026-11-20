// Confere a extração do d&d.exe contra o PDF local (Node, nunca publicado).
// Uso: npm run dnd:check [-- --mapa] [arquivo.pdf]
// Roda o mesmo código do site (pdf.js, extract.js, sources/*) e imprime
// um relatório: assim dá para afinar o extrator sem abrir o navegador.
// Os números de "esperado" são contagens, não conteúdo do livro.

const fs = require("node:fs");
const path = require("node:path");

const site = path.join(__dirname, "../../site/projects/dnd");
const PDF = require(path.join(site, "pdf.js"));
globalThis.PDF = PDF;
const DND = require(path.join(site, "extract.js"));
const R = require(path.join(site, "rules.js"));
for (const f of fs.readdirSync(path.join(site, "sources")))
  require(path.join(site, "sources", f));

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file =
  args.find((a) => !a.startsWith("--")) ||
  path.join(__dirname, "livros", "livro-do-jogador.pdf");

let failures = 0;
function expect(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

(async () => {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  const started = Date.now();
  const hash = await PDF.sha256(ab);
  const source = DND.identify(hash);
  expect("versão do PDF reconhecida", !!source, source ? source.name : hash);
  if (!source) process.exit(1);

  const doc = await PDF.open(ab);
  const book = await DND.readBook(doc);
  const data = source.extract(book);
  console.log(`⏱  ${doc.pageCount} páginas em ${Date.now() - started} ms\n`);

  // ---------- Mapa do livro × sumário impresso ----------
  const all = [];
  (function walk(n) {
    for (const c of n.children) {
      all.push(c);
      walk(c);
    }
  })(data.outline);

  const chapters = data.outline.children;
  console.log(
    `🗺  Capítulos detectados (deslocamento de página: ${data.offset})`,
  );
  for (const c of chapters) {
    const last = c.end > 0 ? book.lines[c.end - 1].page : c.page;
    console.log(
      `   p.${String(c.page).padStart(3)}–${String(last).padEnd(3)} ${c.title} (${c.children.length} seções)`,
    );
    if (flags.has("--mapa"))
      for (const s of c.children) console.log(`        p.${s.page} ${s.title}`);
  }

  // "Cap. 3: Classes de Personagem" no sumário = "Classes de Personagem" no título.
  const clean = (t) =>
    DND.norm(t.replace(/^(cap\.|capítulo|ap\.|apêndice)\s*\w*\s*:\s*/i, ""));
  const missing = [];
  for (const e of data.toc) {
    const want = clean(e.title);
    const page = e.printed + data.offset;
    const hit = all.find(
      (h) =>
        Math.abs(h.page - page) <= 1 &&
        (DND.norm(h.title) === want || DND.norm(h.title).startsWith(want)),
    );
    if (!hit) missing.push(`${e.title} (p.${e.printed} → PDF ${page})`);
  }
  const found = data.toc.length - missing.length;
  console.log("");
  expect(
    "sumário impresso encontrado no mapa",
    missing.length <= data.toc.length * 0.02,
    `${found}/${data.toc.length} entradas`,
  );
  for (const m of missing) console.log(`   ⚠️  não achei: ${m}`);

  // ---------- Classes ----------
  const classes = data.classes || [];
  console.log("\n⚔️  Classes");
  expect("12 classes", classes.length === 12, `${classes.length}`);
  const subs = classes.flatMap((c) => c.subclasses);
  expect("48 subclasses (4 por classe)", subs.length === 48, `${subs.length}`);
  for (const c of classes) {
    const problems = [];
    if (!c.hitDie) problems.push("sem dado de vida");
    if (!c.primaryAbility?.length) problems.push("sem atributo primário");
    if (c.savingThrows?.length !== 2) problems.push("salvaguardas");
    if (!c.skills?.choose) problems.push("perícias");
    if (!c.equipment?.length) problems.push("equipamento");
    if (c.progression?.rows.length !== 20)
      problems.push(`tabela com ${c.progression?.rows.length ?? 0} níveis`);
    if (c.subclasses.length !== 4)
      problems.push(`${c.subclasses.length} subclasses`);
    if (!c.description.length) problems.push("sem descrição");
    // Toda característica citada na tabela precisa achar a sua seção.
    if (c.unlinked?.length)
      problems.push(`tabela cita sem seção: ${c.unlinked.join("; ")}`);
    for (const sc of c.subclasses)
      if (sc.features.length < 3)
        problems.push(`${sc.name}: ${sc.features.length} características`);
    expect(
      `${c.name.padEnd(11)} d${c.hitDie} · ${c.primaryAbility?.join("/")} · salv. ${c.savingThrows?.join("+")} · ` +
        `${c.skills?.choose} perícias · ${c.features.length} caract. · colunas: ${c.progression?.columns.map((n) => n.replace(/^Espaços? de Magia por Círculo de Magia (\d)/, "⚪$1")).join(", ")}`,
      problems.length === 0,
      problems.join(" | "),
    );
  }
  const aliases = classes.flatMap((c) =>
    (c.aliases || []).map(
      (a) => `${c.name} ${a.level}: "${a.table}" → "${a.feature}"`,
    ),
  );
  if (aliases.length) {
    console.log(
      "   ℹ️  nomes diferentes entre tabela e título no próprio livro (ligados pelo nível):",
    );
    for (const a of aliases) console.log(`      ${a}`);
  }
  // ---------- Origens e talentos ----------
  const skills = data.skills || [];
  const feats = data.feats || [];
  const languages = data.languages || [];
  console.log("\n🧭 Origens");
  expect(
    "18 perícias com atributo",
    skills.length === 18 && skills.every((s) => s.ability),
    `${skills.length}`,
  );
  expect(
    "19 idiomas (10 comuns + 9 raros)",
    languages.length === 19 && languages.filter((l) => l.rare).length === 9,
    `${languages.length}`,
  );
  const bgs = data.backgrounds || [];
  expect("16 antecedentes", bgs.length === 16, `${bgs.length}`);
  for (const b of bgs) {
    const problems = [];
    if (b.abilities?.length !== 3) problems.push("atributos");
    // As referências precisam apontar para itens que existem.
    if (!feats.some((f) => f.id === b.feat?.id && f.category === "origin"))
      problems.push(`talento "${b.feat?.name}" não achado`);
    if (
      b.skills?.length !== 2 ||
      !b.skills.every((id) => skills.some((s) => s.id === id))
    )
      problems.push(`perícias ${b.skills}`);
    if (!b.tool) problems.push("ferramenta");
    if (b.equipment?.length !== 2) problems.push("equipamento A/B");
    if (!b.description.length) problems.push("sem descrição");
    expect(
      `${b.name.padEnd(11)} ${b.abilities?.join("/")} · ${b.feat?.name}${b.feat?.option ? ` (${b.feat.option})` : ""} · ${b.skills?.join(", ")}`,
      problems.length === 0,
      problems.join(" | "),
    );
  }
  const species = data.species || [];
  expect("10 espécies", species.length === 10, `${species.length}`);
  for (const s of species) {
    const problems = [];
    if (!s.creatureType) problems.push("tipo");
    if (!s.sizes?.length) problems.push("tamanho");
    if (!s.speed) problems.push("deslocamento");
    if (s.traits.length < 3) problems.push(`${s.traits.length} traços`);
    if (s.tables?.length)
      problems.push(`tabela solta: ${s.tables.map((t) => t.title)}`);
    if (!s.description.length) problems.push("sem descrição");
    const opts = s.traits
      .filter((t) => t.options)
      .map((t) => `${t.name} (${t.options.length})`);
    expect(
      `${s.name.padEnd(10)} ${s.sizes?.join("/")} · ${s.speed} m · ${s.traits.length} traços${opts.length ? ` · escolhas: ${opts.join(", ")}` : ""}`,
      problems.length === 0,
      problems.join(" | "),
    );
  }

  console.log("\n🎖  Talentos");
  const count = (cat) => feats.filter((f) => f.category === cat).length;
  for (const [cat, label, n] of [
    ["origin", "de origem", 10],
    ["general", "gerais", 42],
    ["fighting-style", "de estilo de luta", 10],
    ["epic-boon", "de dádiva épica", 12],
  ])
    expect(`${n} talentos ${label}`, count(cat) === n, `${count(cat)}`);
  const noText = feats.filter((f) => !f.text.length).map((f) => f.name);
  expect("todo talento tem texto", !noText.length, noText.join(", "));
  // Geral exige nível 4; dádiva épica, 19; estilo de luta, a característica.
  const badPre = feats.filter(
    (f) =>
      (f.category === "general" && f.prerequisite?.level !== 4) ||
      (f.category === "epic-boon" && f.prerequisite?.level !== 19) ||
      (f.category === "fighting-style" && !f.prerequisite?.other.length),
  );
  expect(
    "pré-requisitos lidos",
    !badPre.length,
    badPre.map((f) => f.name).join(", "),
  );
  console.log(
    `   ${feats.filter((f) => f.asi).length} com aumento de atributo · ${feats.filter((f) => f.repeatable).length} repetíveis · ${feats.filter((f) => f.prerequisite?.abilities).length} exigem atributo mínimo`,
  );

  // ---------- Magias ----------
  const spells = data.spells || [];
  console.log("\n✨ Magias");
  expect("391 magias", spells.length === 391, `${spells.length}`);
  const incomplete = spells.filter(
    (s) =>
      s.level == null ||
      !s.school ||
      !s.classes?.length ||
      !s.castingTime ||
      !s.range ||
      !s.duration ||
      !s.text.length,
  );
  expect(
    "toda magia tem círculo, escola, classes, tempo, alcance, duração e texto",
    !incomplete.length,
    incomplete.map((s) => s.name).join(", "),
  );
  const classIds = new Set(classes.map((c) => c.id));
  const strange = [
    ...new Set(
      spells.flatMap((s) => s.classes || []).filter((c) => !classIds.has(c)),
    ),
  ];
  expect("classes das magias existem", !strange.length, strange.join(", "));
  // Quem conjura precisa ter magias em todos os círculos da sua tabela.
  for (const c of classes) {
    const cols = c.progression?.columns || [];
    if (!cols.some((n) => /Magias Preparadas/.test(n))) continue;
    const mine = spells.filter((s) => s.classes.includes(c.id));
    const slots = cols.filter((n) => /Círculo de Magia \d$/.test(n)).length;
    // O Bruxo usa a Magia de Pacto (até o 5º); 6º–9º vêm da Arcana Mística.
    const maxLevel = slots || 9;
    const missing = [];
    for (let lv = 1; lv <= maxLevel; lv++)
      if (!mine.some((s) => s.level === lv)) missing.push(lv);
    const byLevel = Array.from(
      { length: 10 },
      (_, lv) => mine.filter((s) => s.level === lv).length,
    );
    expect(
      `${c.name.padEnd(11)} ${mine.length} magias (por círculo: ${byLevel.join("/")})`,
      !missing.length,
      missing.length ? `sem magias de círculo ${missing.join(", ")}` : "",
    );
  }
  const fireball = spells.find((s) => s.id === "bola-de-fogo");
  expect(
    "amostra: Bola de Fogo",
    fireball?.level === 3 &&
      fireball.school === "Evocação" &&
      fireball.classes.includes("mago"),
    fireball &&
      `${fireball.level}º círculo, ${fireball.school}, ${fireball.range}, ${fireball.classes.join("/")}`,
  );
  console.log(
    `   ${spells.filter((s) => s.ritual).length} rituais · ${spells.filter((s) => s.concentration).length} de concentração · ${spells.filter((s) => s.components.cost).length} com componente de custo · ${spells.filter((s) => s.higher).length} com efeito em círculo superior`,
  );

  // ---------- Equipamento ----------
  const eq = data.equipment || {};
  console.log("\n🛡  Equipamento");
  const weapons = eq.weapons || [];
  expect("38 armas", weapons.length === 38, `${weapons.length}`);
  expect(
    "10 propriedades e 8 maestrias",
    eq.properties?.length === 10 && eq.masteries?.length === 8,
    `${eq.properties?.length} e ${eq.masteries?.length}`,
  );
  const propIds = new Set((eq.properties || []).map((p) => p.id));
  const mastIds = new Set((eq.masteries || []).map((p) => p.id));
  const badWeapons = weapons.filter(
    (w) =>
      !/^\d+(d\d+)?$/.test(w.damage.dice) ||
      !w.damage.type ||
      !mastIds.has(w.mastery) ||
      !w.properties.every((p) => propIds.has(p.id)) ||
      !w.cost,
  );
  expect(
    "armas com dano, maestria, propriedades e preço",
    !badWeapons.length,
    badWeapons.map((w) => w.name).join(", "),
  );
  const groupsOf = (list, key) =>
    Object.entries(
      list.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {}),
    )
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
  console.log(
    `   ${groupsOf(
      weapons.map((w) => ({ k: `${w.category}${w.ranged ? "/dist" : ""}` })),
      "k",
    )}`,
  );
  const armor = eq.armor || [];
  expect(
    "13 armaduras (3 leves, 5 médias, 4 pesadas, escudo)",
    armor.length === 13,
    groupsOf(armor, "category"),
  );
  const chain = armor.find((a) => a.id === "cota-de-malha");
  expect(
    "amostra: Cota de Malha",
    chain?.ac.base === 16 &&
      !chain.ac.dex &&
      chain.strength === 13 &&
      chain.stealthDisadvantage,
    chain &&
      `CA ${chain.ac.base}, For ${chain.strength}, ${chain.cost.amount} ${chain.cost.unit}`,
  );
  const tools = eq.tools || [];
  expect(
    "25 ferramentas com atributo",
    tools.length === 25 && tools.every((t) => t.ability.length),
    `${tools.length}`,
  );
  const gear = eq.gear || [];
  const noDesc = gear.filter((g) => !g.text);
  expect(
    `${gear.length} itens de aventura, todos com verbete`,
    gear.length >= 80 && !noDesc.length,
    noDesc.map((g) => g.name).join(", "),
  );
  console.log(
    `   variantes: ${Object.entries(eq.variants || {})
      .map(([k, v]) => `${k} ${v.length}`)
      .join(", ")}`,
  );

  // ---------- Motor de regras (rules.js) com casos conhecidos ----------
  console.log("\n🧮 Regras");
  const eqv = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const by = (list, name) =>
    list.find((x) => DND.norm(x.name) === DND.norm(name));
  const sc = (str, dex, con, int, wis, cha) => ({
    str,
    dex,
    con,
    int,
    wis,
    cha,
  });
  expect(
    "modificadores 8/10/15/20 → −1/0/+2/+5",
    eqv([8, 10, 15, 20].map(R.mod), [-1, 0, 2, 5]),
  );
  expect(
    "proficiência nos níveis 1/5/17 → +2/+3/+6",
    eqv([1, 5, 17].map(R.proficiency), [2, 3, 6]),
  );
  expect(
    "compra de pontos: 15,15,15,8,8,8 gasta 27; um 9 a mais estoura",
    R.pointBuy(sc(15, 15, 15, 8, 8, 8)).left === 0 &&
      !R.pointBuy(sc(15, 15, 15, 9, 8, 8)).valid,
  );
  expect(
    "conjunto padrão aceita a permutação e recusa repetidos",
    R.standardArrayValid(sc(8, 15, 14, 10, 13, 12)) &&
      !R.standardArrayValid(sc(15, 15, 14, 10, 13, 12)),
  );
  const seq = [0.99, 0, 0.5, 0.7]; // 6, 1, 4, 5
  expect(
    "4d6 descarta o menor (6,1,4,5 → 15)",
    R.roll4d6(() => seq.shift()).total === 15,
  );
  expect(
    "antecedente: +2/+1 e +1/+1/+1 só nos atributos permitidos",
    R.backgroundBonusValid({ int: 2, wis: 1 }, ["int", "wis", "cha"]) &&
      R.backgroundBonusValid({ int: 1, wis: 1, cha: 1 }, [
        "int",
        "wis",
        "cha",
      ]) &&
      !R.backgroundBonusValid({ str: 2, wis: 1 }, ["int", "wis", "cha"]) &&
      !R.backgroundBonusValid({ int: 2, wis: 2 }, ["int", "wis", "cha"]),
  );
  expect(
    "aumentos param em 20 (e em 30 na dádiva épica)",
    R.scoresWith(sc(19, 8, 8, 8, 8, 8), [
      { ability: "str", amount: 2 },
      { ability: "str", amount: 1, max: 30 },
    ]).str === 21,
  );
  const fighter = by(classes, "Guerreiro");
  expect(
    "PV Guerreiro (d10, Con +2): nível 1 = 12, nível 5 na média = 44",
    R.hitPoints({ hitDie: fighter.hitDie, level: 1, con: 2 }) === 12 &&
      R.hitPoints({ hitDie: fighter.hitDie, level: 5, con: 2 }) === 44,
  );
  const mail = by(eq.armor, "Cota de Malha");
  const shield = eq.armor.find((a) => a.category === "shield");
  const barb = by(classes, "Bárbaro");
  const monk = by(classes, "Monge");
  expect(
    "CA: Cota de Malha + Escudo = 18; Bárbaro Des 14/Con 16 sem armadura + escudo = 17",
    R.armorClass({ armor: mail, shield, scores: sc(16, 14, 16, 8, 8, 8) }) ===
      18 &&
      R.armorClass({
        shield,
        scores: sc(16, 14, 16, 8, 8, 8),
        unarmored: barb.unarmored,
      }) === 17,
  );
  expect(
    "CA: Monge perde a Defesa sem Armadura com escudo",
    R.armorClass({
      scores: sc(8, 16, 8, 8, 16, 8),
      unarmored: monk.unarmored,
    }) === 16 &&
      R.armorClass({
        shield,
        scores: sc(8, 16, 8, 8, 16, 8),
        unarmored: monk.unarmored,
      }) === 15,
  );
  const wizard = by(classes, "Mago");
  const w5 = R.casting(wizard, null, 5);
  expect(
    "Mago nível 5: 4 truques, 9 preparadas, espaços 4/3/2, CD 14 com Int 16",
    w5.cantrips === 4 &&
      w5.prepared === 9 &&
      eqv(w5.slots.slice(0, 4), [4, 3, 2, 0]) &&
      w5.maxLevel === 3 &&
      R.spellSaveDC(R.proficiency(5), R.mod(16)) === 14,
    JSON.stringify({ ...w5, slots: w5.slots.join("/") }),
  );
  const w5b = R.casting(by(classes, "Bruxo"), null, 5);
  expect(
    "Bruxo nível 5: Magia de Pacto com 2 espaços de 3º círculo",
    eqv(w5b.pact, { slots: 2, level: 3 }) && w5b.maxLevel === 3,
  );
  const ek = by(fighter.subclasses, "Cavaleiro Místico");
  const ek7 = R.casting(fighter, ek, 7);
  expect(
    "Cavaleiro Místico nível 7: Int, lista do Mago, espaços 4/2",
    ek7?.ability === "int" &&
      ek7.list === "mago" &&
      eqv(ek7.slots.slice(0, 2), [4, 2]) &&
      !R.casting(fighter, ek, 2),
  );
  expect(
    "Paladino nível 1 já conjura (1º círculo)",
    R.casting(by(classes, "Paladino"), null, 1).maxLevel === 1,
  );
  const ms = R.milestones(fighter.progression);
  expect(
    "marcos do Guerreiro: subclasse 3, ASI 4/6/8/12/14/16, dádiva 19",
    eqv(ms.subclass, [3]) &&
      eqv(ms.asi, [4, 6, 8, 12, 14, 16]) &&
      eqv(ms.epic, [19]),
  );
  expect(
    "toda classe tem subclasse e ASI na tabela",
    classes.every((c) => {
      const m = R.milestones(c.progression);
      return (
        m.subclass.length === 1 && m.asi.length >= 4 && m.epic.length === 1
      );
    }),
  );
  const spellIds = new Set(spells.map((s) => s.id));
  const life = R.grantedSpells(
    by(by(classes, "Clérigo").subclasses, "Domínio da Vida"),
    5,
  );
  expect(
    "Domínio da Vida nível 5: 6 magias sempre preparadas, todas existentes",
    life.length === 6 && life.every((id) => spellIds.has(id)),
  );
  const listed = classes.flatMap((c) =>
    c.subclasses.flatMap((s) =>
      (s.spellLists || []).flatMap((l) => l.rows.flatMap((r) => r.spells)),
    ),
  );
  const unknownSub = listed.filter((s) => !spellIds.has(s.id));
  expect(
    `magias de subclasse existem (${listed.length})`,
    !unknownSub.length,
    unknownSub.map((s) => s.name).join(", "),
  );
  const epic = feats.find((f) => f.category === "epic-boon");
  expect(
    "talento épico recusado no nível 4, aceito no 19",
    !R.featAllowed(epic, { level: 4, scores: sc(10, 10, 10, 10, 10, 10) }).ok &&
      R.featAllowed(epic, { level: 19, scores: sc(10, 10, 10, 10, 10, 10) }).ok,
  );
  const withAbility = feats.find((f) => f.prerequisite?.abilities?.min);
  expect(
    `pré-requisito de atributo (${withAbility?.name})`,
    withAbility &&
      !R.featAllowed(withAbility, { level: 20, scores: sc(8, 8, 8, 8, 8, 8) })
        .ok,
  );
  const W = (n) => by(eq.weapons, n);
  expect(
    "Monge: Espada Curta (marcial leve) sim, Espada Longa não; Ladino: Rapieira sim",
    R.weaponProficient(monk.weapons, W("Espada Curta")) &&
      !R.weaponProficient(monk.weapons, W("Espada Longa")) &&
      R.weaponProficient(by(classes, "Ladino").weapons, W("Rapieira")),
  );
  const rap = R.weaponAttack(
    W("Rapieira"),
    sc(10, 16, 10, 10, 10, 10),
    2,
    true,
  );
  expect(
    "Rapieira com Des 16: +5, 1d8+3 (Acuidade)",
    rap.attack === 5 && rap.damage === "1d8+3",
    JSON.stringify(rap),
  );
  expect(
    "treinamento: Guerreiro usa pesada, Mago nenhuma",
    R.armorTraining(fighter.armor).has("heavy") &&
      R.armorTraining(wizard.armor).size === 0,
  );
  expect(
    "perícias de classe viram ids",
    classes.every(
      (c) =>
        c.skills.any ||
        R.skillIds(c.skills.from, skills).length === c.skills.from.length,
    ),
  );

  const cat = R.catalog(eq);
  const fa = R.itemsFrom(fighter.equipment[0].text, cat);
  expect(
    "equipamento do Guerreiro (A): Cota de Malha, 8 Azagaias e 4 PO",
    fa.items.some((x) => x.item?.name === "Cota de Malha") &&
      fa.items.some((x) => x.item?.name === "Azagaia" && x.qty === 8) &&
      fa.gold === 4,
  );
  const options = [...classes, ...bgs].flatMap((o) => o.equipment);
  const loose = options.flatMap((o) =>
    R.itemsFrom(o.text, cat)
      .items.filter((x) => !x.item)
      .map((x) => x.text),
  );
  expect(
    `itens iniciais casados com o catálogo (sobram só escolhas livres)`,
    loose.length <= 3,
    loose.join(" | "),
  );

  // Despejo de um item: --classe Nome, --antecedente Nome, --especie Nome, --talento Nome, --magia Nome.
  const dumps = {
    "--classe": classes,
    "--antecedente": bgs,
    "--especie": species,
    "--talento": feats,
    "--magia": spells,
  };
  for (const [flag, items] of Object.entries(dumps)) {
    if (!flags.has(flag)) continue;
    const name = args[args.indexOf(flag) + 1];
    const item = items.find((c) => DND.norm(c.name) === DND.norm(name));
    console.log(
      JSON.stringify(
        item,
        (k, v) =>
          k === "description" || (k === "text" && Array.isArray(v))
            ? `[${v.length} parágrafos]`
            : v,
        2,
      ),
    );
  }

  console.log(
    failures ? `\n${failures} verificação(ões) falharam` : "\nTudo certo",
  );
  process.exit(failures ? 1 : 0);
})();
