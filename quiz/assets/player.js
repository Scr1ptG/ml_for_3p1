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
  let client = null, st = null, online = false, noRoomTimer = null, noRoom = false, joinTimer = null, lastResync = 0;
  let lastHtml = '';
  let answered = {}; // qi -> выбор
  let gains = {}; // qi -> очки за вопрос (для разбора в конце)
  const confirmed = {}; // qi -> ведущий подтвердил, что ответ принят
  const sending = {}; // qi -> идут повторы отправки
  const shownAt = {}; // qi -> performance.now() когда вопрос показан
  let deadline = 0;
  let score = 0;

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

  // Ответы этой комнаты переживают перезагрузку вкладки
  const SS = () => 'ithubq-game-' + room;
  function loadGame() {
    let g = null;
    try { g = JSON.parse(sessionStorage.getItem(SS())); } catch (e) { /* нет доступа */ }
    answered = (g && g.answered) || {};
    gains = (g && g.gains) || {};
    score = (g && g.score) || 0;
  }
  function saveGame() {
    try { sessionStorage.setItem(SS(), JSON.stringify({ answered, gains, score })); } catch (e) { /* нет доступа */ }
  }

  const myN = () => (st && st.pl ? st.pl[me.id] : undefined);
  const myRes = () => (st && st.r && myN() !== undefined ? st.r[myN()] : null); // [очки за вопрос, всего, место, ответил]

  // ---------- Сеть ----------
  function start() {
    view = 'game';
    try { sessionStorage.setItem('ithubq-active', room); } catch (e) { /* нет доступа */ }
    if (client && client.roomCode !== room) { client.close(); client = null; st = null; }
    loadGame();
    if (client) { sendJoin(true); render(); return; }
    client = new QZ.Mqtt(QZ.brokerFor(room), {
      clientId: 'p-' + me.id + '-' + QZ.uid(4),
      will: { topic: T('up/' + me.id), payload: JSON.stringify({ t: 'bye' }) },
      onStatus: s => {
        QZ.setNet(s);
        online = s === 'online';
        if (online) sendJoin(true);
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

  // Вход повторяем каждые 4 с, пока не увидим себя в списке игроков (pl) в state
  // force: отправить, даже если уже в игре (сменили имя или переподключились — ведущий отметит «онлайн»)
  function sendJoin(force = false) {
    if (!client) return;
    clearTimeout(joinTimer);
    const kicked = st && st.k && st.k.includes(me.id);
    if ((myN() !== undefined && !force) || kicked) return;
    client.publish(T('up/' + me.id), { t: 'join', first: me.first, last: me.last, avatar: me.avatar });
    joinTimer = setTimeout(sendJoin, 4000);
    if (!noRoomTimer && !st) noRoomTimer = setTimeout(() => { noRoomTimer = null; if (!st) { noRoom = true; render(); } }, 10000);
  }

  // Если пульс ведущего говорит про другой экран, значит, state до нас не дошёл: просим его заново
  function resync() {
    if (!client || performance.now() - lastResync < 3000) return;
    lastResync = performance.now();
    client.resubscribe(T('state'));
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
      const r = myRes();
      if (r && (st.phase === 'reveal' || st.phase === 'end')) {
        score = r[1];
        if (st.phase === 'reveal') {
          if (r[3]) confirmed[st.qi] = true;
          gains[st.qi] = r[0];
        }
        saveGame();
      }
      if (myN() === undefined) sendJoin();
      // После перезагрузки страницы или переподключения допосылаем неподтверждённый ответ
      if (answered[st.qi] !== undefined && !confirmed[st.qi] && !sending[st.qi]) sendAnswer(st.qi, 0);
      render();
    } else if (topic === T('tick')) {
      if (!msg) return;
      if (!st || msg.ph !== st.phase || msg.qi !== st.qi) return resync();
      if (msg.ph === 'question') {
        deadline = performance.now() + msg.rem;
        if (Array.isArray(msg.a) && msg.a.includes(myN()) && !confirmed[st.qi]) {
          confirmed[st.qi] = true;
          render();
        }
      }
    }
  }

  // Ответ повторяем каждые 2 с, пока ведущий не подтвердит его (в тике или в результатах)
  function answer(choice) {
    const qi = st.qi;
    if (answered[qi] !== undefined || deadline - performance.now() < 0) return;
    const ms = Math.round(performance.now() - shownAt[qi]);
    answered[qi] = { c: choice, ms };
    saveGame();
    sendAnswer(qi, 0);
    render();
  }

  function sendAnswer(qi, tries) {
    const a = answered[qi];
    const stop = !a || confirmed[qi] || !st || st.qi !== qi || tries > 15 || (st.phase !== 'question' && st.phase !== 'reveal');
    sending[qi] = !stop;
    if (stop) return;
    client.publish(T('up/' + me.id), { t: 'ans', qi, choice: a.c, ms: a.ms });
    setTimeout(() => sendAnswer(qi, tries + 1), 2000);
  }

  // ---------- Экраны игры ----------
  function header() {
    const pill = myN() !== undefined ? `<span class="pill">${fmt(score)} очк.</span>` : '';
    return `<div class="topbar">${avatarHTML(me.avatar, 'sm')}<b>${esc(myName())}</b><span class="spacer"></span>${pill}</div>`;
  }

  function screen() {
    if (!online && !st) return `<div class="card center"><div class="big-ico wobble">📡</div><h2 class="dots">Подключаемся</h2><p class="muted">Комната ${esc(room)}</p></div>`;
    if (st && st.k && st.k.includes(me.id)) return `<div class="card center"><div class="big-ico">🚪</div><h2>Ведущий убрал тебя из игры</h2><p class="muted">Если это ошибка — войди заново.</p><button class="btn primary" data-act="rejoin">Войти заново</button></div>`;
    if (!st) {
      return noRoom
        ? `<div class="card center"><div class="big-ico">🔎</div><h2>Комната ${esc(room)} не найдена</h2><p class="muted">Проверь код на экране преподавателя. Если код верный — ведущий ещё не создал комнату, подожди.</p><button class="btn" data-act="rejoin">Изменить код</button></div>`
        : `<div class="card center"><div class="big-ico wobble">⏳</div><h2 class="dots">Ищем комнату</h2></div>`;
    }
    const p = st.phase;
    if (myN() === undefined) {
      return `<div class="card center"><div class="big-ico wobble">🚪</div><h2 class="dots">Входим в комнату</h2><p class="muted">Комната ${esc(room)} найдена, ждём подтверждения от ведущего</p></div>`;
    }
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
      if (answered[st.qi] !== undefined) {
        return confirmed[st.qi]
          ? `<div class="card center">${head}<div class="big-ico">✅</div><h2>Ответ принят!</h2><p class="muted dots">Ждём остальных</p></div>`
          : `<div class="card center">${head}<div class="big-ico wobble">📨</div><h2 class="dots">Отправляем ответ</h2><p class="muted">Не закрывай страницу</p></div>`;
      }
      if (deadline - performance.now() < 0) {
        return `<div class="card center">${head}<div class="big-ico">⏰</div><h2>Время вышло</h2><p class="muted dots">Ждём результаты</p></div>`;
      }
      const media = (q.code ? `<pre class="code">${esc(q.code)}</pre>` : '') + (q.image ? `<img class="q-img" src="${esc(q.image)}" alt="">` : '');
      const opts = q.options.map((o, i) => `<button class="opt o${i}" data-i="${i}"><span class="let">${LETTERS[i]}</span><span>${rich(o)}</span></button>`).join('');
      const multi = q.multi ? `<p class="muted"><b>Выбери все верные варианты</b>, потом нажми «Ответить»</p>` : '';
      const send = q.multi ? `<button class="btn primary big" data-act="multi" style="width:100%;margin-top:16px">Ответить</button>` : '';
      return `<div class="card">${head}<div class="q-text">${rich(q.text)}</div>${media}${multi}<div class="opts" data-multi="${q.multi ? 1 : 0}">${opts}</div>${send}</div>`;
    }
    if (p === 'reveal') {
      const r = myRes();
      if (!r) return `<div class="card center"><div class="big-ico wobble">🧮</div><h2 class="dots">Считаем очки</h2></div>`;
      const gain = r[0];
      const place = `<div class="place">${r[2]} место из ${st.count}</div>`;
      const top = (st.top || []).map((t, i) => `<div class="${t.n === shortName() ? 'me' : ''}"><span>${i + 1}. ${esc(t.n)}</span><span>${fmt(t.s)}</span></div>`).join('');
      return `<div class="card center"><p class="muted">Вопрос ${st.qi + 1} из ${st.total}</p>
        <div class="result-gain ${gain ? '' : 'zero'}">+${fmt(gain)}</div>${place}
        <div class="top-list">${top}</div><p class="muted dots" style="margin-top:16px">${st.last ? 'Скоро итоги' : 'Ждём следующий вопрос'}</p></div>`;
    }
    if (p === 'end') {
      if (!myRes()) return `<div class="card center"><div class="big-ico wobble">🏁</div><h2 class="dots">Подводим итоги</h2></div>`;
      return endScreen();
    }
    return '';
  }

  function shortName() { return `${me.first} ${me.last[0] || ''}.`.trim(); }

  // Разбор строим из своих ответов (они хранятся у студента) и правильных ответов из state
  function endScreen() {
    const [, total, rank] = myRes();
    const review = st.review || [];
    const isOk = (a, q) => a && [].concat(a.c).sort((x, y) => x - y).join() === q.correct.join();
    const right = review.filter((q, i) => isOk(answered[i], q)).length;
    const medal = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : '🎉';
    const items = review.map((q, i) => {
      const a = answered[i], ok = isOk(a, q);
      const mineTxt = a ? [].concat(a.c).map(j => `${LETTERS[j]}) ${rich(q.options[j])}`).join('; ') : 'нет ответа';
      const rightTxt = q.correct.map(j => `${LETTERS[j]}) ${rich(q.options[j])}`).join('; ');
      return `<div class="it ${ok ? 'ok' : 'no'}"><b>${i + 1}. ${rich(q.text)}</b>
        ${q.code ? `<pre class="code" style="margin:8px 0">${esc(q.code)}</pre>` : ''}
        <div class="ans">Твой ответ: ${mineTxt} ${a && gains[i] !== undefined ? `(+${fmt(gains[i])})` : ''}</div>
        ${ok ? '' : `<div class="ans"><b>Верно:</b> ${rightTxt}</div>`}
        ${q.explain ? `<div class="ans muted">${rich(q.explain)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="card center"><div class="big-ico">${medal}</div><h1>Игра окончена!</h1>
      <div class="place">${rank} место из ${st.count}</div>
      <p style="font-size:20px"><b>${fmt(total)}</b> очков · верно <b>${right}</b> из ${review.length}</p></div>
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
      if (!left && answered[st.qi] === undefined) render(); // показать «Время вышло»
    }
    requestAnimationFrame(loop);
  })();

  // После обновления страницы в той же вкладке сразу возвращаемся в игру
  let active = null;
  try { active = sessionStorage.getItem('ithubq-active'); } catch (e) { /* нет доступа */ }
  if (active && active === room && me.first && me.last) start();
  else renderJoin();
})();
