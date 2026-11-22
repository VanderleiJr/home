# Changelog

O que muda no site a cada versão. A numeração segue o [SemVer](https://semver.org/lang/pt-BR/) adaptado a um site:
patch (0.2.1) = correções; minor (0.3.0) = projeto novo ou funcionalidade grande; major = mudança que quebra algo
(URLs, dados salvos no navegador). A série 0.x é o site em desenvolvimento, ainda não divulgado; a 1.0.0 será o lançamento.

## 0.3.0 — 2026-11-22

### Novo

- **kana.exe — modo ✍ Desenho**: aparece a leitura e você escreve o kana com caneta (ou dedo); o jogo confere forma,
  posição, direção e ordem dos traços, com o kana de referência ao lado e a animação da ordem dos traços. Fácil confere
  traço a traço (com dica após 3 erros); difícil confere o kana inteiro no fim. Funciona com os combinados (きゃ) e com
  dakuten. Ordem dos traços do [KanjiVG](https://kanjivg.tagaini.net/) (CC BY-SA 3.0).
- **kana.exe**: grupo "Liberados na jornada" no modo livre, para treinar só os kana que você já abriu no mapa.
- **kana.exe**: clicar num kana das tabelas abre a ordem dos traços numa janela.
- **kana.exe**: recordes numa tabela, com o recorde do desenho por dificuldade.

### Corrigido

- kana.exe e libras.exe: durante a partida as janelas das tabelas continuam podendo ser arrastadas e minimizadas.
- libras.exe: a janela alfabeto.txt ganhou o botão de minimizar.

## 0.2.0 — 2026-11-20

### Novo

- **d&d.exe**: criador de personagem de D&D 2024 que lê o seu PDF do Livro do Jogador direto no navegador (nada é enviado
  nem guardado no repositório). Classe, origem, atributos, níveis 1–20, magias, equipamento, detalhes e ficha para imprimir;
  vários personagens salvos no navegador, com exportar e importar em JSON.
- Páginas podem fixar um idioma (`data-lang` no `i18n.js`); o d&d.exe fica só em português, como o livro.

## 0.1.0 — 2026-11-20

### Novo

- Página inicial como um desktop Win98/vaporwave, com janelas, ícones, barra de tarefas e um carro 3D na estrada.
- Céu que acompanha a hora do dia (sol, lua e faróis) e troca suave entre páginas.
- **kana.exe**: jogo para aprender hiragana e katakana, com tabelas.
- **libras.exe**: jogo de Libras com os sinais do VLibras.
- Tradução por JSON (português e inglês).
