'use strict';
// Мини-движок слайдов: стрелки/пробел — вперёд-назад, F — полный экран.
// <section class="slide" data-demo="name"> вызывает Deck.demos.name(slide) при показе;
// функция может вернуть cleanup, который вызовется при уходе со слайда.
const Deck = (() => {
  const deck = document.getElementById('deck');
  const slides = [...deck.querySelectorAll('.slide')];
  const demos = {};
  let idx = 0, cleanup = null;

  const bar = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'bar' }));
  const num = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'num' }));
  document.body.appendChild(Object.assign(document.createElement('div'), { id: 'hint', textContent: '← → пробел · F — во весь экран · N — заметки' }));

  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    deck.style.transform = `translate(-50%, -50%) scale(${s})`;
  }

  let show = function (n, allSteps = false) {
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    slides.forEach((s, i) => {
      s.classList.toggle('active', i === n);
      s.classList.toggle('past', i < n);
    });
    slides[n].querySelectorAll('.step').forEach(st => st.classList.toggle('shown', allSteps));
    idx = n;
    history.replaceState(null, '', '#' + (n + 1));
    bar.style.width = ((n + 1) / slides.length) * 100 + '%';
    num.textContent = `${n + 1} / ${slides.length}`;
    const d = slides[n].dataset.demo;
    if (d && demos[d]) {
      try { cleanup = demos[d](slides[n]) || null; } catch (e) { console.error(e); }
    }
  };

  function next() {
    const hidden = slides[idx].querySelector('.step:not(.shown)');
    if (hidden) { hidden.classList.add('shown'); return; }
    if (idx < slides.length - 1) show(idx + 1);
  }

  function prev() {
    const shown = [...slides[idx].querySelectorAll('.step.shown')];
    if (shown.length) { shown[shown.length - 1].classList.remove('shown'); return; }
    if (idx > 0) show(idx - 1, true);
  }

  document.addEventListener('keydown', e => {
    if (e.target.matches('input[type=text], input[type=number], textarea, select')) return;
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1, true);
    else if (e.key === 'f' || e.key === 'а') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  // Чтобы стрелки снова листали слайды после клика по ползунку или кнопке
  document.addEventListener('pointerup', () => setTimeout(() => {
    const a = document.activeElement;
    if (a && a.matches('input[type=range], input[type=checkbox], button')) a.blur();
  }, 0));
  addEventListener('resize', fit);

  // Подсветка Python в <pre class="py">. Строка, оканчивающаяся на «#!», выделяется.
  const KW = /\b(import|from|as|def|return|if|else|elif|for|in|while|not|and|or|True|False|None|with|lambda|class|break|continue|is)\b/;
  function highlight(src) {
    const re = /(#[^\n]*)|(f?"(?:[^"\\\n]|\\.)*"|f?'(?:[^'\\\n]|\\.)*')|\b(\d+\.?\d*)\b|\b([A-Za-z_]\w*)\b(?=\s*\()|\b([A-Za-z_]\w*)\b/g;
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return src.split('\n').map(line => {
      let mark = false;
      if (/#!\s*$/.test(line)) { mark = true; line = line.replace(/\s*#!\s*$/, ''); }
      let out = '', last = 0, m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        out += esc(line.slice(last, m.index));
        const t = esc(m[0]);
        if (m[1]) out += `<span class="c">${t}</span>`;
        else if (m[2]) out += `<span class="s">${t}</span>`;
        else if (m[3]) out += `<span class="n">${t}</span>`;
        else if (KW.test(m[0]) && m[0].match(KW)[0] === m[0]) out += `<span class="k">${t}</span>`;
        else if (m[4]) out += `<span class="f">${t}</span>`;
        else out += t;
        last = m.index + m[0].length;
      }
      out += esc(line.slice(last));
      return mark ? `<span class="hl">${out}</span>` : out;
    }).join('\n');
  }
  document.querySelectorAll('pre.py').forEach(p => { p.innerHTML = highlight(p.textContent.replace(/^\n/, '').replace(/\s+$/, '')); });

  // Общая веб-камера для демо (одна на всю презентацию)
  let camPromise = null;
  function camera() {
    if (!camPromise) {
      camPromise = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false }).then(stream => {
          const v = document.createElement('video');
          v.srcObject = stream;
          v.muted = true;
          v.playsInline = true;
          return v.play().then(() => v);
        }).catch(() => { camPromise = null; return null; })
        : Promise.resolve(null);
    }
    return camPromise;
  }

  // Анимационный цикл с автоматической остановкой при уходе со слайда
  function loop(fn) {
    let on = true, id;
    const tick = t => { if (!on) return; fn(t); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => { on = false; cancelAnimationFrame(id); };
  }

  // Заметки преподавателя: <aside class="notes"> внутри слайда, клавиша N
  const notes = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'notes' }));
  let notesOn = false;
  const syncNotes = () => {
    const a = slides[idx] && slides[idx].querySelector('aside.notes');
    notes.innerHTML = a ? a.innerHTML : '<i>Нет заметок</i>';
    notes.style.display = notesOn ? 'block' : 'none';
  };
  document.addEventListener('keydown', e => {
    if ((e.key === 'n' || e.key === 'т') && !e.target.matches('input, textarea')) { notesOn = !notesOn; syncNotes(); }
  });
  const origShow = show;
  show = (n, all) => { origShow(n, all); syncNotes(); };

  // Ссылки на сайт и Colab вычисляются из адреса GitHub Pages: https://USER.github.io/REPO/...
  function site() {
    const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    if (!m || !repo) return { quiz: location.origin + '/', colab: () => null, short: location.host };
    return {
      quiz: `https://${m[1]}.github.io/${repo}/`,
      short: `${m[1]}.github.io/${repo}`,
      colab: path => `https://colab.research.google.com/github/${m[1]}/${repo}/blob/main/${path}`,
    };
  }
  document.querySelectorAll('[data-site]').forEach(el => {
    const s = site();
    if (el.dataset.site === 'quiz') { el.textContent = s.short; el.href = s.quiz; }
    else {
      const url = s.colab(el.dataset.site);
      if (url) el.href = url;
      else el.removeAttribute('href');
    }
  });

  fit();
  // Запуск после того, как страница зарегистрирует свои демо
  setTimeout(() => {
    const start = Math.min(slides.length, Math.max(1, parseInt(location.hash.slice(1), 10) || 1)) - 1;
    show(start);
  }, 0);

  return { demos, camera, loop, next, prev, site };
})();
