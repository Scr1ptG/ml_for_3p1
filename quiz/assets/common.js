'use strict';
// Общий код ведущего и игрока: MQTT-клиент, аватары, утилиты.
const QZ = (() => {
  // Публичные брокеры. Нечётная первая цифра кода комнаты -> основной, чётная -> запасной.
  const BROKERS = [
    { name: 'EMQX (основной)', url: 'wss://broker.emqx.io:8084/mqtt' },
    { name: 'HiveMQ (запасной)', url: 'wss://broker.hivemq.com:8884/mqtt' },
  ];
  const PREFIX = 'ithub-mlq/v1/';
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const brokerIndex = code => (Number(String(code)[0]) % 2 ? 0 : 1);
  const brokerFor = code => BROKERS[brokerIndex(code)].url;

  function makeRoom(idx) {
    let d;
    do d = 1 + Math.floor(Math.random() * 9); while ((d % 2 ? 0 : 1) !== idx);
    return d + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
  }

  function uid(n = 12) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => abc[b % 36]).join('');
  }

  // ---------- MQTT 3.1.1 поверх WebSocket, только QoS 0 ----------
  function str(s) {
    const b = enc.encode(s);
    return [b.length >> 8, b.length & 255, ...b];
  }

  function packet(head, body) {
    const len = [];
    let n = body.length;
    do {
      let d = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) d |= 128;
      len.push(d);
    } while (n > 0);
    return new Uint8Array([head, ...len, ...body]);
  }

  class Mqtt {
    constructor(url, { clientId, will, onStatus, onMessage }) {
      Object.assign(this, { url, clientId, will, onMessage, subs: new Set(), queue: [], pid: 1, retryMs: 500, closed: false });
      this.onStatus = onStatus || (() => {});
      this.open();
    }

    open() {
      this.onStatus('connecting');
      let ws;
      try {
        ws = new WebSocket(this.url, ['mqtt']);
      } catch (e) {
        this.scheduleRetry();
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      this.buf = new Uint8Array(0);
      this.ready = false;
      ws.onopen = () => this.raw(this.connectPacket());
      ws.onmessage = e => {
        this.lastRx = Date.now();
        this.feed(new Uint8Array(e.data));
      };
      ws.onclose = () => {
        this.ready = false;
        clearInterval(this.timer);
        if (!this.closed) {
          this.onStatus('offline');
          this.scheduleRetry();
        }
      };
      ws.onerror = () => {};
    }

    scheduleRetry() {
      setTimeout(() => !this.closed && this.open(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 8000);
    }

    connectPacket() {
      let flags = 0x02; // clean session
      const payload = str(this.clientId);
      if (this.will) {
        flags |= 0x04;
        payload.push(...str(this.will.topic), ...str(this.will.payload));
      }
      return packet(0x10, [...str('MQTT'), 4, flags, 0, 30, ...payload]);
    }

    feed(chunk) {
      const b = new Uint8Array(this.buf.length + chunk.length);
      b.set(this.buf);
      b.set(chunk, this.buf.length);
      let p = 0;
      while (b.length - p >= 2) {
        let len = 0, mul = 1, i = p + 1, byte, complete = true;
        do {
          if (i >= b.length) { complete = false; break; }
          byte = b[i++];
          len += (byte & 127) * mul;
          mul *= 128;
        } while (byte & 128);
        if (!complete || i + len > b.length) break;
        try {
          this.handle(b[p], b.subarray(i, i + len));
        } catch (e) {
          console.error(e);
        }
        p = i + len;
      }
      this.buf = b.slice(p);
    }

    handle(head, body) {
      const type = head >> 4;
      if (type === 2) { // CONNACK
        if (body[1] !== 0) { this.ws.close(); return; }
        this.ready = true;
        this.retryMs = 500;
        this.subs.forEach(t => this.sendSub(t));
        const q = this.queue;
        this.queue = [];
        q.forEach(p => this.raw(p));
        this.timer = setInterval(() => {
          if (Date.now() - this.lastRx > 45000) this.ws.close();
          else this.raw(new Uint8Array([0xc0, 0]));
        }, 20000);
        this.onStatus('online');
      } else if (type === 3) { // PUBLISH
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.subarray(2, 2 + tl));
        let off = 2 + tl;
        if ((head >> 1) & 3) off += 2;
        if (this.onMessage) this.onMessage(topic, dec.decode(body.subarray(off)), !!(head & 1));
      }
    }

    raw(p) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(p);
    }

    sendSub(t) {
      const id = (this.pid++ % 65535) + 1;
      this.raw(packet(0x82, [id >> 8, id & 255, ...str(t), 0]));
    }

    subscribe(t) {
      this.subs.add(t);
      if (this.ready) this.sendSub(t);
    }

    publish(topic, data, retain = false) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      const p = packet(0x30 | (retain ? 1 : 0), [...str(topic), ...enc.encode(payload)]);
      if (this.ready) this.raw(p);
      else {
        this.queue.push(p);
        if (this.queue.length > 100) this.queue.shift();
      }
    }

    close() {
      this.closed = true;
      this.raw(new Uint8Array([0xe0, 0]));
      if (this.ws) this.ws.close();
    }
  }

  // ---------- Аватары: только неживые предметы ----------
  const S = 'stroke="#1F1B2E" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
  const AVATARS = [
    { key: 'rocket', bg: '#4D96FF', svg: '<path d="M26 44h12l-2 6h-8z" fill="#cfd3dc"/><path d="M28 50q4 9 8 0" fill="#FFC93C"/><path d="M20 34l-7 10 8-1zM44 34l7 10-8-1z" fill="#FF6B6B"/><path d="M32 8c9 7 13 17 12 30v6H20v-6c-1-13 3-23 12-30z" fill="#fff"/><circle cx="32" cy="26" r="5" fill="#A0E7FF"/>' },
    { key: 'planet', bg: '#6C5CE7', svg: '<g transform="rotate(-20 32 32)"><ellipse cx="32" cy="32" rx="25" ry="7" fill="none"/><circle cx="32" cy="32" r="13" fill="#FFC93C"/><path d="M7 32a25 7 0 0 0 50 0" fill="none"/></g><circle cx="27" cy="27" r="2.5" fill="#E8A15A" stroke="none"/><circle cx="36" cy="36" r="2" fill="#E8A15A" stroke="none"/>' },
    { key: 'pizza', bg: '#FF6B6B', svg: '<path d="M12 18q20-9 40 0L32 56z" fill="#FFC93C"/><path d="M12 18q20-9 40 0l-3 6q-17-7-34 0z" fill="#E8A15A"/><circle cx="27" cy="30" r="4" fill="#FF6B6B"/><circle cx="37" cy="35" r="3.5" fill="#FF6B6B"/><circle cx="31" cy="44" r="3" fill="#FF6B6B"/>' },
    { key: 'donut', bg: '#FFC93C', svg: '<circle cx="32" cy="32" r="20" fill="#E8A15A"/><path d="M13 30c1-10 9-17 19-17s18 7 19 17c-3 3-5 0-8 3s-6 1-9 3-7-1-10 1-7-4-11-7z" fill="#FF8FB1"/><circle cx="32" cy="32" r="6" fill="#FFC93C"/><path d="M22 21l3 2M40 20l-2 3M45 28l3 1M18 29l3-1" stroke="#fff"/>' },
    { key: 'gamepad', bg: '#3DC47E', svg: '<path d="M16 24h32a8 8 0 0 1 8 7l2 12a5 5 0 0 1-9 4l-5-7H20l-5 7a5 5 0 0 1-9-4l2-12a8 8 0 0 1 8-7z" fill="#fff"/><path d="M17 31h4v-4h4v4h4v4h-4v4h-4v-4h-4z" fill="#1F1B2E" stroke="none"/><circle cx="44" cy="30" r="2.5" fill="#FF6B6B"/><circle cx="49" cy="35" r="2.5" fill="#4D96FF"/>' },
    { key: 'camera', bg: '#FF8FB1', svg: '<path d="M24 21l3-6h10l3 6" fill="#cfd3dc"/><rect x="10" y="21" width="44" height="29" rx="6" fill="#fff"/><circle cx="32" cy="35" r="10" fill="#4D96FF"/><circle cx="32" cy="35" r="4" fill="#1F1B2E" stroke="none"/><circle cx="47" cy="27" r="2" fill="#FFC93C"/>' },
    { key: 'bulb', bg: '#6C5CE7', svg: '<path d="M32 9a15 15 0 0 1 9 27c-2 2-3 4-3 7H26c0-3-1-5-3-7a15 15 0 0 1 9-27z" fill="#FFC93C"/><rect x="25" y="43" width="14" height="10" rx="3" fill="#cfd3dc"/><path d="M27 48h10M28 30l4 4 4-4"/>' },
    { key: 'ufo', bg: '#00B8A9', svg: '<path d="M25 42l-7 14h28l-7-14z" fill="#FFF3B0" stroke="none"/><path d="M21 31a11 11 0 0 1 22 0z" fill="#A0E7FF"/><ellipse cx="32" cy="35" rx="24" ry="8" fill="#cfd3dc"/><circle cx="19" cy="36" r="2" fill="#FFC93C"/><circle cx="32" cy="38" r="2" fill="#FFC93C"/><circle cx="45" cy="36" r="2" fill="#FFC93C"/>' },
    { key: 'crown', bg: '#FF6B6B', svg: '<path d="M10 46L8 21l12 11 12-16 12 16 12-11-2 25z" fill="#FFC93C"/><rect x="10" y="46" width="44" height="7" rx="2" fill="#FFC93C"/><circle cx="32" cy="36" r="3" fill="#4D96FF"/><circle cx="20" cy="39" r="2" fill="#3DC47E"/><circle cx="44" cy="39" r="2" fill="#3DC47E"/>' },
    { key: 'gem', bg: '#4D96FF', svg: '<path d="M18 14h28l10 12-24 27L8 26z" fill="#A0E7FF"/><path d="M8 26h48M18 14l6 12 8-12 8 12 6-12M24 26l8 27 8-27" fill="none"/>' },
    { key: 'icecream', bg: '#A0E7FF', svg: '<path d="M21 32h22L32 57z" fill="#E8A15A"/><path d="M25 38l12 6M27 44l8 4" stroke-width="2"/><circle cx="25" cy="27" r="8" fill="#FF8FB1"/><circle cx="39" cy="27" r="8" fill="#fff"/><circle cx="32" cy="17" r="8" fill="#FFC93C"/>' },
    { key: 'headphones', bg: '#FFC93C', svg: '<path d="M14 39v-7a18 18 0 0 1 36 0v7" fill="none"/><rect x="9" y="34" width="11" height="18" rx="5" fill="#FF6B6B"/><rect x="44" y="34" width="11" height="18" rx="5" fill="#FF6B6B"/>' },
    { key: 'plane', bg: '#3DC47E', svg: '<path d="M8 30l48-18-13 42-11-14z" fill="#fff"/><path d="M32 40l24-28-28 23z" fill="#dfe3ea"/><path d="M32 40l-2 12 6-6" fill="#dfe3ea"/>' },
    { key: 'moon', bg: '#2D3561', svg: '<path d="M38 10A22 22 0 1 0 54 42A19 19 0 0 1 38 10Z" fill="#FFC93C"/><path d="M48 14l1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5z" fill="#fff" stroke="none"/><circle cx="54" cy="28" r="1.5" fill="#fff" stroke="none"/>' },
    { key: 'bolt', bg: '#6C5CE7', svg: '<path d="M37 6L14 36h14l-4 22 25-32H35z" fill="#FFC93C"/>' },
    { key: 'dice', bg: '#FF8FB1', svg: '<rect x="14" y="14" width="36" height="36" rx="8" fill="#fff"/><g fill="#1F1B2E" stroke="none"><circle cx="23" cy="23" r="3.2"/><circle cx="41" cy="23" r="3.2"/><circle cx="32" cy="32" r="3.2"/><circle cx="23" cy="41" r="3.2"/><circle cx="41" cy="41" r="3.2"/></g>' },
    { key: 'coffee', bg: '#E8A15A', svg: '<path d="M44 30h4a6 6 0 0 1 0 12h-5" fill="none"/><path d="M16 26h28v14a12 12 0 0 1-12 12h-4a12 12 0 0 1-12-12z" fill="#fff"/><path d="M24 20c-3-4 3-6 0-10M32 20c-3-4 3-6 0-10" fill="none"/>' },
    { key: 'robot', bg: '#00B8A9', svg: '<path d="M32 20v-7"/><circle cx="32" cy="11" r="3" fill="#FF6B6B"/><rect x="15" y="20" width="34" height="28" rx="7" fill="#dfe3ea"/><circle cx="25" cy="32" r="4" fill="#4D96FF"/><circle cx="39" cy="32" r="4" fill="#4D96FF"/><path d="M26 41h12"/>' },
  ];
  const AV = Object.fromEntries(AVATARS.map(a => [a.key, a]));

  function avatarSVG(key) {
    const a = AV[key] || AVATARS[0];
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="${a.bg}"/><g ${S}>${a.svg}</g></svg>`;
  }

  function avatarHTML(av, cls = '') {
    if (av && av.type === 'img' && /^data:image\/(jpeg|png|webp);base64,/.test(av.data)) {
      return `<span class="ava ${cls}"><img src="${av.data}" alt=""></span>`;
    }
    return `<span class="ava ${cls}">${avatarSVG(av && av.key)}</span>`;
  }

  // Сжимает загруженную картинку до квадрата 96x96 JPEG (~4–6 КБ)
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 96;
        const s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => reject(new Error('Не удалось открыть картинку'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------- Утилиты ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const parse = t => { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } };
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } };
  const LETTERS = 'ABCDEF';
  const stars = d => '★'.repeat(d) + '☆'.repeat(3 - d);
  const fmt = n => Number(n || 0).toLocaleString('ru-RU');

  function setNet(status) {
    const el = document.getElementById('net');
    if (!el) return;
    el.className = 'net ' + status;
    el.textContent = { online: 'онлайн', connecting: 'подключение…', offline: 'нет связи, переподключаюсь…' }[status] || status;
  }

  // Короткие звуки только у ведущего
  let actx = null;
  const sound = {
    on: true,
    beep(freq = 660, dur = 0.12, type = 'sine', vol = 0.15) {
      if (!this.on) return;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.setValueAtTime(vol, actx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
        o.connect(g).connect(actx.destination);
        o.start();
        o.stop(actx.currentTime + dur);
      } catch (e) { /* без звука */ }
    },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, 0.25, 'triangle'), i * 140)); },
  };

  return { BROKERS, PREFIX, brokerIndex, brokerFor, makeRoom, uid, Mqtt, AVATARS, avatarHTML, shrinkImage, esc, parse, load, save, LETTERS, stars, fmt, setNet, sound };
})();
