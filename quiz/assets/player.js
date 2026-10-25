'use strict';
// Экран студента: вход, ответы, результат.
(() => {
  const app = document.getElementById('app');
  const LS = 'ithubq-player';
  const { esc, avatarHTML, AVATARS, LETTERS, stars, fmt } = QZ;
  const rich = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

  const saved = QZ.load(LS) || {};
  const me = {
    id: saved.id || QZ.uid(),
    first: saved.first || '',
    last: saved.last || '',
    avatar: saved.avatar || { type: 'preset', key: AVATARS[Math.floor(Math.random() * AVATARS.length)].key },
  };
  let room = new URLSearchParams(location.search).get('room') || saved.room || '';
  let view = 'join';
  let client = null, st = null, mine = null, online = false, noRoomTimer = null, noRoom = false;
  let lastHtml = '';
  const answered = {}; // qi -> выбор
  const shownAt = {}; // qi -> performance.now() когда вопрос показан
  let deadline = 0;

  const T = s => QZ.PREFIX + room + '/' + s;
  const myName = () => `${me.first} ${me.last}`.trim();
  const persist = () => QZ.save(LS, { id: me.id, first: me.first, last: me.last, avatar: me.avatar, room });

  // ---------- Вход ----------
  function renderJoin(errText = '') {
    lastHtml = '';
    const custom = me.avatar.type === 'img'
      ? `<button type="button" class="ava-pick sel" data-k="__img">${avatarHTML(me.avatar)}</button>` : '';
    app.innerHTML = `
      <div class="logo"><b>?</b> ML Квиз</div>
      <form class="card" id="jf" autocomplete="off">
        <h2>Вход в игру</h2>
        <label class="field"><span>Код комнаты</span>
          <input class="input code" id="room" inputmode="numeric" maxlength="6" placeholder="000000" value="${esc(room)}"></label>
        <div class="row" style="align-items:flex-start">
          <label class="field" style="flex:1;min-width:200px"><span>Фамилия</span><input class="input" id="last" maxlength="30" value="${esc(me.last)}"></label>
          <label class="field" style="flex:1;min-width:200px"><span>Имя</span><input class="input" id="first" maxlength="30" value="${esc(me.first)}"></label>
        </div>
        <div class="field"><span>Аватар</span></div>
        <div class="ava-grid" id="avas">
          ${custom}
          ${AVATARS.map(a => `<button type="button" class="ava-pick ${me.avatar.type === 'preset' && me.avatar.key === a.key ? 'sel' : ''}" data-k="${a.key}">${avatarHTML({ type: 'preset', key: a.key })}</button>`).join('')}
          <label class="upload" title="Загрузить свою картинку">+<input type="file" id="file" accept="image/*"></label>
        </div>
        <div class="error" id="err">${esc(errText)}</div>
        <button class="btn primary big" style="width:100%">Поехали!</button>
      </form>`;
    const $ = id => document.getElementById(id);
    $('avas').addEventListener('click', e => {
      const b = e.target.closest('.ava-pick');
      if (!b || b.dataset.k === '__img') return;
      me.avatar = { type: 'preset', key: b.dataset.k };
      app.querySelectorAll('.ava-pick').forEach(x => x.classList.toggle('sel', x === b));
    });
    $('file').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        me.avatar = { type: 'img', data: await QZ.shrinkImage(f) };
        saveForm();
        renderJoin();
      } catch (err) {
        $('err').textContent = err.message;
      }
    });
    $('room').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, ''); });
    $('jf').addEventListener('submit', e => {
      e.preventDefault();
      saveForm();
      const okName = s => /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё\- ]{0,29}$/.test(s);
      if (!/^\d{6}$/.test(room)) return void ($('err').textContent = 'Код комнаты — 6 цифр, он на экране у преподавателя');
      if (!okName(me.last)) return void ($('err').textContent = 'Введи фамилию буквами');
      if (!okName(me.first)) return void ($('err').textContent = 'Введи имя буквами');
      persist();
      start();
    });
    function saveForm() {
      room = $('room').value.trim();
      me.last = $('last').value.trim();
      me.first = $('first').value.trim();
    }
  }

  // ---------- Сеть ----------
  function start() {
    view = 'game';
    try { sessionStorage.setItem('ithubq-active', room); } catch (e) { /* нет доступа */ }
    if (client && client.roomCode !== room) { client.close(); client = null; st = null; mine = null; }
    if (client) { sendJoin(); render(); return; }
    client = new QZ.Mqtt(QZ.brokerFor(room), {
      clientId: 'p-' + me.id + '-' + QZ.uid(4),
      will: { topic: T('up/' + me.id), payload: JSON.stringify({ t: 'bye' }) },
      onStatus: s => {
        QZ.setNet(s);
        online = s === 'online';
        if (online) sendJoin();
        render();
      },
      onMessage,
    });
    client.roomCode = room;
    client.subscribe(T('state'));
    client.subscribe(T('tick'));
    client.subscribe(T('p/' + me.id));
    render();
  }

  function sendJoin() {
    if (!client) return;
    client.publish(T('up/' + me.id), { t: 'join', first: me.first, last: me.last, avatar: me.avatar });
    clearTimeout(noRoomTimer);
    noRoom = false;
    noRoomTimer = setTimeout(() => { if (!st) { noRoom = true; render(); } }, 7000);
  }

  function onMessage(topic, text) {
    const msg = QZ.parse(text);
    if (topic === T('state')) {
      if (!msg) return; // комнату закрыли — оставляем последний экран
      st = msg;
      noRoom = false;
      if (st.phase === 'question') {
        if (shownAt[st.qi] === undefined) shownAt[st.qi] = performance.now();
        deadline = performance.now() + (st.remaining ?? st.q.time * 1000);
      }
      render();
    } else if (topic === T('tick')) {
      if (msg && st && st.phase === 'question' && msg.qi === st.qi) deadline = performance.now() + msg.remaining;
    } else if (topic === T('p/' + me.id)) {
      if (!msg) return;
      mine = msg;
      render();
    }
  }

  function answer(choice) {
    const qi = st.qi;
    if (answered[qi] !== undefined || deadline - performance.now() < -1000) return;
    answered[qi] = choice;
    const ms = Math.round(performance.now() - shownAt[qi]);
    const send = tries => {
      client.publish(T('up/' + me.id), { t: 'ans', qi, choice, ms });
      setTimeout(() => {
        if (tries < 6 && st && st.phase === 'question' && st.qi === qi && !(mine && mine.answered === qi)) send(tries + 1);
      }, 1500);
    };
    send(0);
    render();
  }

  // ---------- Экраны игры ----------
  function header() {
    const score = mine && mine.score !== undefined ? `<span class="pill">${fmt(mine.score)} очк.</span>` : '';
    return `<div class="topbar">${avatarHTML(me.avatar, 'sm')}<b>${esc(myName())}</b><span class="spacer"></span>${score}</div>`;
  }

  function screen() {
    if (!online && !st) return `<div class="card center"><div class="big-ico wobble">📡</div><h2 class="dots">Подключаемся</h2><p class="muted">Комната ${esc(room)}</p></div>`;
    if (mine && mine.kicked) return `<div class="card center"><div class="big-ico">🚪</div><h2>Ведущий убрал тебя из игры</h2><p class="muted">Если это ошибка — войди заново.</p><button class="btn primary" data-act="rejoin">Войти заново</button></div>`;
    if (!st) {
      return noRoom
        ? `<div class="card center"><div class="big-ico">🔎</div><h2>Комната ${esc(room)} не найдена</h2><p class="muted">Проверь код на экране преподавателя. Если код верный — ведущий ещё не создал комнату, подожди.</p><button class="btn" data-act="rejoin">Изменить код</button></div>`
        : `<div class="card center"><div class="big-ico wobble">⏳</div><h2 class="dots">Ищем комнату</h2></div>`;
    }
    const p = st.phase;
    if (p === 'lobby') {
      return `<div class="card center">${avatarHTML(me.avatar, 'xl')}<h2 style="margin-top:14px">Ты в игре, ${esc(me.first)}!</h2>
        <p class="muted" style="font-size:18px"><span class="wobble">🎮</span> Ждём, когда преподаватель начнёт<span class="dots"></span></p>
        <p>Квиз: <b>${esc(st.title)}</b> · игроков: <b>${st.count}</b></p>
        <button class="btn small" data-act="rejoin">Изменить имя или аватар</button></div>`;
    }
    if (p === 'ready') {
      return `<div class="card center"><p class="muted" style="font-size:20px">Вопрос ${st.qi + 1} из ${st.total}</p>
        <div class="big-ico wobble">⚡</div><h1>Приготовься!</h1><span class="pill stars">${stars(st.difficulty)}</span></div>`;
    }
    if (p === 'question') {
      const q = st.q;
      const head = `<div class="q-head"><span class="pill">${st.qi + 1} / ${st.total}</span><span class="pill stars">${stars(q.difficulty)} · до ${fmt(q.points)}</span></div><div class="tbar" id="tbar"><i></i></div>`;
      if (answered[st.qi] !== undefined || (mine && mine.answered === st.qi)) {
        return `<div class="card center">${head}<div class="big-ico">✅</div><h2>Ответ принят!</h2><p class="muted dots">Ждём остальных</p></div>`;
      }
      const media = (q.code ? `<pre class="code">${esc(q.code)}</pre>` : '') + (q.image ? `<img class="q-img" src="${esc(q.image)}" alt="">` : '');
      const opts = q.options.map((o, i) => `<button class="opt o${i}" data-i="${i}"><span class="let">${LETTERS[i]}</span><span>${rich(o)}</span></button>`).join('');
      const multi = q.multi ? `<p class="muted"><b>Выбери все верные варианты</b>, потом нажми «Ответить»</p>` : '';
      const send = q.multi ? `<button class="btn primary big" data-act="multi" style="width:100%;margin-top:16px">Ответить</button>` : '';
      return `<div class="card">${head}<div class="q-text">${rich(q.text)}</div>${media}${multi}<div class="opts" data-multi="${q.multi ? 1 : 0}">${opts}</div>${send}</div>`;
    }
    if (p === 'reveal') {
      if (!mine || mine.phase !== 'reveal' || mine.qi !== st.qi) {
        return `<div class="card center"><div class="big-ico wobble">🧮</div><h2 class="dots">Считаем очки</h2></div>`;
      }
      const gain = mine.gain || 0;
      const place = mine && mine.rank ? `<div class="place">${mine.rank} место из ${mine.of}</div>` : '';
      const top = (st.top || []).map((t, i) => `<div class="${t.n === shortName() ? 'me' : ''}"><span>${i + 1}. ${esc(t.n)}</span><span>${fmt(t.s)}</span></div>`).join('');
      return `<div class="card center"><p class="muted">Вопрос ${st.qi + 1} из ${st.total}</p>
        <div class="result-gain ${gain ? '' : 'zero'}">+${fmt(gain)}</div>${place}
        <div class="top-list">${top}</div><p class="muted dots" style="margin-top:16px">${st.last ? 'Скоро итоги' : 'Ждём следующий вопрос'}</p></div>`;
    }
    if (p === 'end') {
      if (!mine || mine.phase !== 'end') return `<div class="card center"><div class="big-ico wobble">🏁</div><h2 class="dots">Подводим итоги</h2></div>`;
      return endScreen();
    }
    return '';
  }

  function shortName() { return `${me.first} ${me.last[0] || ''}.`.trim(); }

  function endScreen() {
    const ans = (mine && mine.answers) || {};
    const total = st.review ? st.review.length : 0;
    const right = Object.values(ans).filter(a => a.ok).length;
    const medal = mine && mine.rank <= 3 ? ['🥇', '🥈', '🥉'][mine.rank - 1] : '🎉';
    const items = (st.review || []).map((q, i) => {
      const a = ans[i];
      const mineTxt = a ? [].concat(a.c).map(j => `${LETTERS[j]}) ${rich(q.options[j])}`).join('; ') : 'нет ответа';
      const rightTxt = q.correct.map(j => `${LETTERS[j]}) ${rich(q.options[j])}`).join('; ');
      return `<div class="it ${a && a.ok ? 'ok' : 'no'}"><b>${i + 1}. ${rich(q.text)}</b>
        ${q.code ? `<pre class="code" style="margin:8px 0">${esc(q.code)}</pre>` : ''}
        <div class="ans">Твой ответ: ${mineTxt} ${a ? `(+${fmt(a.g)})` : ''}</div>
        ${a && a.ok ? '' : `<div class="ans"><b>Верно:</b> ${rightTxt}</div>`}
        ${q.explain ? `<div class="ans muted">${rich(q.explain)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="card center"><div class="big-ico">${medal}</div><h1>Игра окончена!</h1>
      ${mine && mine.rank ? `<div class="place">${mine.rank} место из ${mine.of}</div>` : ''}
      <p style="font-size:20px"><b>${fmt(mine ? mine.score : 0)}</b> очков · верно <b>${right}</b> из ${total}</p></div>
      <div class="card my-review"><h2>Разбор ответов</h2>${items}</div>`;
  }

  function render() {
    if (view !== 'game') return;
    const html = header() + screen();
    if (html === lastHtml) return;
    lastHtml = html;
    app.innerHTML = html;
  }

  app.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'rejoin') { view = 'join'; renderJoin(); }
      if (act.dataset.act === 'multi') {
        const sel = [...app.querySelectorAll('.opt.chosen')].map(b => +b.dataset.i);
        if (sel.length) answer(sel.sort((a, b) => a - b));
      }
      return;
    }
    const opt = e.target.closest('button.opt');
    if (!opt || !st || st.phase !== 'question') return;
    if (st.q.multi) opt.classList.toggle('chosen');
    else answer(+opt.dataset.i);
  });

  // Полоска таймера
  (function loop() {
    const bar = document.getElementById('tbar');
    if (bar && st && st.phase === 'question') {
      const left = Math.max(0, deadline - performance.now());
      const frac = left / (st.q.time * 1000);
      bar.firstChild.style.width = (Math.min(1, frac) * 100).toFixed(1) + '%';
      bar.classList.toggle('low', left < 5000);
    }
    requestAnimationFrame(loop);
  })();

  // После обновления страницы в той же вкладке сразу возвращаемся в игру
  let active = null;
  try { active = sessionStorage.getItem('ithubq-active'); } catch (e) { /* нет доступа */ }
  if (active && active === room && me.first && me.last) start();
  else renderJoin();
})();
