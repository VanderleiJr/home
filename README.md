# home

Minha página inicial e vitrine de pequenos projetos de aprendizado, feitos só com **HTML, CSS e JavaScript puro**, sem frameworks, bibliotecas ou etapa de build.

🌐 https://vanderleijr.github.io/home/ · [English](https://vanderleijr.github.io/home/en/)

## Para quem quer aprender

O código é aberto e foi escrito para ser lido: cada projeto traz comentários explicando o _porquê_ das técnicas usadas. Abra a pasta do projeto em [`site/projects/`](site/projects/) ou use "Exibir código-fonte" no navegador.

## Estrutura

```
site/                     ← única pasta publicada
├── index.html            página inicial (PT)
├── projects/<projeto>/   cada projeto: HTML (PT) + CSS + JS
└── en/                   versões em inglês, mesmo caminho
```

## Desenvolvimento

Requer Node.js apenas para as ferramentas de qualidade:

```sh
npm install
npm run lint     # valida o HTML (html-validate)
npm run format   # formata com Prettier
```

O deploy no GitHub Pages roda via GitHub Actions a cada push na `main`.
