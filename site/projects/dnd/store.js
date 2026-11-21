/*
  Cache local do d&d.exe: guarda os dados extraídos de cada livro no
  IndexedDB do navegador, para não precisar reabrir o PDF a cada visita.
  Nada sai do computador: o IndexedDB é um banco de dados que fica no
  próprio navegador, separado por site.

  Por que IndexedDB e não localStorage? O localStorage só guarda texto e
  costuma parar em ~5 MB; o IndexedDB guarda objetos inteiros (por
  "structured clone") e aguenta bem mais. Um livro dá ~1,2 MB.
*/
(function (root) {
  "use strict";

  const DB_NAME = "dnd-exe";
  const STORE = "books"; // um registro por livro, chave = id da fonte

  /*
    A API do IndexedDB é de eventos (onsuccess/onerror), de antes das
    Promises. Este embrulho transforma cada pedido numa Promise, para o
    resto do código usar await.
  */
  const done = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  let opening = null;
  function db() {
    // Abre uma vez só e reaproveita a conexão.
    opening ||= new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error("IndexedDB indisponível"));
      const req = indexedDB.open(DB_NAME, 1);
      // onupgradeneeded roda na primeira vez (ou ao subir a versão): é
      // o único momento em que dá para criar os "object stores".
      req.onupgradeneeded = () =>
        req.result.createObjectStore(STORE, { keyPath: "source" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opening;
  }

  // Toda operação acontece dentro de uma transação, que fecha sozinha.
  async function tx(mode, run) {
    const t = (await db()).transaction(STORE, mode);
    return done(run(t.objectStore(STORE)));
  }

  root.Store = {
    /*
      Guarda { source, name, version, savedAt, data }. "version" é a
      versão do extrator: se o código de leitura mudar, o cache antigo
      deixa de valer e o livro precisa ser lido de novo.
    */
    save: (record) => tx("readwrite", (s) => s.put(record)),
    all: () => tx("readonly", (s) => s.getAll()),
    forget: (source) => tx("readwrite", (s) => s.delete(source)),
  };
})(globalThis);
