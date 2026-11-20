# home

Minha página inicial e vitrine de pequenos projetos de aprendizado, feitos só com **HTML, CSS e JavaScript puro**, sem frameworks, bibliotecas ou etapa de build.

🌐 https://vanderleijr.github.io/home/ · [English](https://vanderleijr.github.io/home/?lang=en)

## Para quem quer aprender

O código é aberto e foi escrito para ser lido: cada projeto traz comentários explicando o _porquê_ das técnicas usadas. Abra a pasta do projeto em [`site/projects/`](site/projects/) ou use "Exibir código-fonte" no navegador.

## Projetos

- [🎴 kana.exe](https://vanderleijr.github.io/home/projects/kana/): flashcards de hiragana e katakana: jornada por níveis com estrelas (salva no `localStorage`), desafio contra o tempo e modo infinito ([código](site/projects/kana/)).
- [🤟 libras.exe](https://vanderleijr.github.io/home/projects/libras/): flashcards do alfabeto manual e dos números da Libras, feitos por um personagem 3D (WebGL puro, feminino ou masculino) com mão articulada; sinais e movimentos medidos das animações do [VLibras](https://www.vlibras.gov.br/): jornada por níveis, contra o tempo e infinito ([código](site/projects/libras/)).

## Estrutura

```
site/                     ← única pasta publicada
├── index.html            página inicial
├── assets/               base compartilhada (scene.*, i18n.js, win98.css, desktop.js) + CSS/JS da página inicial
├── i18n/                 textos de cada idioma (pt-BR.json, en.json…) e languages.json
└── projects/<projeto>/   cada projeto: HTML + CSS + JS
tools/vlibras/            gerador dos sinais do libras.exe (fora do site)
tools/dnd/                diagnóstico e conferência do extrator do d&d.exe (fora do site)
```

## d&d.exe (em construção, branch `feature/dnd`)

Criador de personagem de D&D 2024 que lê o **seu** PDF do Livro do Jogador direto no navegador: nenhum conteúdo dos livros fica no repositório nem é enviado a lugar nenhum. `pdf.js` é um leitor de PDF próprio (sem bibliotecas), `extract.js` reúne ferramentas genéricas de extração e cada livro suportado é uma fonte em `sources/` (reconhecida pelo SHA-256 do arquivo). Os dados extraídos ficam guardados só no navegador (IndexedDB, `store.js`), com botão para esquecê-los. `rules.js` faz só a matemática das regras (modificadores, PV, CA, magias) sobre esses dados. O assistente (`wizard.js`) leva da classe ao equipamento, níveis 1–20, com um resumo que mostra PV, CA e o que falta escolher, e termina numa ficha para imprimir. Vários personagens ficam salvos no navegador e podem ser exportados e importados em JSON (só as escolhas, nunca texto do livro). A página é só em português, como o livro. Com o PDF em `tools/dnd/livros/` (ignorado pelo git), `npm run dnd:check` confere a extração e testa as regras.

## Traduções

As páginas existem uma vez só; os textos ficam em [`site/i18n/`](site/i18n/). Para um idioma novo, copie `en.json`, traduza os valores (as chaves ficam iguais) e acrescente o idioma em `languages.json`. O d&d.exe fica de fora: é travado em português (`data-lang` no `i18n.js`).

## Desenvolvimento

Requer Node.js apenas para as ferramentas de qualidade:

```sh
npm install
npm run lint     # valida o HTML (html-validate)
npm run format   # formata com Prettier
npm run vlibras  # regera os sinais do libras.exe a partir do VLibras (precisa do comando xz)
```

O céu segue a hora local (sol de dia; lua, céu escuro e faróis à noite); para ver outro horário, use `?hora=21:30` na URL.

Os sinais do libras.exe vêm do dicionário público do [VLibras](https://www.vlibras.gov.br/) (suíte do Governo Federal, software livre sob LGPL-3.0): `tools/vlibras/` lê os pacotes do Unity, calcula a posição dos ossos e reescreve a tabela de `signs.js`.

O deploy no GitHub Pages roda via GitHub Actions a cada push na `main`. Cada página nova nasce numa branch `feature/<slug>` e só é mesclada na `main` quando está pronta.
