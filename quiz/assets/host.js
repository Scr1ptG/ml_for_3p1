'use strict';
// Экран преподавателя: выбор квиза, комната, вопросы, лидерборд, итоги, выгрузка.
(() => {
  const app = document.getElementById('app');
  const LS = 'ithubq-host';
  const LS_SET = 'ithubq-host-settings';
  const GRACE = 1500; // мс после конца таймера, в которые ещё принимаем ответы
  const READY_MS = 3000;
  const { esc, avatarHTML, LETTERS, stars, fmt } = QZ;
  const rich = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

  let G = null; // текущая игра (сохраняется в localStorage)
  let client = null, tickTimer = null, readyTimer = null, saveTimer = null;
  let picked = null; // выбранный, но ещё не запущенный квиз
  let reviewIdx = 0;
  const settings = Object.assign({ shuffle: true, showCorrect: true, broker: 0, sound: true }, QZ.load(LS_SET));
  QZ.sound.on = settings.sound;

  const T = s => QZ.PREFIX + G.room + '/' + s;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => QZ.save(LS, G), 200); };
  const players = () => Object.values(G.players);
  const onlinePlayers = () => players().filter(p => p.online);
  const fullName = p => `${p.last} ${p.first}`;
  const shortName = p => `${p.first} ${p.last[0] || ''}.`;

  // ---------- Загрузка и проверка файла вопросов ----------
  function normalize(raw, base) {
    if (!raw || !Array.isArray(raw.questions) || !raw.questions.length) throw new Error('В файле нет непустого массива "questions"');
    const d = Object.assign({ time: 30, difficulty: 1 }, raw.defaults);
    const questions = raw.questions.map((q, i) => {
      const n = i + 1;
      if (!q || !q.text) throw new Error(`Вопрос ${n}: нет поля "text"`);
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) throw new Error(`Вопрос ${n}: в "options" должно быть от 2 до 6 вариантов`);
      const correct = [].concat(q.correct);
      if (!correct.length || correct.some(c => !Number.isInteger(c) || c < 0 || c >= q.options.length)) {
        throw new Error(`Вопрос ${n}: "correct" — номер верного варианта, считая с нуля (0…${q.options.length - 1}), или массив номеров`);
      }
      const difficulty = Math.min(3, Math.max(1, Math.round(q.difficulty ?? d.difficulty)));
      return {
        text: String(q.text),
        code: q.code ? String(q.code) : '',
        image: q.image ? new URL(q.image, base || location.href).href : '',
        options: q.options.map(String),
        correct: [...new Set(correct)].sort((a, b) => a - b),
        multi: q.multi ?? correct.length > 1,
        difficulty,
        time: Math.min(120, Math.max(5, Math.round(q.time ?? d.time))),
        points: q.points ?? [0, 500, 1000, 1500][difficulty],
        explain: q.explain ? String(q.explain) : '',
      };
    });
    return { title: String(raw.title || 'Квиз'), questions };
  }

  async function loadFromUrl(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Не удалось загрузить ${url} (${res.status})`);
    let raw;
    try { raw = await res.json(); } catch (e) { throw new Error('Файл не является корректным JSON: ' + e.message); }
    return normalize(raw, new URL(url, location.href).href);
  }

  function shuffleQuiz(quiz) {
    const questions = quiz.questions.map(q => {
      const perm = q.options.map((_, i) => i);
      for (let i = perm.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
      return Object.assign({}, q, {
        options: perm.map(i => q.options[i]),
        correct: perm.map((orig, j) => (q.correct.includes(orig) ? j : -1)).filter(j => j >= 0),
      });
    });
    return Object.assign({}, quiz, { questions });
  }

  // ---------- Экран выбора квиза ----------
  async function renderSetup(err = '') {
    stopTimers();
    const resume = QZ.load(LS);
    const canResume = resume && resume.phase && resume.phase !== 'setup' && resume.room;
    app.innerHTML = `
      <div class="topbar"><div class="logo"><b>?</b> ML Квиз · ведущий</div></div>
      ${canResume ? `<div class="card row"><div><b>Незавершённая игра:</b> «${esc(resume.quiz.title)}», комната ${esc(resume.room)}, игроков ${Object.keys(resume.players).length}</div><span class="spacer"></span>
        <button class="btn primary" data-act="resume">Продолжить</button><button class="btn" data-act="drop">Сбросить</button></div>` : ''}
      <div class="card">
        <h2>1. Выберите квиз</h2>
        <div class="quiz-list" id="qlist"><p class="muted dots">Загружаю список</p></div>
        <div class="drop" id="drop" style="margin-top:14px">Или перетащите сюда свой файл <code>.json</code> с вопросами (или нажмите, чтобы выбрать)<input type="file" id="file" accept=".json,application/json" hidden></div>
        <div class="error" id="err">${esc(err)}</div>
        <div id="preview"></div>
      </div>
      <div class="card">
        <h2>2. Настройки</h2>
        <label class="check"><input type="checkbox" id="s-shuffle" ${settings.shuffle ? 'checked' : ''}> Перемешивать варианты ответов</label>
        <label class="check"><input type="checkbox" id="s-correct" ${settings.showCorrect ? 'checked' : ''}> После вопроса показывать, сколько человек ответили верно (сам ответ скрыт до конца)</label>
        <label class="check"><input type="checkbox" id="s-sound" ${settings.sound ? 'checked' : ''}> Звуки на экране ведущего</label>
        <label class="check">Сервер связи:
          <select class="input" id="s-broker" style="width:auto;padding:6px 10px;font-size:16px">
            ${QZ.BROKERS.map((b, i) => `<option value="${i}" ${settings.broker === i ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select></label>
        <p class="muted" style="margin:4px 0 16px">Если студенты не могут подключиться, создайте комнату заново на запасном сервере.</p>
        <button class="btn primary big" id="create" ${picked ? '' : 'disabled'}>Создать комнату →</button>
      </div>`;
    const $ = id => document.getElementById(id);
    const bindSetting = (id, key, prop = 'checked') => $(id).addEventListener('change', e => {
      settings[key] = prop === 'value' ? +e.target.value : e.target.checked;
      QZ.sound.on = settings.sound;
      QZ.save(LS_SET, settings);
    });
    bindSetting('s-shuffle', 'shuffle');
    bindSetting('s-correct', 'showCorrect');
    bindSetting('s-sound', 'sound');
    bindSetting('s-broker', 'broker', 'value');
    $('create').onclick = () => picked && createRoom();
    const drop = $('drop');
    drop.onclick = () => $('file').click();
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
    $('file').onchange = e => e.target.files[0] && readFile(e.target.files[0]);
    showPreview();

    try {
      const res = await fetch('quizzes/index.json', { cache: 'no-cache' });
      const list = await res.json();
      $('qlist').innerHTML = list.map((q, i) => `<button class="quiz-item ${picked && picked.src === q.file ? 'sel' : ''}" data-i="${i}"><b>${esc(q.title)}</b><small>${esc(q.description || '')}</small></button>`).join('') || '<p class="muted">Список пуст</p>';
      $('qlist').onclick = async e => {
        const b = e.target.closest('.quiz-item');
        if (!b) return;
        try {
          const item = list[+b.dataset.i];
          picked = Object.assign(await loadFromUrl('quizzes/' + item.file), { src: item.file });
          $('err').textContent = '';
          app.querySelectorAll('.quiz-item').forEach(x => x.classList.toggle('sel', x === b));
          showPreview();
        } catch (er) { $('err').textContent = er.message; }
      };
    } catch (e) {
      $('qlist').innerHTML = '<p class="muted">Список quizzes/index.json не найден — загрузите файл вручную.</p>';
    }

    function readFile(f) {
      const r = new FileReader();
      r.onload = () => {
        try {
          picked = Object.assign(normalize(JSON.parse(r.result)), { src: f.name });
          $('err').textContent = '';
          app.querySelectorAll('.quiz-item').forEach(x => x.classList.remove('sel'));
          showPreview();
        } catch (er) {
          picked = null;
          $('err').textContent = 'Ошибка в файле: ' + er.message;
          showPreview();
        }
      };
      r.readAsText(f, 'utf-8');
    }

    function showPreview() {
      const box = $('preview');
      $('create').disabled = !picked;
      if (!picked) { box.innerHTML = ''; return; }
      const qs = picked.questions;
      const secs = qs.reduce((s, q) => s + q.time, 0);
      const byD = [1, 2, 3].map(d => qs.filter(q => q.difficulty === d).length);
      // Ответы не показываем — экран может быть на проекторе
      box.innerHTML = `<div class="stat-row" style="margin-top:14px">
        <span class="pill">«${esc(picked.title)}»</span><span class="pill">${qs.length} вопр.</span>
        <span class="pill">~${Math.ceil((secs + qs.length * 12) / 60)} мин</span>
        <span class="pill">★ ${byD[0]} · ★★ ${byD[1]} · ★★★ ${byD[2]}</span>
        <span class="pill">макс. ${fmt(qs.reduce((s, q) => s + q.points, 0))} очков</span></div>`;
    }
  }

  // ---------- Комната ----------
  function createRoom() {
    cleanupOld();
    const quiz = settings.shuffle ? shuffleQuiz(picked) : picked;
    G = {
      room: QZ.makeRoom(settings.broker),
      quiz: { title: quiz.title, questions: quiz.questions },
      showCorrect: settings.showCorrect,
      phase: 'lobby',
      qi: -1,
      players: {},
      kicked: [],
      createdAt: Date.now(),
    };
    save();
    connect();
    renderLobby();
  }

  // Убираем «закреплённые» сообщения прошлой комнаты с брокера
  function cleanupOld() {
    const old = QZ.load(LS);
    if (!old || !old.room) return;
    const c = new QZ.Mqtt(QZ.brokerFor(old.room), {
      clientId: 'hc-' + QZ.uid(6),
      onStatus: s => {
        if (s !== 'online') return;
        const t = x => QZ.PREFIX + old.room + '/' + x;
        c.publish(t('state'), '', true);
        Object.keys(old.players || {}).forEach(id => c.publish(t('p/' + id), '', true));
        setTimeout(() => c.close(), 1500);
      },
    });
  }

  function connect() {
    if (client) client.close();
    client = new QZ.Mqtt(QZ.brokerFor(G.room), {
      clientId: 'h-' + G.room + '-' + QZ.uid(4),
      onStatus: s => {
        QZ.setNet(s);
        if (s === 'online') {
          publishState();
          players().forEach(p => sendPlayer(p.id));
        }
      },
      onMessage,
    });
    client.subscribe(T('up/+'));
  }

  function ranked() {
    const totalMs = p => Object.values(p.answers).reduce((s, a) => s + (a.counted ? a.ms : 0), 0);
    return players().sort((a, b) => b.score - a.score || totalMs(a) - totalMs(b) || fullName(a).localeCompare(fullName(b), 'ru'));
  }

  function publicQ(q) {
    return { text: q.text, code: q.code, image: q.image, options: q.options, multi: q.multi, time: q.time, difficulty: q.difficulty, points: q.points };
  }

  function publishState() {
    if (!client || !G) return;
    const total = G.quiz.questions.length;
    const top = () => ranked().slice(0, 5).map(p => ({ n: shortName(p), s: p.score }));
    let s;
    if (G.phase === 'lobby') s = { phase: 'lobby', title: G.quiz.title, count: players().length };
    else if (G.phase === 'ready') s = { phase: 'ready', qi: G.qi, total, difficulty: G.quiz.questions[G.qi].difficulty };
    else if (G.phase === 'question') s = { phase: 'question', qi: G.qi, total, q: publicQ(G.quiz.questions[G.qi]), remaining: Math.max(0, G.deadline - Date.now()) };
    else if (G.phase === 'reveal') s = { phase: 'reveal', qi: G.qi, total, last: G.qi === total - 1, top: top() };
    else if (G.phase === 'end') {
      s = { phase: 'end', title: G.quiz.title, total, top: top(),
        review: G.quiz.questions.map(q => ({ text: q.text, code: q.code, options: q.options, correct: q.correct, explain: q.explain })) };
    }
    if (s) client.publish(T('state'), s, true);
  }

  function sendPlayer(id) {
    const p = G.players[id];
    if (!p || !client) return;
    const m = { ok: true, score: p.score, phase: G.phase, qi: G.qi };
    if (G.phase === 'question' && p.answers[G.qi]) m.answered = G.qi;
    if (G.phase === 'reveal' || G.phase === 'end') {
      const r = ranked();
      m.rank = r.indexOf(p) + 1;
      m.of = r.length;
    }
    if (G.phase === 'reveal') m.gain = p.answers[G.qi] ? p.answers[G.qi].gain : 0;
    if (G.phase === 'end') {
      m.answers = {};
      Object.entries(p.answers).forEach(([qi, a]) => { m.answers[qi] = { c: a.choice, ok: a.correct, g: a.gain }; });
    }
    client.publish(T('p/' + id), m, true);
  }

  function onMessage(topic, text) {
    if (!G || !topic.startsWith(T('up/'))) return;
    const id = topic.slice(T('up/').length);
    if (!/^[a-z0-9]{6,24}$/.test(id)) return;
    const msg = QZ.parse(text);
    if (!msg || typeof msg !== 'object') return;
    if (G.kicked.includes(id)) {
      if (msg.t !== 'bye') client.publish(T('p/' + id), { kicked: true }, true);
      return;
    }
    if (msg.t === 'join') onJoin(id, msg);
    else if (msg.t === 'ans') onAnswer(id, msg);
    else if (msg.t === 'bye' && G.players[id]) {
      G.players[id].online = false;
      save();
      refresh();
    }
  }

  function onJoin(id, msg) {
    const clean = s => String(s || '').replace(/[^A-Za-zА-Яа-яЁё\- ]/g, '').trim().slice(0, 30);
    const first = clean(msg.first), last = clean(msg.last);
    if (!first || !last) return;
    let avatar = { type: 'preset', key: 'rocket' };
    if (msg.avatar && msg.avatar.type === 'img' && typeof msg.avatar.data === 'string' && msg.avatar.data.length < 30000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(msg.avatar.data)) {
      avatar = { type: 'img', data: msg.avatar.data };
    } else if (msg.avatar && QZ.AVATARS.some(a => a.key === msg.avatar.key)) {
      avatar = { type: 'preset', key: msg.avatar.key };
    }
    const isNew = !G.players[id];
    const p = G.players[id] || (G.players[id] = { id, score: 0, answers: {}, prevRank: 0, joinedAt: Date.now() });
    Object.assign(p, { first, last, avatar, online: true });
    save();
    sendPlayer(id);
    if (G.phase === 'lobby') publishState(); // обновить счётчик игроков
    if (isNew && G.phase === 'lobby') QZ.sound.beep(880, 0.08, 'triangle', 0.08);
    refresh();
  }

  function onAnswer(id, msg) {
    const p = G.players[id];
    if (!p) return;
    p.online = true;
    if (G.phase !== 'question' || msg.qi !== G.qi) return;
    if (p.answers[G.qi]) { sendPlayer(id); return; }
    const now = Date.now();
    if (now > G.deadline + GRACE) return;
    const q = G.quiz.questions[G.qi];
    const valid = i => Number.isInteger(i) && i >= 0 && i < q.options.length;
    let choice;
    if (q.multi) {
      if (!Array.isArray(msg.choice) || !msg.choice.length || !msg.choice.every(valid)) return;
      choice = [...new Set(msg.choice)].sort((a, b) => a - b);
    } else {
      if (!valid(msg.choice)) return;
      choice = msg.choice;
    }
    const limit = q.time * 1000;
    // Время считаем по часам студента, но не меньше серверного минус 2.5 с на задержку сети
    const ms = Math.min(limit, Math.max(0, Number(msg.ms) || 0, now - G.qStartedAt - 2500));
    const chosen = [].concat(choice);
    const correct = chosen.length === q.correct.length && chosen.every((c, i) => c === q.correct[i]);
    const gain = correct ? Math.round(q.points * (1 - 0.5 * ms / limit)) : 0;
    p.answers[G.qi] = { choice, ms, correct, gain, counted: true };
    save();
    sendPlayer(id);
    QZ.sound.beep(520 + Object.keys(answersFor(G.qi)).length * 12, 0.05, 'sine', 0.05);
    refresh();
    const on = onlinePlayers();
    if (on.length && on.every(x => x.answers[G.qi])) setTimeout(() => G.phase === 'question' && endQuestion(), 700);
  }

  const answersFor = qi => Object.fromEntries(players().filter(p => p.answers[qi]).map(p => [p.id, p.answers[qi]]));

  // ---------- Ход игры ----------
  function stopTimers() {
    clearInterval(tickTimer);
    clearTimeout(readyTimer);
    tickTimer = readyTimer = null;
  }

  function startQuestion(i) {
    stopTimers();
    G.qi = i;
    G.phase = 'ready';
    save();
    publishState();
    renderReady();
    QZ.sound.beep(440, 0.15, 'triangle');
    readyTimer = setTimeout(beginQuestion, READY_MS);
  }

  function beginQuestion() {
    stopTimers();
    const q = G.quiz.questions[G.qi];
    G.phase = 'question';
    G.qStartedAt = Date.now();
    G.deadline = G.qStartedAt + q.time * 1000;
    save();
    publishState();
    renderQuestion();
    runTick();
  }

  function runTick() {
    let lastBeep = null;
    tickTimer = setInterval(() => {
      const remaining = G.deadline - Date.now();
      if (client) client.publish(T('tick'), { qi: G.qi, remaining: Math.max(0, remaining) });
      const sec = Math.ceil(remaining / 1000);
      if (sec <= 5 && sec > 0 && sec !== lastBeep) { lastBeep = sec; QZ.sound.beep(sec === 1 ? 880 : 660, 0.08); }
      if (remaining <= -GRACE) endQuestion();
    }, 1000);
  }

  function endQuestion() {
    if (G.phase !== 'question') return;
    stopTimers();
    const before = ranked();
    before.forEach((p, i) => { p.prevRank = G.qi ? i + 1 : 0; });
    players().forEach(p => {
      const a = p.answers[G.qi];
      if (a) p.score += a.gain;
    });
    G.phase = 'reveal';
    save();
    publishState();
    players().forEach(p => sendPlayer(p.id));
    QZ.sound.beep(392, 0.3, 'triangle');
    renderReveal();
  }

  function next() {
    if (G.qi + 1 < G.quiz.questions.length) startQuestion(G.qi + 1);
    else finish();
  }

  function finish() {
    stopTimers();
    G.phase = 'end';
    save();
    publishState();
    players().forEach(p => sendPlayer(p.id));
    QZ.sound.fanfare();
    renderEnd();
  }

  function kick(id) {
    const p = G.players[id];
    if (!p || !confirm(`Убрать из игры: ${fullName(p)}?`)) return;
    delete G.players[id];
    G.kicked.push(id);
    client.publish(T('p/' + id), { kicked: true }, true);
    save();
    publishState();
    refresh();
  }

  // ---------- Экраны ведущего ----------
  function topbar(extra = '') {
    return `<div class="topbar"><div class="logo"><b>?</b> ${esc(G.quiz.title)}</div><span class="spacer"></span>${extra}
      <button class="btn small" data-act="sound" title="Звук">${QZ.sound.on ? '🔊' : '🔇'}</button>
      <button class="btn small" data-act="fs" title="Во весь экран">⛶</button>
      <button class="btn small" data-act="quit">Выйти</button></div>`;
  }

  // Студентам показываем корень сайта: корневой index.html перенаправляет в quiz/
  function joinUrl() {
    return location.origin + location.pathname.replace(/host\.html$/, '').replace(/quiz\/$/, '');
  }

  function renderLobby() {
    const ps = players().sort((a, b) => a.joinedAt - b.joinedAt);
    app.innerHTML = topbar() + `
      <div class="card join-box">
        <div>
          <div class="muted" style="font-size:20px;font-weight:700">Откройте сайт</div>
          <div class="join-url">${esc(joinUrl().replace(/^https?:\/\//, ''))}</div>
          <div class="muted" style="font-size:20px;font-weight:700;margin-top:12px">и введите код комнаты</div>
          <div class="room-code">${esc(G.room)}</div>
        </div>
        <div class="center"><div style="font-size:64px;font-weight:900">${ps.length}</div><div class="muted" style="font-weight:700">игроков</div>
          <button class="btn primary big" data-act="start" style="margin-top:14px" ${ps.length ? '' : 'disabled'}>Начать ▶</button>
          <div class="muted" style="margin-top:8px;font-size:13px"><span class="kbd">Пробел</span> — дальше</div></div>
      </div>
      <div class="players">${ps.map(p => `<div class="pl ${p.online ? '' : 'off'}" data-kick="${p.id}" title="Нажмите, чтобы убрать">${avatarHTML(p.avatar, 'sm')}<span class="nm">${esc(fullName(p))}</span></div>`).join('')}</div>
      ${ps.length ? '' : '<p class="muted center" style="margin-top:30px;font-size:20px">Ждём первых игроков<span class="dots"></span></p>'}`;
  }

  function renderReady() {
    const q = G.quiz.questions[G.qi];
    app.innerHTML = topbar() + `<div class="card center" style="padding:60px 20px">
      <div class="muted" style="font-size:26px;font-weight:700">Вопрос ${G.qi + 1} из ${G.quiz.questions.length}</div>
      <div class="big-ico wobble" style="font-size:90px;margin:20px 0">⚡</div>
      <span class="pill stars" style="font-size:22px">${stars(q.difficulty)} · до ${fmt(q.points)} очков · ${q.time} с</span></div>`;
  }

  function timerSVG() {
    return `<div class="timer" id="timer"><svg viewBox="0 0 100 100"><circle class="ring" cx="50" cy="50" r="47"/><circle class="track" cx="50" cy="50" r="38"/><circle class="bar" cx="50" cy="50" r="38" stroke-dasharray="238.8" stroke-dashoffset="0"/></svg><span>0</span></div>`;
  }

  function renderQuestion() {
    const q = G.quiz.questions[G.qi];
    app.innerHTML = topbar() + `<div class="card">
      <div class="q-head"><span class="pill">Вопрос ${G.qi + 1} / ${G.quiz.questions.length}</span><span class="pill stars">${stars(q.difficulty)} · до ${fmt(q.points)}</span>
        ${q.multi ? '<span class="pill" style="background:var(--e)">несколько ответов</span>' : ''}<span class="spacer"></span>${timerSVG()}</div>
      <div class="q-text">${rich(q.text)}</div>
      ${q.code ? `<pre class="code">${esc(q.code)}</pre>` : ''}
      ${q.image ? `<img class="q-img" src="${esc(q.image)}" alt="">` : ''}
      <div class="opts">${q.options.map((o, i) => `<div class="opt o${i}"><span class="let">${LETTERS[i]}</span><span>${rich(o)}</span></div>`).join('')}</div>
      <div class="answered-bar"><span class="count" id="acount"></span><div class="mini-avas" id="aavas"></div><span class="spacer"></span>
        <button class="btn" data-act="endq">Завершить вопрос</button></div></div>`;
    updateAnswered();
  }

  function updateAnswered() {
    const c = document.getElementById('acount');
    if (!c) return;
    const ans = players().filter(p => p.answers[G.qi]);
    c.textContent = `Ответили: ${ans.length} / ${onlinePlayers().length}`;
    document.getElementById('aavas').innerHTML = ans.map(p => avatarHTML(p.avatar, 'sm')).join('');
  }

  function renderReveal() {
    const r = ranked();
    const q = G.quiz.questions[G.qi];
    const ans = players().filter(p => p.answers[G.qi]);
    const ok = ans.filter(p => p.answers[G.qi].correct).length;
    const last = G.qi === G.quiz.questions.length - 1;
    const row = (p, i) => {
      const a = p.answers[G.qi];
      const gain = a ? a.gain : 0;
      const d = p.prevRank ? p.prevRank - (i + 1) : 0;
      const mv = d > 0 ? `<span class="mv up">▲${d}</span>` : d < 0 ? `<span class="mv down">▼${-d}</span>` : '<span class="mv same">•</span>';
      return `<div class="lb-row" style="animation-delay:${i * 60}ms"><span class="rk">${i + 1}</span>${mv}${avatarHTML(p.avatar)}<span>${esc(fullName(p))}</span>
        <span class="gain ${gain ? '' : 'zero'}">+${fmt(gain)}</span><span class="sc">${fmt(p.score)}</span></div>`;
    };
    app.innerHTML = topbar() + `<div class="card">
      <div class="row"><h2 style="margin:0">Результаты вопроса ${G.qi + 1}</h2><span class="spacer"></span>
        ${G.showCorrect ? `<span class="pill">Верно ответили: ${ok} из ${players().length}</span>` : ''}
        <span class="pill stars">${stars(q.difficulty)}</span></div>
      <div class="lb" style="margin-top:16px">${r.slice(0, 10).map(row).join('')}</div>
      ${r.length > 10 ? `<div class="rest">${r.slice(10).map((p, i) => `<div><b>${i + 11}.</b><span>${esc(fullName(p))}</span><span class="spacer"></span><span>${fmt(p.score)}</span></div>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:20px"><span class="spacer"></span><button class="btn primary big" data-act="next">${last ? 'Итоги 🏆' : 'Следующий вопрос →'}</button></div></div>`;
  }

  function renderEnd() {
    const r = ranked();
    const n = G.quiz.questions.length;
    const rightCount = p => Object.values(p.answers).filter(a => a.correct).length;
    const pod = (p, place) => p ? `<div class="pod p${place}">${avatarHTML(p.avatar, 'lg')}<div class="nm">${esc(fullName(p))}</div><div class="sc">${fmt(p.score)}</div><div class="stand">${place}</div></div>` : '<div class="pod"></div>';
    app.innerHTML = topbar() + `<div class="card">
      <h1 class="center">Итоги 🏆</h1>
      <div class="podium">${pod(r[1], 2)}${pod(r[0], 1)}${pod(r[2], 3)}</div>
      <div class="row" style="justify-content:center;margin-bottom:18px">
        <button class="btn yellow" data-act="review">Разбор ответов</button>
        <button class="btn green" data-act="csv">Скачать CSV (Excel)</button>
        <button class="btn" data-act="json">Скачать JSON</button>
        <button class="btn primary" data-act="new">Новый квиз</button></div>
      <table class="res"><thead><tr><th>#</th><th></th><th>Фамилия Имя</th><th>Верно</th><th style="text-align:right">Очки</th></tr></thead><tbody>
      ${r.map((p, i) => `<tr><td><b>${i + 1}</b></td><td>${avatarHTML(p.avatar, 'sm')}</td><td>${esc(fullName(p))}</td><td>${rightCount(p)} / ${n}</td><td class="num">${fmt(p.score)}</td></tr>`).join('')}
      </tbody></table></div>`;
    confetti();
  }

  function renderReview() {
    const q = G.quiz.questions[reviewIdx];
    const ans = players().map(p => p.answers[reviewIdx]).filter(Boolean);
    const counts = q.options.map((_, i) => ans.filter(a => [].concat(a.choice).includes(i)).length);
    const max = Math.max(1, ...counts);
    const ok = ans.filter(a => a.correct).length;
    app.innerHTML = topbar() + `<div class="card">
      <div class="q-head"><span class="pill">Разбор: вопрос ${reviewIdx + 1} / ${G.quiz.questions.length}</span><span class="pill stars">${stars(q.difficulty)}</span>
        <span class="pill">Верно: ${ok} из ${players().length}</span><span class="spacer"></span>
        <button class="btn small" data-act="rv-prev" ${reviewIdx ? '' : 'disabled'}>←</button>
        <button class="btn small" data-act="rv-next" ${reviewIdx < G.quiz.questions.length - 1 ? '' : 'disabled'}>→</button>
        <button class="btn small" data-act="rv-back">К итогам</button></div>
      <div class="q-text">${rich(q.text)}</div>
      ${q.code ? `<pre class="code">${esc(q.code)}</pre>` : ''}
      ${q.image ? `<img class="q-img" src="${esc(q.image)}" alt="">` : ''}
      ${q.options.map((o, i) => `<div class="rv-opt ${q.correct.includes(i) ? 'right' : ''}"><span class="let" style="background:var(--${'abcdef'[i]})">${LETTERS[i]}</span>
        <span>${rich(o)} ${q.correct.includes(i) ? ' ✅' : ''}</span><div class="rv-bar"><i style="width:${(counts[i] / max) * 100}%"></i></div><b>${counts[i]}</b></div>`).join('')}
      ${q.explain ? `<div class="explain">💡 ${rich(q.explain)}</div>` : ''}</div>`;
  }

  function refresh() {
    if (!G) return;
    if (G.phase === 'lobby') renderLobby();
    else if (G.phase === 'question') updateAnswered();
  }

  function confetti() {
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['--a', '--b', '--c', '--d', '--e', '--f'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('i');
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = `var(${colors[i % colors.length]})`;
      c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
      c.style.animationDelay = Math.random() * 1.2 + 's';
      box.appendChild(c);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 7000);
  }

  // ---------- Выгрузка ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function fileBase() {
    const d = new Date(G.createdAt);
    const pad = x => String(x).padStart(2, '0');
    return `квиз_${G.quiz.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 40)}_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function exportCSV() {
    const qs = G.quiz.questions;
    const L = c => [].concat(c).map(i => LETTERS[i]).join('');
    const rows = [
      ['Место', 'Фамилия', 'Имя', 'Очки', 'Верных', ...qs.flatMap((_, i) => [`В${i + 1} ответ`, `В${i + 1} очки`])],
      ['', 'Правильный ответ', '', '', '', ...qs.flatMap(q => [L(q.correct), q.points])],
      ...ranked().map((p, r) => [r + 1, p.last, p.first, p.score, Object.values(p.answers).filter(a => a.correct).length,
        ...qs.flatMap((_, i) => (p.answers[i] ? [L(p.answers[i].choice), p.answers[i].gain] : ['—', 0]))]),
    ];
    const csv = '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    download(fileBase() + '.csv', csv, 'text/csv;charset=utf-8');
  }

  function exportJSON() {
    const data = {
      title: G.quiz.title, room: G.room, date: new Date(G.createdAt).toISOString(),
      questions: G.quiz.questions,
      results: ranked().map((p, i) => ({ place: i + 1, last: p.last, first: p.first, score: p.score, answers: p.answers })),
    };
    download(fileBase() + '.json', JSON.stringify(data, null, 2), 'application/json');
  }

  // ---------- Управление ----------
  function primaryAction() {
    if (!G) return;
    if (G.phase === 'lobby' && players().length) startQuestion(0);
    else if (G.phase === 'question') endQuestion();
    else if (G.phase === 'reveal') next();
  }

  app.addEventListener('click', e => {
    const k = e.target.closest('[data-kick]');
    if (k) return kick(k.dataset.kick);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'resume') {
      G = QZ.load(LS);
      connect();
      if (G.phase === 'ready') beginQuestion();
      else if (G.phase === 'question') {
        if (Date.now() > G.deadline + GRACE) endQuestion();
        else { renderQuestion(); runTick(); }
      } else if (G.phase === 'reveal') renderReveal();
      else if (G.phase === 'end') renderEnd();
      else renderLobby();
    } else if (act === 'drop') {
      cleanupOld();
      localStorage.removeItem(LS);
      renderSetup();
    } else if (act === 'start') startQuestion(0);
    else if (act === 'endq') endQuestion();
    else if (act === 'next') next();
    else if (act === 'review') { reviewIdx = 0; renderReview(); }
    else if (act === 'rv-prev') { reviewIdx--; renderReview(); }
    else if (act === 'rv-next') { reviewIdx++; renderReview(); }
    else if (act === 'rv-back') renderEnd();
    else if (act === 'csv') exportCSV();
    else if (act === 'json') exportJSON();
    else if (act === 'sound') {
      QZ.sound.on = settings.sound = !QZ.sound.on;
      QZ.save(LS_SET, settings);
      b.textContent = QZ.sound.on ? '🔊' : '🔇';
    } else if (act === 'fs') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (act === 'quit' || act === 'new') {
      if (act === 'quit' && G.phase !== 'end' && !confirm('Выйти из игры? Результаты можно будет продолжить через «Продолжить» на главном экране.')) return;
      stopTimers();
      if (client) { client.close(); client = null; }
      QZ.setNet('');
      G = null;
      renderSetup();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); primaryAction(); }
    if (G && G.phase === 'end' && document.querySelector('[data-act="rv-back"]')) {
      if (e.code === 'ArrowRight' && reviewIdx < G.quiz.questions.length - 1) { reviewIdx++; renderReview(); }
      if (e.code === 'ArrowLeft' && reviewIdx > 0) { reviewIdx--; renderReview(); }
    }
  });

  // Плавный таймер ведущего
  (function loop() {
    const t = document.getElementById('timer');
    if (t && G && G.phase === 'question') {
      const q = G.quiz.questions[G.qi];
      const left = Math.max(0, G.deadline - Date.now());
      t.querySelector('.bar').setAttribute('stroke-dashoffset', (238.8 * (1 - left / (q.time * 1000))).toFixed(1));
      t.querySelector('span').textContent = Math.ceil(left / 1000);
      t.classList.toggle('low', left < 5000);
    }
    requestAnimationFrame(loop);
  })();

  // ?quiz=quizzes/файл.json — сразу выбрать квиз
  const qp = new URLSearchParams(location.search).get('quiz');
  if (qp) {
    loadFromUrl(qp).then(q => { picked = Object.assign(q, { src: qp.replace(/^quizzes\//, '') }); renderSetup(); }).catch(e => renderSetup(e.message));
  } else renderSetup();
})();
