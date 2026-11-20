/*
  unityfs.js: lê um AssetBundle do Unity (formato UnityFS) sem bibliotecas.

  Um bundle é: cabeçalho → tabela de blocos (comprimida) → blocos de dados
  (LZ4 ou LZMA) → arquivos internos. O arquivo "CAB-…" é um SerializedFile:
  uma lista de objetos, cada um descrito por uma árvore de tipos (TypeTree)
  que diz campo a campo como ler os bytes. Só precisamos do AnimationClip
  (classID 74), que guarda as curvas de rotação de cada osso.
*/

function lz4(src, outSize) {
  const out = Buffer.alloc(outSize);
  let i = 0,
    o = 0;
  while (i < src.length) {
    const tok = src[i++];
    let lit = tok >> 4;
    if (lit === 15) {
      let x;
      do {
        x = src[i++];
        lit += x;
      } while (x === 255);
    }
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let ml = tok & 15;
    if (ml === 15) {
      let x;
      do {
        x = src[i++];
        ml += x;
      } while (x === 255);
    }
    ml += 4;
    for (let k = 0; k < ml; k++) {
      out[o] = out[o - off];
      o++;
    }
  }
  return out;
}

// LZMA do Unity: 5 bytes de propriedades + dados. O xz lê o formato "lzma-alone"
// (propriedades + tamanho de 8 bytes + dados), então montamos esse cabeçalho.
function unlzma(raw, size) {
  const head = Buffer.alloc(13);
  raw.copy(head, 0, 0, 5);
  head.writeBigUInt64LE(BigInt(size), 5);
  const alone = Buffer.concat([head, raw.subarray(5)]);
  return require("child_process").execFileSync("xz", ["--format=lzma", "-dc"], {
    input: alone,
    maxBuffer: 1 << 28,
  });
}

function readBundle(b) {
  let o = 0;
  const cstr = () => {
    const e = b.indexOf(0, o);
    const s = b.toString("utf8", o, e);
    o = e + 1;
    return s;
  };
  cstr();
  o += 4;
  cstr();
  cstr();
  o += 8;
  const cs = b.readUInt32BE(o),
    us = b.readUInt32BE(o + 4),
    fl = b.readUInt32BE(o + 8);
  o += 12;
  let infoRaw;
  if (fl & 0x80) infoRaw = b.subarray(b.length - cs);
  else {
    infoRaw = b.subarray(o, o + cs);
    o += cs;
  }
  const info = (fl & 0x3f) >= 2 ? lz4(infoRaw, us) : infoRaw;
  let p = 16;
  const nb = info.readInt32BE(p);
  p += 4;
  const blocks = [];
  for (let k = 0; k < nb; k++) {
    blocks.push([
      info.readUInt32BE(p),
      info.readUInt32BE(p + 4),
      info.readUInt16BE(p + 8),
    ]);
    p += 10;
  }
  const nn = info.readInt32BE(p);
  p += 4;
  const nodes = [];
  for (let k = 0; k < nn; k++) {
    const off = Number(info.readBigInt64BE(p)),
      size = Number(info.readBigInt64BE(p + 8));
    p += 20;
    const e = info.indexOf(0, p);
    const path = info.toString("utf8", p, e);
    p = e + 1;
    nodes.push({ off, size, path });
  }
  const parts = [];
  for (const [u, c, f] of blocks) {
    const raw = b.subarray(o, o + c);
    o += c;
    const kind = f & 0x3f;
    parts.push(kind >= 2 ? lz4(raw, u) : kind === 1 ? unlzma(raw, u) : raw);
  }
  const data = Buffer.concat(parts);
  return nodes.map((n) => ({
    path: n.path,
    data: data.subarray(n.off, n.off + n.size),
  }));
}

function readSerialized(d) {
  let o = 0;
  const metaSize = d.readUInt32BE(0),
    fileSize = d.readUInt32BE(4),
    version = d.readUInt32BE(8),
    dataOffset = d.readUInt32BE(12);
  const big = d[16];
  o = 20;
  const LE = !big;
  const u32 = () => {
    const v = LE ? d.readUInt32LE(o) : d.readUInt32BE(o);
    o += 4;
    return v;
  };
  const i32 = () => {
    const v = LE ? d.readInt32LE(o) : d.readInt32BE(o);
    o += 4;
    return v;
  };
  const i16 = () => {
    const v = LE ? d.readInt16LE(o) : d.readInt16BE(o);
    o += 2;
    return v;
  };
  const i64 = () => {
    const v = LE ? d.readBigInt64LE(o) : d.readBigInt64BE(o);
    o += 8;
    return Number(v);
  };
  const cstr = () => {
    const e = d.indexOf(0, o);
    const s = d.toString("utf8", o, e);
    o = e + 1;
    return s;
  };
  const align = () => {
    o = (o + 3) & ~3;
  };
  const unityVer = cstr();
  const platform = i32();
  const hasTT = d[o++];
  const nTypes = i32();
  const types = [];
  for (let t = 0; t < nTypes; t++) {
    const classID = i32();
    o += 1;
    const script = i16();
    if (classID === 114 || (version >= 16 && script >= 0) || classID < 0)
      o += 16;
    o += 16;
    let nodes = [];
    if (hasTT) {
      const nNodes = i32(),
        strSize = i32();
      const raw = [];
      for (let k = 0; k < nNodes; k++) {
        const ver = i16(),
          level = d[o++],
          isArray = d[o++];
        const typeOff = u32(),
          nameOff = u32(),
          size = i32(),
          index = i32(),
          flags = i32();
        raw.push({ level, isArray, typeOff, nameOff, size, flags });
      }
      const strs = d.subarray(o, o + strSize);
      o += strSize;
      const str = (off) =>
        off & 0x80000000
          ? COMMON[off & 0x7fffffff]
          : strs.toString("utf8", off, strs.indexOf(0, off));
      nodes = raw.map((r) => ({
        ...r,
        type: str(r.typeOff),
        name: str(r.nameOff),
      }));
      if (version >= 21) {
        const n = i32();
        o += n * 4;
      }
    }
    types.push({ classID, nodes });
  }
  const nObj = i32();
  const objs = [];
  for (let k = 0; k < nObj; k++) {
    align();
    const pathID = i64();
    const byteStart = u32();
    const byteSize = u32();
    const typeIdx = i32();
    objs.push({
      pathID,
      byteStart: byteStart + dataOffset,
      byteSize,
      type: types[typeIdx],
    });
  }
  return { d, LE, objs };
}

// Strings comuns do Unity (índices usados pelo TypeTree).
const COMMON_STR =
  "AABB\0AnimationClip\0AnimationCurve\0AnimationState\0Array\0Base\0BitField\0bitset\0bool\0char\0ColorRGBA\0Component\0data\0deque\0double\0dynamic_array\0FastPropertyName\0first\0float\0Font\0GameObject\0Generic Mono\0GradientNEW\0GUID\0GUIStyle\0int\0list\0long long\0map\0Matrix4x4f\0MdFour\0MonoBehaviour\0MonoScript\0m_ByteSize\0m_Curve\0m_EditorClassIdentifier\0m_EditorHideFlags\0m_Enabled\0m_ExtensionPtr\0m_GameObject\0m_Index\0m_IsArray\0m_IsStatic\0m_MetaFlag\0m_Name\0m_ObjectHideFlags\0m_PrefabInternal\0m_PrefabParentObject\0m_Script\0m_StaticEditorFlags\0m_Type\0m_Version\0Object\0pair\0PPtr<Component>\0PPtr<GameObject>\0PPtr<Material>\0PPtr<MonoBehaviour>\0PPtr<MonoScript>\0PPtr<Object>\0PPtr<Prefab>\0PPtr<Sprite>\0PPtr<TextAsset>\0PPtr<Texture>\0PPtr<Texture2D>\0PPtr<Transform>\0Prefab\0Quaternionf\0Rectf\0RectInt\0RectOffset\0second\0set\0short\0size\0SInt16\0SInt32\0SInt64\0SInt8\0staticvector\0string\0TextAsset\0TextMesh\0Texture\0Texture2D\0Transform\0TypelessData\0UInt16\0UInt32\0UInt64\0UInt8\0unsigned int\0unsigned long long\0unsigned short\0vector\0Vector2f\0Vector3f\0Vector4f\0m_ScriptingClassIdentifier\0Gradient\0Type*\0int2_storage\0int3_storage\0BoundsInt\0m_CorrespondingSourceObject\0m_PrefabInstance\0m_PrefabAsset\0FileSize\0Hash128\0";
const COMMON = {};
{
  let off = 0;
  for (const s of COMMON_STR.split("\0")) {
    COMMON[off] = s;
    off += Buffer.byteLength(s) + 1;
  }
}

// Lê um objeto seguindo a árvore de tipos.
function readObject(sf, obj) {
  const { d, LE } = sf;
  let o = obj.byteStart;
  const nodes = obj.type.nodes;
  const R = {
    SInt8: () => d.readInt8(o++),
    UInt8: () => d[o++],
    char: () => d[o++],
    bool: () => !!d[o++],
    SInt16: () => {
      const v = LE ? d.readInt16LE(o) : d.readInt16BE(o);
      o += 2;
      return v;
    },
    short: () => R.SInt16(),
    UInt16: () => {
      const v = LE ? d.readUInt16LE(o) : d.readUInt16BE(o);
      o += 2;
      return v;
    },
    "unsigned short": () => R.UInt16(),
    SInt32: () => {
      const v = LE ? d.readInt32LE(o) : d.readInt32BE(o);
      o += 4;
      return v;
    },
    int: () => R.SInt32(),
    UInt32: () => {
      const v = LE ? d.readUInt32LE(o) : d.readUInt32BE(o);
      o += 4;
      return v;
    },
    "unsigned int": () => R.UInt32(),
    Type: () => R.UInt32(),
    "Type*": () => R.UInt32(),
    SInt64: () => {
      const v = LE ? d.readBigInt64LE(o) : d.readBigInt64BE(o);
      o += 8;
      return Number(v);
    },
    "long long": () => R.SInt64(),
    UInt64: () => {
      const v = LE ? d.readBigUInt64LE(o) : d.readBigUInt64BE(o);
      o += 8;
      return Number(v);
    },
    "unsigned long long": () => R.UInt64(),
    FileSize: () => R.UInt64(),
    float: () => {
      const v = LE ? d.readFloatLE(o) : d.readFloatBE(o);
      o += 4;
      return v;
    },
    double: () => {
      const v = LE ? d.readDoubleLE(o) : d.readDoubleBE(o);
      o += 8;
      return v;
    },
  };
  const children = (i) => {
    const out = [];
    const lv = nodes[i].level;
    for (let j = i + 1; j < nodes.length && nodes[j].level > lv; j++)
      if (nodes[j].level === lv + 1) out.push(j);
    return out;
  };
  function read(i) {
    const n = nodes[i];
    let v;
    const ch = children(i);
    if (n.type === "string") {
      const len = R.SInt32();
      v = d.toString("utf8", o, o + len);
      o += len;
      if (nodes[ch[0]]?.flags & 0x4000 || n.flags & 0x4000) o = (o + 3) & ~3;
      else o = (o + 3) & ~3;
      return v;
    }
    if (ch.length === 1 && nodes[ch[0]].isArray) {
      v = readArray(ch[0]);
    } else if (n.isArray) {
      v = readArray(i);
    } else if (ch.length === 0) {
      if (n.type === "TypelessData") {
        const len = R.SInt32();
        v = d.subarray(o, o + len);
        o += len;
      } else if (R[n.type]) v = R[n.type]();
      else throw new Error("tipo " + n.type);
    } else {
      v = {};
      for (const c of ch) v[nodes[c].name] = read(c);
    }
    if (n.flags & 0x4000) o = (o + 3) & ~3;
    return v;
  }
  function readArray(ai) {
    const ch = children(ai); // [size, data]
    const size = R.SInt32();
    const el = ch[1];
    const out = [];
    const et = nodes[el].type;
    if (et === "UInt8" || et === "char") {
      const v = d.subarray(o, o + size);
      o += size;
      if (nodes[ai].flags & 0x4000) o = (o + 3) & ~3;
      return v;
    }
    for (let k = 0; k < size; k++) out.push(read(el));
    if (nodes[ai].flags & 0x4000) o = (o + 3) & ~3;
    return out;
  }
  return read(0);
}

// O primeiro AnimationClip do bundle, como objeto JS.
function clipFromBundle(buffer) {
  for (const f of readBundle(buffer)) {
    if (!f.path.startsWith("CAB-") || f.path.endsWith(".resS")) continue;
    const sf = readSerialized(f.data);
    const obj = sf.objs.find((o) => o.type.classID === 74);
    if (obj) return readObject(sf, obj);
  }
  throw new Error("bundle sem AnimationClip");
}

module.exports = { clipFromBundle };
