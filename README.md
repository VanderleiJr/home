# home

Minha página inicial e vitrine de pequenos projetos de aprendizado, feitos só com **HTML, CSS e JavaScript puro**, sem frameworks, bibliotecas ou etapa de build.

🌐 https://vanderleijr.github.io/home/ · [English](https://vanderleijr.github.io/home/?lang=en)

## Para quem quer aprender

O código é aberto e foi escrito para ser lido: cada projeto traz comentários explicando o _porquê_ das técnicas usadas. Abra a pasta do projeto em [`site/projects/`](site/projects/) ou use "Exibir código-fonte" no navegador.

## Projetos

- [🎴 kana.exe](https://vanderleijr.github.io/home/projects/kana/): flashcards de hiragana e katakana: jornada por níveis com estrelas (salva no `localStorage`), desafio contra o tempo e modo infinito ([código](site/projects/kana/)).

## Estrutura

```
site/                     ← única pasta publicada
├── index.html            página inicial
├── assets/               base compartilhada (scene.*, i18n.js) + CSS/JS da página inicial
├── i18n/                 textos de cada idioma (pt-BR.json, en.json…) e languages.json
└── projects/<projeto>/   cada projeto: HTML + CSS + JS
```

## Traduções

As páginas existem uma vez só; os textos ficam em [`site/i18n/`](site/i18n/). Para um idioma novo, copie `en.json`, traduza os valores (as chaves ficam iguais) e acrescente o idioma em `languages.json`.

## Desenvolvimento

Requer Node.js apenas para as ferramentas de qualidade:

```sh
npm install
npm run lint     # valida o HTML (html-validate)
npm run format   # formata com Prettier
```

O deploy no GitHub Pages roda via GitHub Actions a cada push na `main`.
