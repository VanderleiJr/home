/*
  pdf.js — um leitor de PDF mínimo, só para extrair texto (sem desenhar
  nada). Roda igual no navegador e no Node: usa apenas APIs da web que
  os dois têm (DecompressionStream, TextDecoder, crypto.subtle).

  Como um PDF é organizado, em uma frase: uma pilha de "objetos"
  numerados (números, nomes, textos, listas, dicionários e streams de
  bytes), mais uma tabela no fim do arquivo (xref) dizendo em que byte
  cada objeto começa. As páginas são dicionários que apontam para
  streams de "conteúdo": pequenos programas de desenho, como
  "BT /F1 9 Tf 72 700 Td (Olá) Tj ET". Ler texto é executar esse
  programa prestando atenção só aos operadores de texto.

  API:
    const doc = await PDF.open(arrayBuffer);
    doc.pageCount
    const items = await doc.pageItems(n); // n começa em 1
    PDF.toLines(items)                    // junta pedaços em linhas
    await PDF.sha256(arrayBuffer)
*/
(function (root) {
  "use strict";

  // ---------- Tipos básicos ----------
  // Nomes (/Type) e referências (12 0 R) viram classes próprias para não
  // se confundirem com strings e números comuns.
  class Name {
    constructor(name) {
      this.name = name;
    }
  }
  class Ref {
    constructor(num, gen) {
      this.num = num;
      this.gen = gen;
    }
  }
  // Um stream é um dicionário seguido de bytes; guardamos onde os bytes estão.
  class Stream {
    constructor(dict, bytes) {
      this.dict = dict;
      this.bytes = bytes;
    }
  }
  // Operador de um stream de conteúdo (Tj, Tf, BT…): é "palavra solta".
  class Op {
    constructor(op) {
      this.op = op;
    }
  }

  const isName = (v, name) =>
    v instanceof Name && (name === undefined || v.name === name);

  // ---------- Lexer: bytes → tokens ----------
  // Espaços em branco e delimitadores segundo a especificação do PDF.
  const WS = new Set([0, 9, 10, 12, 13, 32]);
  const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

  class Lexer {
    constructor(bytes, pos = 0) {
      this.b = bytes;
      this.pos = pos;
    }

    skipSpace() {
      const b = this.b;
      for (;;) {
        while (this.pos < b.length && WS.has(b[this.pos])) this.pos++;
        // % começa um comentário que vai até o fim da linha.
        if (b[this.pos] !== 37) return;
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13)
          this.pos++;
      }
    }

    // Devolve o próximo valor; dicionários e listas são montados aqui mesmo.
    // Retorna undefined no fim dos dados.
    next() {
      this.skipSpace();
      const b = this.b;
      if (this.pos >= b.length) return undefined;
      const c = b[this.pos];

      if (c === 47) return this.name();
      if (c === 40) return this.literalString();
      if (c === 91) {
        this.pos++;
        const arr = [];
        for (;;) {
          const v = this.next();
          if (v === undefined || (v instanceof Op && v.op === "]")) return arr;
          arr.push(v);
        }
      }
      if (c === 93) {
        this.pos++;
        return new Op("]");
      }
      if (c === 60) {
        if (b[this.pos + 1] === 60) {
          this.pos += 2;
          return this.dict();
        }
        return this.hexString();
      }
      if (c === 62 && b[this.pos + 1] === 62) {
        this.pos += 2;
        return new Op(">>");
      }
      if (c === 123 || c === 125) {
        this.pos++;
        return new Op(String.fromCharCode(c));
      }

      // Palavra solta: número, true/false/null ou operador.
      const start = this.pos;
      while (
        this.pos < b.length &&
        !WS.has(b[this.pos]) &&
        !DELIM.has(b[this.pos])
      )
        this.pos++;
      if (this.pos === start) {
        this.pos++; // delimitador avulso (ex.: ">" solto): ignora
        return new Op(String.fromCharCode(c));
      }
      const word = latin1(b.subarray(start, this.pos));
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
      if (word === "true") return true;
      if (word === "false") return false;
      if (word === "null") return null;
      return new Op(word);
    }

    name() {
      const b = this.b;
      let s = "";
      this.pos++;
      while (
        this.pos < b.length &&
        !WS.has(b[this.pos]) &&
        !DELIM.has(b[this.pos])
      ) {
        // #20 dentro de um nome é o byte 0x20 (escape hexadecimal).
        if (b[this.pos] === 35) {
          s += String.fromCharCode(
            parseInt(latin1(b.subarray(this.pos + 1, this.pos + 3)), 16),
          );
          this.pos += 3;
        } else s += String.fromCharCode(b[this.pos++]);
      }
      return new Name(s);
    }

    // (texto) com parênteses aninhados e escapes \n, \(, \053…
    // Strings ficam como bytes: só a fonte sabe que letra cada byte é.
    literalString() {
      const b = this.b;
      const out = [];
      let depth = 1;
      this.pos++;
      while (this.pos < b.length) {
        let c = b[this.pos++];
        if (c === 40) depth++;
        else if (c === 41 && --depth === 0) break;
        else if (c === 92) {
          c = b[this.pos++];
          const esc = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 }[c];
          if (esc !== undefined) c = esc;
          else if (c >= 48 && c <= 55) {
            // Octal: até três dígitos.
            let n = c - 48;
            for (
              let i = 0;
              i < 2 && b[this.pos] >= 48 && b[this.pos] <= 55;
              i++
            )
              n = n * 8 + b[this.pos++] - 48;
            c = n & 0xff;
          } else if (c === 13 || c === 10) {
            // Barra no fim da linha: a string continua na próxima.
            if (c === 13 && b[this.pos] === 10) this.pos++;
            continue;
          }
        }
        out.push(c);
      }
      return Uint8Array.from(out);
    }

    hexString() {
      const b = this.b;
      let hex = "";
      this.pos++;
      while (this.pos < b.length && b[this.pos] !== 62) {
        if (!WS.has(b[this.pos])) hex += String.fromCharCode(b[this.pos]);
        this.pos++;
      }
      this.pos++;
      if (hex.length % 2) hex += "0";
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++)
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    // << /Chave valor … >> dentro de streams de conteúdo (ex.: BDC).
    dict() {
      const d = Object.create(null);
      for (;;) {
        const k = this.next();
        if (k === undefined || (k instanceof Op && k.op === ">>")) break;
        if (!(k instanceof Name)) continue;
        d[k.name] = this.next();
      }
      return d;
    }
  }

  // As listas montadas em next() não conhecem "R": este parser de
  // objeto completo trata listas e dicionários reconhecendo referências.
  function parseValue(lexer) {
    lexer.skipSpace();
    const b = lexer.b;
    if (b[lexer.pos] === 91) {
      lexer.pos++;
      const arr = [];
      for (;;) {
        lexer.skipSpace();
        if (b[lexer.pos] === 93) {
          lexer.pos++;
          return arr;
        }
        if (lexer.pos >= b.length) return arr;
        arr.push(parseValue(lexer));
      }
    }
    if (b[lexer.pos] === 60 && b[lexer.pos + 1] === 60) {
      lexer.pos += 2;
      const d = Object.create(null);
      for (;;) {
        lexer.skipSpace();
        if (b[lexer.pos] === 62 && b[lexer.pos + 1] === 62) {
          lexer.pos += 2;
          return d;
        }
        if (lexer.pos >= b.length) return d;
        const k = lexer.next();
        if (k instanceof Name) d[k.name] = parseValue(lexer);
      }
    }
    const v = lexer.next();
    if (typeof v === "number" && Number.isInteger(v)) {
      const save = lexer.pos;
      const gen = lexer.next();
      if (typeof gen === "number") {
        const r = lexer.next();
        if (r instanceof Op && r.op === "R") return new Ref(v, gen);
      }
      lexer.pos = save;
    }
    return v;
  }

  const latin1 = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return s;
  };

  // ---------- Filtros (descompressão) ----------
  /*
    FlateDecode é o zlib de sempre, e o navegador já sabe descomprimir:
    DecompressionStream("deflate"). Lemos pedaço a pedaço para aproveitar
    o que vier mesmo se o stream terminar com lixo (comum em PDFs).
  */
  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
      }
    } catch {
      // Dados corrompidos no fim: fica com o que já saiu.
    }
    const out = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  // Preditor PNG: cada linha guarda a diferença para a linha de cima.
  // Usado principalmente em xref streams.
  function unpredict(data, params) {
    const predictor = params?.Predictor || 1;
    if (predictor < 10) return data;
    const cols = params.Columns || 1;
    const bpp = Math.max(
      1,
      Math.ceil(((params.Colors || 1) * (params.BitsPerComponent || 8)) / 8),
    );
    const rowLen = cols * bpp;
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);
    for (let r = 0; r < rows; r++) {
      const type = data[r * (rowLen + 1)];
      const row = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      const cur = out.subarray(r * rowLen, (r + 1) * rowLen);
      for (let i = 0; i < rowLen; i++) {
        const left = i >= bpp ? cur[i - bpp] : 0;
        const up = prev[i];
        const ul = i >= bpp ? prev[i - bpp] : 0;
        let v = row[i];
        if (type === 1) v += left;
        else if (type === 2) v += up;
        else if (type === 3) v += (left + up) >> 1;
        else if (type === 4) {
          const p = left + up - ul;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - ul);
          v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
        }
        cur[i] = v & 0xff;
      }
      prev = cur;
    }
    return out;
  }

  // ---------- Documento ----------
  class Document {
    constructor(bytes) {
      this.b = bytes;
      this.offsets = new Map(); // num → byte do objeto
      this.inStream = new Map(); // num → [stream do objeto, índice]
      this.cache = new Map();
      this.trailer = Object.create(null);
    }

    // A xref pode ser tabela de texto ou (PDF 1.5+) um stream binário;
    // atualizações incrementais encadeiam várias xrefs via /Prev.
    async readXref() {
      const tail = latin1(this.b.subarray(Math.max(0, this.b.length - 2048)));
      const m = /startxref\s+(\d+)/g;
      let start = null;
      for (let r; (r = m.exec(tail));) start = Number(r[1]);
      const seen = new Set();
      try {
        while (start != null && !seen.has(start)) {
          seen.add(start);
          const lex = new Lexer(this.b, start);
          lex.skipSpace();
          const isTable =
            latin1(this.b.subarray(lex.pos, lex.pos + 4)) === "xref";
          const trailer = isTable
            ? this.readXrefTable(lex)
            : await this.readXrefStream(lex);
          for (const k in trailer)
            if (!(k in this.trailer)) this.trailer[k] = trailer[k];
          // Arquivos "híbridos": a tabela aponta também para um xref stream.
          if (trailer.XRefStm)
            await this.readXrefStream(new Lexer(this.b, trailer.XRefStm));
          start = trailer.Prev ?? null;
        }
      } catch {
        this.offsets.clear();
      }
      // Plano B para xref quebrada: procura "N 0 obj" no arquivo todo.
      if (!this.offsets.size || !this.trailer.Root) this.scanObjects();
    }

    readXrefTable(lex) {
      lex.pos += 4;
      for (;;) {
        const first = lex.next();
        if (first instanceof Op && first.op === "trailer") break;
        const count = lex.next();
        for (let i = 0; i < count; i++) {
          const off = lex.next();
          lex.next(); // geração
          const type = lex.next();
          const num = first + i;
          if (
            type.op === "n" &&
            !this.offsets.has(num) &&
            !this.inStream.has(num)
          )
            this.offsets.set(num, off);
        }
      }
      return parseValue(lex);
    }

    async readXrefStream(lex) {
      const stream = this.readIndirect(lex);
      const d = stream.dict;
      const data = await this.decode(stream);
      const [w1, w2, w3] = d.W;
      const index = d.Index || [0, d.Size];
      const entry = w1 + w2 + w3;
      const read = (pos, len) => {
        let v = 0;
        for (let i = 0; i < len; i++) v = v * 256 + data[pos + i];
        return v;
      };
      let pos = 0;
      for (let s = 0; s < index.length; s += 2) {
        for (let i = 0; i < index[s + 1]; i++, pos += entry) {
          const num = index[s] + i;
          const type = w1 ? read(pos, w1) : 1;
          const a = read(pos + w1, w2);
          const b = read(pos + w1 + w2, w3);
          if (this.offsets.has(num) || this.inStream.has(num)) continue;
          if (type === 1) this.offsets.set(num, a);
          else if (type === 2) this.inStream.set(num, [a, b]);
        }
      }
      return d;
    }

    scanObjects() {
      const text = latin1(this.b);
      for (const m of text.matchAll(/(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g))
        this.offsets.set(
          Number(m[1]),
          m.index + m[0].length - m[0].trimStart().length,
        );
      for (const m of text.matchAll(/trailer\s*<</g)) {
        const t = parseValue(new Lexer(this.b, m.index + 7));
        Object.assign(this.trailer, t);
      }
      if (!this.trailer.Root) {
        // Sem trailer: acha o catálogo pelo /Type /Catalog.
        const cat = /(\d+)\s+0\s+obj\s*<<[^>]*\/Type\s*\/Catalog/.exec(text);
        if (cat) this.trailer.Root = new Ref(Number(cat[1]), 0);
      }
    }

    // Lê "N G obj <valor> [stream…endstream] endobj" a partir do lexer.
    readIndirect(lex) {
      lex.next();
      lex.next();
      lex.next(); // "obj"
      const value = parseValue(lex);
      lex.skipSpace();
      const b = this.b;
      if (latin1(b.subarray(lex.pos, lex.pos + 6)) !== "stream") return value;
      let start = lex.pos + 6;
      if (b[start] === 13) start++;
      if (b[start] === 10) start++;
      let len = value.Length;
      if (len instanceof Ref) len = this.getSync(len);
      // Confere se "endstream" vem mesmo depois de Length bytes; se não, procura.
      let end = typeof len === "number" ? start + len : -1;
      const after = end >= 0 ? latin1(b.subarray(end, end + 12)) : "";
      if (!/^\s*endstream/.test(after)) {
        end = indexOf(b, "endstream", start);
        while (end > start && (b[end - 1] === 10 || b[end - 1] === 13)) end--;
      }
      return new Stream(value, b.subarray(start, end));
    }

    // Busca síncrona só para objetos simples fora de streams (ex.: /Length).
    getSync(ref) {
      const off = this.offsets.get(ref.num);
      if (off === undefined) return null;
      return this.readIndirect(new Lexer(this.b, off));
    }

    async get(ref) {
      if (!(ref instanceof Ref)) return ref;
      if (this.cache.has(ref.num)) return this.cache.get(ref.num);
      let value = null;
      const off = this.offsets.get(ref.num);
      if (off !== undefined) value = this.readIndirect(new Lexer(this.b, off));
      else if (this.inStream.has(ref.num)) {
        const [stmNum, idx] = this.inStream.get(ref.num);
        value = await this.fromObjectStream(stmNum, idx);
      }
      this.cache.set(ref.num, value);
      return value;
    }

    // Object stream: vários objetos comprimidos juntos; o cabeçalho lista
    // pares "número deslocamento" e /First diz onde começam os dados.
    async fromObjectStream(stmNum, idx) {
      const key = "objstm:" + stmNum;
      let parsed = this.cache.get(key);
      if (!parsed) {
        const stm = await this.get(new Ref(stmNum, 0));
        const data = await this.decode(stm);
        const head = new Lexer(data);
        const pairs = [];
        for (let i = 0; i < stm.dict.N; i++)
          pairs.push([head.next(), head.next()]);
        parsed = { data, first: stm.dict.First, pairs };
        this.cache.set(key, parsed);
      }
      const [, off] = parsed.pairs[idx];
      return parseValue(new Lexer(parsed.data, parsed.first + off));
    }

    // Aplica a cadeia de filtros do stream.
    async decode(stream) {
      if (!stream) return new Uint8Array();
      const key = stream;
      if (this.cache.has(key)) return this.cache.get(key);
      let data = stream.bytes;
      const filters = [].concat(stream.dict.Filter || []);
      const params = [].concat(stream.dict.DecodeParms || []);
      for (let i = 0; i < filters.length; i++) {
        const f = filters[i].name;
        const p = await this.get(params[i]);
        if (f === "FlateDecode") data = unpredict(await inflate(data), p);
        else if (f === "ASCIIHexDecode")
          data = new Lexer(Uint8Array.from([60, ...data, 62])).hexString();
        else if (f === "ASCII85Decode") data = ascii85(data);
        else return new Uint8Array(); // imagens (DCT, JPX…): não interessam
      }
      this.cache.set(key, data);
      return data;
    }

    // Árvore de páginas: /Pages tem /Kids; Resources e MediaBox são
    // "herdáveis", então descemos levando os valores do pai.
    async loadPages() {
      const catalog = await this.get(this.trailer.Root);
      this.pages = [];
      const walk = async (ref, inherited, seen) => {
        if (seen.has(ref.num)) return;
        seen.add(ref.num);
        const node = await this.get(ref);
        if (!node) return;
        const inh = { ...inherited };
        for (const k of ["Resources", "MediaBox", "CropBox", "Rotate"])
          if (node[k] !== undefined) inh[k] = node[k];
        if (isName(node.Type, "Pages") || node.Kids) {
          for (const kid of await this.get(node.Kids))
            await walk(kid, inh, seen);
        } else this.pages.push({ ...inh, ...node });
      };
      await walk(catalog.Pages, {}, new Set());
    }

    get pageCount() {
      return this.pages.length;
    }

    async pageItems(n) {
      const page = this.pages[n - 1];
      const box =
        (await this.get(page.CropBox)) || (await this.get(page.MediaBox));
      const items = [];
      const ctx = new TextRunner(this, items);
      const contents = await this.get(page.Contents);
      const parts = Array.isArray(contents) ? contents : [contents];
      // Conteúdo dividido em vários streams é um programa só: concatena.
      const chunks = [];
      for (const p of parts) {
        const s = p instanceof Ref ? await this.get(p) : p;
        if (s instanceof Stream)
          chunks.push(await this.decode(s), new Uint8Array([10]));
      }
      await ctx.run(concat(chunks), await this.get(page.Resources), IDENTITY);
      // y cresce para cima no PDF; invertemos para ficar como na tela.
      const top = box ? box[3] : 792;
      for (const it of items) it.y = +(top - it.y).toFixed(2);
      return items;
    }
  }

  function ascii85(data) {
    const out = [];
    let tuple = 0;
    let count = 0;
    for (const c of data) {
      if (c === 126) break; // ~> termina
      if (WS.has(c)) continue;
      if (c === 122 && count === 0) {
        out.push(0, 0, 0, 0);
        continue;
      }
      tuple = tuple * 85 + (c - 33);
      if (++count === 5) {
        out.push(
          (tuple >>> 24) & 255,
          (tuple >>> 16) & 255,
          (tuple >>> 8) & 255,
          tuple & 255,
        );
        tuple = 0;
        count = 0;
      }
    }
    if (count) {
      for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
      for (let i = 0; i < count - 1; i++)
        out.push((tuple >>> (24 - i * 8)) & 255);
    }
    return Uint8Array.from(out);
  }

  function concat(chunks) {
    const out = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function indexOf(bytes, text, from) {
    const first = text.charCodeAt(0);
    outer: for (let i = from; i <= bytes.length - text.length; i++) {
      if (bytes[i] !== first) continue;
      for (let j = 1; j < text.length; j++)
        if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
      return i;
    }
    return -1;
  }

  // ---------- Matrizes 2D [a b c d e f] ----------
  const IDENTITY = [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];

  // ---------- Fontes: código do glifo → letra ----------
  /*
    O texto no PDF são códigos de glifo, não letras. Cada fonte diz como
    traduzir: um mapa ToUnicode (o melhor), uma codificação padrão
    (WinAnsi…) ou uma lista /Differences com nomes de glifos ("Aacute").
  */
  // WinAnsi = Latin-1, exceto 0x80–0x9F (aspas curvas, travessões…).
  const WIN_ANSI_HIGH =
    "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
  function winAnsi(code) {
    if (code >= 0x80 && code <= 0x9f) return WIN_ANSI_HIGH[code - 0x80];
    return String.fromCharCode(code);
  }

  const GLYPHS = {
    space: " ",
    exclam: "!",
    quotedbl: '"',
    numbersign: "#",
    dollar: "$",
    percent: "%",
    ampersand: "&",
    quotesingle: "'",
    parenleft: "(",
    parenright: ")",
    asterisk: "*",
    plus: "+",
    comma: ",",
    hyphen: "-",
    period: ".",
    slash: "/",
    colon: ":",
    semicolon: ";",
    less: "<",
    equal: "=",
    greater: ">",
    question: "?",
    at: "@",
    bracketleft: "[",
    backslash: "\\",
    bracketright: "]",
    asciicircum: "^",
    underscore: "_",
    grave: "`",
    braceleft: "{",
    bar: "|",
    braceright: "}",
    asciitilde: "~",
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    endash: "–",
    emdash: "—",
    quoteleft: "‘",
    quoteright: "’",
    quotedblleft: "“",
    quotedblright: "”",
    quotesinglbase: "‚",
    quotedblbase: "„",
    bullet: "•",
    ellipsis: "…",
    ordfeminine: "ª",
    ordmasculine: "º",
    degree: "°",
    multiply: "×",
    divide: "÷",
    minus: "−",
    periodcentered: "·",
    nbspace: " ",
    guillemotleft: "«",
    guillemotright: "»",
    copyright: "©",
    registered: "®",
    trademark: "™",
    section: "§",
    paragraph: "¶",
    dagger: "†",
    daggerdbl: "‡",
    germandbls: "ß",
    ae: "æ",
    oe: "œ",
    AE: "Æ",
    OE: "Œ",
    oslash: "ø",
    Oslash: "Ø",
    dotlessi: "ı",
    onehalf: "½",
    onequarter: "¼",
    threequarters: "¾",
    plusminus: "±",
    exclamdown: "¡",
    questiondown: "¿",
    sterling: "£",
    cent: "¢",
    yen: "¥",
    Euro: "€",
    fi: "fi",
    fl: "fl",
    ff: "ff",
    ffi: "ffi",
    ffl: "ffl",
    softhyphen: "-",
    figuredash: "‒",
    uni00A0: " ",
  };
  // "Aacute" = A + acento agudo: monta com o caractere combinante e
  // normaliza (NFC) para virar um "Á" só.
  const MARKS = {
    acute: "́",
    grave: "̀",
    circumflex: "̂",
    tilde: "̃",
    dieresis: "̈",
    cedilla: "̧",
    ring: "̊",
    caron: "̌",
    macron: "̄",
    breve: "̆",
    dotaccent: "̇",
    ogonek: "̨",
    hungarumlaut: "̋",
  };

  function glyphToUnicode(name) {
    // Sufixos de variante (".sc", ".lprp", ".alt") não mudam a letra.
    let n = name.split(".")[0];
    let lower = false;
    // Versaletes ("Asmall"): visualmente maiúsculas pequenas, mas a
    // letra é minúscula ("Fúria" em versalete continua "Fúria").
    if (/^.+small$/.test(n)) {
      n = n.slice(0, -5);
      lower = true;
    }
    let s = GLYPHS[n];
    if (s === undefined) {
      const uni =
        /^uni([0-9A-Fa-f]{4,})$/.exec(n) || /^u([0-9A-Fa-f]{4,6})$/.exec(n);
      const mark = /^([A-Za-z])([a-z]+)$/.exec(n);
      if (uni) {
        const hex = uni[1];
        s = "";
        for (let i = 0; i < hex.length; i += 4)
          s += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16));
      } else if (/^[A-Za-z]$/.test(n)) s = n;
      else if (mark && MARKS[mark[2]])
        s = (mark[1] + MARKS[mark[2]]).normalize("NFC");
      else return null;
    }
    return lower ? s.toLowerCase() : s;
  }

  // CMap ToUnicode: tabelas "bfchar" (código → texto) e "bfrange"
  // (faixa de códigos → faixa de textos), com o destino em UTF-16.
  function parseCMap(bytes) {
    const lex = new Lexer(bytes);
    const map = new Map();
    const ranges = []; // tamanhos em bytes dos códigos (codespacerange)
    const utf16 = (b) => {
      let s = "";
      for (let i = 0; i + 1 < b.length; i += 2)
        s += String.fromCharCode((b[i] << 8) | b[i + 1]);
      if (b.length % 2) s += String.fromCharCode(b[b.length - 1]);
      return s;
    };
    const num = (b) => b.reduce((a, x) => a * 256 + x, 0);
    let mode = null;
    const stack = [];
    for (let t; (t = lex.next()) !== undefined;) {
      if (t instanceof Op) {
        const op = t.op;
        if (
          op === "begincodespacerange" ||
          op === "beginbfchar" ||
          op === "beginbfrange"
        ) {
          mode = op;
          stack.length = 0;
        } else if (op === "endcodespacerange") {
          for (let i = 0; i + 1 < stack.length; i += 2)
            ranges.push({
              len: stack[i].length,
              lo: num(stack[i]),
              hi: num(stack[i + 1]),
            });
          mode = null;
        } else if (op === "endbfchar") {
          for (let i = 0; i + 1 < stack.length; i += 2)
            map.set(num(stack[i]), utf16(stack[i + 1]));
          mode = null;
        } else if (op === "endbfrange") {
          for (let i = 0; i + 2 < stack.length; i += 3) {
            const lo = num(stack[i]);
            const hi = num(stack[i + 1]);
            const dst = stack[i + 2];
            for (let c = lo; c <= hi && c - lo < 65536; c++) {
              if (Array.isArray(dst)) {
                if (dst[c - lo]) map.set(c, utf16(dst[c - lo]));
              } else {
                // Incrementa o último caractere do destino a cada código.
                const s = utf16(dst);
                map.set(
                  c,
                  s.slice(0, -1) +
                    String.fromCharCode(s.charCodeAt(s.length - 1) + c - lo),
                );
              }
            }
          }
          mode = null;
        }
      } else if (mode) stack.push(t);
    }
    return { map, ranges };
  }

  class Font {
    static async load(doc, ref) {
      const key = "font:" + (ref instanceof Ref ? ref.num : Math.random());
      if (doc.cache.has(key)) return doc.cache.get(key);
      const font = new Font();
      await font.init(doc, await doc.get(ref));
      doc.cache.set(key, font);
      return font;
    }

    async init(doc, dict) {
      dict = dict || {};
      this.name = (dict.BaseFont?.name || "?").replace(/^[A-Z]{6}\+/, "");
      this.bold = /bold|black|heavy|semibold/i.test(this.name);
      this.italic = /italic|oblique/i.test(this.name);
      this.type0 = isName(dict.Subtype, "Type0");
      this.widths = new Map();
      this.defaultWidth = 500;
      this.toUnicode = null;
      this.ranges = [];

      const tu = await doc.get(dict.ToUnicode);
      if (tu instanceof Stream) {
        const cmap = parseCMap(await doc.decode(tu));
        this.toUnicode = cmap.map;
        this.ranges = cmap.ranges;
      }

      if (this.type0) {
        // Fonte composta: códigos de 2 bytes (Identity-H) e larguras no
        // formato /W [c [w1 w2…]] ou [c1 c2 w] da fonte descendente.
        const desc = await doc.get((await doc.get(dict.DescendantFonts))?.[0]);
        this.defaultWidth = desc?.DW ?? 1000;
        const w = (await doc.get(desc?.W)) || [];
        for (let i = 0; i < w.length;) {
          const c = w[i];
          const next = await doc.get(w[i + 1]);
          if (Array.isArray(next)) {
            next.forEach((width, j) => this.widths.set(c + j, width));
            i += 2;
          } else {
            for (let k = c; k <= next; k++) this.widths.set(k, w[i + 2]);
            i += 3;
          }
        }
        if (!this.ranges.length) this.ranges = [{ len: 2, lo: 0, hi: 0xffff }];
        return;
      }

      // Fonte simples: 1 byte por glifo.
      this.ranges = [{ len: 1, lo: 0, hi: 255 }];
      const first = dict.FirstChar ?? 0;
      const widths = (await doc.get(dict.Widths)) || [];
      widths.forEach((w, i) => this.widths.set(first + i, w));
      const descriptor = await doc.get(dict.FontDescriptor);
      if (descriptor?.MissingWidth) this.defaultWidth = descriptor.MissingWidth;

      this.encoding = new Map();
      const enc = await doc.get(dict.Encoding);
      const diffs =
        enc && !isName(enc) ? (await doc.get(enc.Differences)) || [] : [];
      let code = 0;
      for (const d of diffs) {
        if (typeof d === "number") code = d;
        else if (isName(d)) {
          const s = glyphToUnicode(d.name);
          if (s !== null) this.encoding.set(code, s);
          code++;
        }
      }
    }

    // Quebra os bytes de uma string em códigos (1 ou 2 bytes cada,
    // conforme os codespaceranges da CMap).
    codes(bytes) {
      const out = [];
      for (let i = 0; i < bytes.length;) {
        let done = false;
        for (const r of this.ranges) {
          if (i + r.len > bytes.length) continue;
          let c = 0;
          for (let k = 0; k < r.len; k++) c = c * 256 + bytes[i + k];
          if (c >= r.lo && c <= r.hi) {
            out.push({ code: c, len: r.len });
            i += r.len;
            done = true;
            break;
          }
        }
        if (!done) out.push({ code: bytes[i++], len: 1 });
      }
      return out;
    }

    text(code) {
      const fromMap = this.toUnicode?.get(code);
      if (fromMap !== undefined) return fromMap;
      if (this.type0) return "";
      return this.encoding.get(code) ?? winAnsi(code);
    }

    width(code) {
      return this.widths.get(code) ?? this.defaultWidth;
    }
  }

  // ---------- Execução do stream de conteúdo ----------
  class TextRunner {
    constructor(doc, items) {
      this.doc = doc;
      this.items = items;
    }

    async run(bytes, resources, ctm, depth = 0) {
      const doc = this.doc;
      resources = (await doc.get(resources)) || {};
      const fonts = (await doc.get(resources.Font)) || {};
      const xobjects = (await doc.get(resources.XObject)) || {};
      // Estado gráfico: q/Q empilham a matriz e os parâmetros de texto.
      let gs = { ctm, font: null, size: 0, Tc: 0, Tw: 0, Th: 1, TL: 0, Ts: 0 };
      const stack = [];
      let tm = IDENTITY;
      let tlm = IDENTITY;
      const lex = new Lexer(bytes);
      const args = [];

      const show = (strings) => {
        const f = gs.font;
        if (!f) return;
        // Matriz de renderização: posição e escala reais do texto na página.
        const trm = mul(
          mul([gs.size * gs.Th, 0, 0, gs.size, 0, gs.Ts], tm),
          gs.ctm,
        );
        const scale = Math.hypot(trm[2], trm[3]); // altura efetiva da letra
        const x0 = trm[4];
        const y0 = trm[5];
        let str = "";
        let adv = 0; // avanço em unidades de texto
        for (const s of strings) {
          if (typeof s === "number") {
            // Número no TJ: recuo em milésimos de em. Bem negativo = espaço.
            const shift = (-s / 1000) * gs.size * gs.Th;
            if (s < -250 && !str.endsWith(" ")) str += " ";
            adv += shift;
            continue;
          }
          for (const { code, len } of f.codes(s)) {
            str += f.text(code);
            const space = len === 1 && code === 32 ? gs.Tw : 0;
            adv += ((f.width(code) / 1000) * gs.size + gs.Tc + space) * gs.Th;
          }
        }
        tm = mul([1, 0, 0, 1, adv, 0], tm);
        const end = mul(
          mul([gs.size * gs.Th, 0, 0, gs.size, 0, gs.Ts], tm),
          gs.ctm,
        );
        if (str.trim() === "" && !str.includes(" ")) return;
        this.items.push({
          str,
          x: +x0.toFixed(2),
          y: y0,
          w: +(end[4] - x0).toFixed(2),
          size: +scale.toFixed(2),
          font: f.name,
          bold: f.bold,
          italic: f.italic,
        });
      };

      for (let t; (t = lex.next()) !== undefined;) {
        if (!(t instanceof Op)) {
          args.push(t);
          continue;
        }
        const a = args;
        switch (t.op) {
          case "q":
            stack.push(gs);
            gs = { ...gs };
            break;
          case "Q":
            if (stack.length) gs = stack.pop();
            break;
          case "cm":
            gs.ctm = mul(a.slice(0, 6), gs.ctm);
            break;
          case "BT":
            tm = tlm = IDENTITY;
            break;
          case "Tf":
            gs.font = fonts[a[0]?.name]
              ? await Font.load(doc, fonts[a[0].name])
              : null;
            gs.size = a[1];
            break;
          case "Tc":
            gs.Tc = a[0];
            break;
          case "Tw":
            gs.Tw = a[0];
            break;
          case "Tz":
            gs.Th = a[0] / 100;
            break;
          case "TL":
            gs.TL = a[0];
            break;
          case "Ts":
            gs.Ts = a[0];
            break;
          case "Td":
            tm = tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm);
            break;
          case "TD":
            gs.TL = -a[1];
            tm = tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm);
            break;
          case "Tm":
            tm = tlm = a.slice(0, 6);
            break;
          case "T*":
            tm = tlm = mul([1, 0, 0, 1, 0, -gs.TL], tlm);
            break;
          case "Tj":
            show([a[0]]);
            break;
          case "TJ":
            show(a[0] || []);
            break;
          case "'":
            tm = tlm = mul([1, 0, 0, 1, 0, -gs.TL], tlm);
            show([a[0]]);
            break;
          case '"':
            gs.Tw = a[0];
            gs.Tc = a[1];
            tm = tlm = mul([1, 0, 0, 1, 0, -gs.TL], tlm);
            show([a[2]]);
            break;
          case "Do": {
            // Form XObject: um "subprograma" com matriz e recursos próprios.
            const ref = xobjects[a[0]?.name];
            const xo = await doc.get(ref);
            if (
              depth < 12 &&
              xo instanceof Stream &&
              isName(xo.dict.Subtype, "Form")
            ) {
              const m = (await doc.get(xo.dict.Matrix)) || IDENTITY;
              await this.run(
                await doc.decode(xo),
                xo.dict.Resources || resources,
                mul(m, gs.ctm),
                depth + 1,
              );
            }
            break;
          }
          case "BI": {
            // Imagem inline: pula os bytes até o "EI" final.
            const end = indexOf(bytes, "EI", lex.pos);
            const id = indexOf(bytes, "ID", lex.pos);
            let p = id + 3;
            for (;;) {
              p = indexOf(bytes, "EI", p);
              if (p < 0 || WS.has(bytes[p + 2]) || p + 2 >= bytes.length) break;
              p++;
            }
            lex.pos = p < 0 ? (end < 0 ? bytes.length : end + 2) : p + 2;
            break;
          }
        }
        args.length = 0;
      }
    }
  }

  // ---------- Pedaços → linhas ----------
  /*
    Os itens saem na ordem do stream, que no InDesign já é a de leitura
    por quadro de texto. Uma linha nova começa quando o y muda; dentro
    da linha, um vão maior que ~15% da altura da letra vira espaço.
  */
  function toLines(items) {
    const lines = [];
    let cur = null;
    for (const it of items) {
      const sameLine =
        cur &&
        Math.abs(it.y - cur.y) < Math.max(it.size, cur.size) * 0.4 &&
        it.x >= cur.end - cur.size;
      if (!sameLine) {
        cur = {
          text: it.str,
          x: it.x,
          y: it.y,
          end: it.x + it.w,
          size: it.size,
          font: it.font,
          bold: it.bold,
          italic: it.italic,
          // Os pedaços originais ficam na linha: tabelas e rótulos em
          // negrito ("Alcance:") precisam das posições de cada um.
          items: [it],
        };
        lines.push(cur);
        continue;
      }
      const gap = it.x - cur.end;
      if (
        gap > it.size * 0.15 &&
        !cur.text.endsWith(" ") &&
        !it.str.startsWith(" ")
      )
        cur.text += " ";
      cur.text += it.str;
      cur.items.push(it);
      cur.end = it.x + it.w;
      cur.size = Math.max(cur.size, it.size);
    }
    for (const l of lines) l.text = l.text.replace(/\s+/g, " ").trim();
    return lines.filter((l) => l.text);
  }

  async function open(buffer) {
    const doc = new Document(new Uint8Array(buffer));
    await doc.readXref();
    if (doc.trailer.Encrypt) throw new Error("PDF criptografado");
    await doc.loadPages();
    return doc;
  }

  async function sha256(buffer) {
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const PDF = { open, toLines, sha256 };
  // No navegador vira global (window.PDF); no Node, module.exports.
  if (typeof module === "object" && module.exports) module.exports = PDF;
  else root.PDF = PDF;
})(globalThis);
