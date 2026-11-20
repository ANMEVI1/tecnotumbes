/**
 * Motor de scroleo bidireccional (ida y vuelta) y transiciones líquidas.
 * Actualiza progreso continuo según posición en viewport al bajar y al subir,
 * sincroniza los orbes atmosféricos parallax y el indicador líquido del header derecho.
 */

export function initMotion({ sections = [] } = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nav = document.getElementById('floating-nav');
  const pillIndicator = document.getElementById('nav-pill-indicator');
  const navLinks = nav ? Array.from(nav.querySelectorAll('.nav-pill-link')) : [];
  const orbs = Array.from(document.querySelectorAll('[data-orb]'));

  let activeId = sections[0] || 'sec-mapa';
  let currentY = window.scrollY;
  let targetY = window.scrollY;
  let rafId = null;

  function moveNavIndicator(targetLink) {
    if (!pillIndicator || !targetLink || !nav) return;
    const navRect = nav.getBoundingClientRect();
    const linkRect = targetLink.getBoundingClientRect();
    const left = linkRect.left - navRect.left;
    pillIndicator.style.width = `${linkRect.width}px`;
    pillIndicator.style.transform = `translate3d(${left}px, 0, 0)`;
    pillIndicator.style.opacity = '1';
  }

  function setActiveNav(id) {
    if (!navLinks.length) return;
    activeId = id;
    let activeEl = null;
    for (const el of navLinks) {
      const match = el.dataset.target === id;
      el.classList.toggle('is-active', match);
      if (match) activeEl = el;
    }
    if (activeEl) moveNavIndicator(activeEl);
  }

  function updateScrollDrivenFrames() {
    const vh = window.innerHeight || 800;
    const flowNodes = document.querySelectorAll('[data-flow]');

    if (!reduced) {
      // Parallax bidireccional suave de orbes atmosféricos celeste/rojo neón
      const scrollNorm = currentY / Math.max(1, document.documentElement.scrollHeight - vh);
      for (const orb of orbs) {
        const depth = parseFloat(orb.dataset.depth || '30');
        const dir = parseFloat(orb.dataset.dir || '1');
        const yShift = (scrollNorm - 0.5) * depth * 2.4 * dir;
        const xShift = Math.sin(scrollNorm * Math.PI * 1.8) * depth * 0.65 * dir;
        orb.style.transform = `translate3d(${xShift.toFixed(1)}px, ${yShift.toFixed(1)}px, 0)`;
      }

      // Interpolación continua ida y vuelta por cada bloque [data-flow]
      for (const el of flowNodes) {
        const rect = el.getBoundingClientRect();
        const center = rect.top + rect.height * 0.5;
        // -1 abajo fuera, 0 centro viewport, +1 arriba fuera
        const progress = Math.max(-1, Math.min(1, (vh * 0.5 - center) / (vh * 0.72)));

        // Curva de visibilidad bidireccional: visible en el centro, se repliega suavemente al entrar/salir arriba o abajo
        const dist = Math.abs(progress);
        const vis = Math.max(0.18, Math.min(1, 1.18 - dist * 0.85));
        const shiftY = -progress * 22;
        const scale = 0.965 + 0.035 * vis;

        el.style.setProperty('--flow-vis', vis.toFixed(3));
        el.style.setProperty('--flow-y', `${shiftY.toFixed(1)}px`);
        el.style.setProperty('--flow-scale', scale.toFixed(4));
      }
    }

    // Determinar sección más cercana al tercio superior-medio del viewport (funciona subiendo y bajando)
    let bestId = activeId;
    let bestDist = Infinity;
    const anchorY = vh * 0.36;
    for (const id of sections) {
      const sec = document.getElementById(id);
      if (!sec) continue;
      const r = sec.getBoundingClientRect();
      if (r.top <= anchorY && r.bottom >= anchorY) {
        bestId = id;
        bestDist = 0;
        break;
      }
      const d = Math.min(Math.abs(r.top - anchorY), Math.abs(r.bottom - anchorY));
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    }
    if (bestId !== activeId) {
      setActiveNav(bestId);
    }
  }

  function tick() {
    currentY += (targetY - currentY) * 0.16;
    updateScrollDrivenFrames();
    if (Math.abs(targetY - currentY) > 0.35) {
      rafId = requestAnimationFrame(tick);
    } else {
      currentY = targetY;
      updateScrollDrivenFrames();
      rafId = null;
    }
  }

  function onScroll() {
    targetY = window.scrollY;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    updateScrollDrivenFrames();
    setActiveNav(activeId);
  });

  // Navegación fluida al hacer clic en los enlaces del header derecho
  for (const link of navLinks) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = link.dataset.target;
      const el = targetId ? document.getElementById(targetId) : null;
      if (el) {
        setActiveNav(targetId);
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
    });
  }

  // Inicializar posición tras pintar fuentes
  requestAnimationFrame(() => {
    updateScrollDrivenFrames();
    setActiveNav(activeId);
  });

  return {
    refresh: updateScrollDrivenFrames,
    scrollToSection(id) {
      const el = document.getElementById(id);
      if (el) {
        setActiveNav(id);
        el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      }
    },
  };
}
