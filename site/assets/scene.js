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
        animation.currentTime = Date.now() % loopMs;
      }
    });
  }
}
