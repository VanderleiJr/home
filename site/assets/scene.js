/*
  Sincroniza a animação do chão entre as páginas.

  Cada página nova recomeça as animações CSS do zero, então a grade
  "pularia" ao trocar de página. A ideia: fingir que todas as animações
  começaram no instante 0 do relógio (Date.now()). Assim, em qualquer
  página, o ponto do ciclo é sempre Date.now() % duração — o mesmo.

  Duas etapas:
  1. Já no <head>, antes da primeira pintura: um animation-delay
     negativo (--phase) faz a animação começar perto do ponto certo.
  2. Quando o HTML termina de carregar, a Web Animations API
     (getAnimations) acerta a fase exata — a página inicial, por
     exemplo, demora alguns milissegundos a mais para começar.

  Este script roda sem defer, por isso é bem pequeno.
*/
{
  const root = document.documentElement;
  // O ciclo vem do próprio CSS (--loop), para não ter dois valores para manter.
  const loopMs =
    parseFloat(getComputedStyle(root).getPropertyValue("--loop")) * 1000;

  if (loopMs > 0) {
    root.style.setProperty("--phase", `${-(Date.now() % loopMs)}ms`);

    document.addEventListener("DOMContentLoaded", () => {
      for (const animation of document.getAnimations()) {
        // Só as animações do cenário que usam o ciclo --loop.
        if (!["floor-move", "road-move"].includes(animation.animationName)) {
          continue;
        }
        animation.effect.updateTiming({ delay: 0 });
        /*
          startTime, e não currentTime: currentTime fica "congelado" até a
          página pintar o primeiro quadro, e páginas mais pesadas atrasariam.
          Com startTime a animação fica presa ao relógio do documento
          (performance.now()): ela começou há (Date.now() % ciclo) ms.
        */
        animation.startTime = performance.now() - (Date.now() % loopMs);
      }
    });
  }
}

/*
  Céu pela hora do dia: o sol (6h–18h) e a lua (18h–6h) atravessam a
  tela num arco, da esquerda (nascente) para a direita (poente).
  O JS só calcula números de 0 a 1 e os entrega ao CSS em variáveis;
  posição, cores e brilho ficam no scene.css. Como tudo vem do relógio,
  todas as páginas mostram exatamente o mesmo céu.

  Para testar outro horário: ?hora=21:30 na URL.
*/
{
  const root = document.documentElement;
  const forced = new URLSearchParams(location.search).get("hora");

  function minutesNow() {
    const match = forced?.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (match) return (Number(match[1]) % 24) * 60 + Number(match[2] ?? 0);
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  }

  function updateSky() {
    const minutes = minutesNow();
    const isDay = minutes >= 360 && minutes < 1080; // das 6h às 18h
    // Progresso no arco (0 = nascendo, 1 = se pondo): 12 h para cada astro.
    const start = isDay ? 360 : 1080;
    const progress = ((minutes - start + 1440) % 1440) / 720;
    // Seno: 0 nas pontas e 1 no meio — o astro sobe e desce numa curva suave.
    const rise = Math.sin(Math.PI * progress);
    /*
      Luz do dia, de 0 (noite) a 1 (dia). Em vez de virar de uma vez às
      6h e às 18h, passa por um crepúsculo de ~1 h: a "altura" é a do sol
      de dia e a da lua, negativa, à noite.
    */
    const height = isDay ? rise : -rise;
    const daylight = Math.min(1, Math.max(0, (height + 0.15) / 0.3));

    const set = (name, value) => root.style.setProperty(name, value.toFixed(4));
    set("--sky-x", progress);
    set("--sky-rise", rise);
    set("--daylight", daylight);
    root.classList.toggle("is-night", !isDay);
  }

  updateSky();
  // Uma vez por minuto basta: o arco inteiro leva 12 horas.
  if (!forced) setInterval(updateSky, 60_000);
}
