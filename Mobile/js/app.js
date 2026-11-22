// АвтоСервис CRM — мобильная версия: экраны «Бокс», «Календарь», «Настройки» и форма заявки.
import {
  STATUSES, statusTitle, normalizePlate, addDays, startOfDay, setHour, WORK_START_HOUR, WORK_END_HOUR,
} from './format.js';
import { GoogleGateway, AuthRequiredError } from './google.js';
import { DemoGateway } from './demo.js';
import { Store } from './store.js';

const VERSION = '1.1.0';
const params = new URLSearchParams(location.search);
const isDemo = params.has('demo');
const CLIENT_ID_KEY = 'asc.clientId';

// ---------- Подключение ----------
function clientId() {
  return (window.APP_CONFIG && window.APP_CONFIG.googleClientId) || localStorage.getItem(CLIENT_ID_KEY) || '';
}
function makeGateway() {
  if (isDemo) return new DemoGateway();
  return clientId() ? new GoogleGateway(clientId()) : null;
}

let store = new Store(makeGateway(), { demo: isDemo });
store.addEventListener('change', () => render());

// ---------- Состояние экранов ----------
const ui = {
  route: (location.hash || '#box').slice(1),
  calMode: localStorage.getItem('asc.calMode') || 'day',
  calDate: startOfDay(new Date()),
  calendars: null,        // список календарей Google для выбора
  ganttScroll: 0,
  ganttReset: true,       // при смене периода — прокрутить к сегодняшнему дню
};
// ---------- Утилиты ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dm = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (d, o) => new Intl.DateTimeFormat('ru-RU', o).format(d);
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const range = (a) => (sameDay(a.start, a.end) ? `${hm(a.start)}–${hm(a.end)}` : `${dm(a.start)} ${hm(a.start)} – ${dm(a.end)} ${hm(a.end)}`);
const daysWord = (n) => { const m10 = n % 10, m100 = n % 100; return `${n} ${m100 >= 11 && m100 <= 14 ? 'дней' : m10 === 1 ? 'день' : m10 >= 2 && m10 <= 4 ? 'дня' : 'дней'}`; };
const nextHalfHour = (d) => { const x = new Date(d); x.setSeconds(0, 0); x.setMinutes(Math.ceil(x.getMinutes() / 30) * 30); return x; };
const carTitle = (a) => `${a.brand || ''} ${a.model || ''}`.trim();

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const ICONS = {
  box: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3 2 9v12h6v-7h8v7h6V9zm0 2.3 8 4.8V19h-2v-7H6v7H4v-8.9z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm12 8H5v9h14zM5 8h14V6H5zm2 4h3v3H7z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.3 7.3 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.3 7.3 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.3 7.3 0 0 0 1.7 1L11 21h4l.4-2.9a7.3 7.3 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
};

// Автомобиль сверху (как на схеме бокса в программе на компьютере)
const CAR_SVG = `<svg class="car" viewBox="0 0 110 230" aria-hidden="true">
  <defs><linearGradient id="body" x1="0" x2="1"><stop offset="0" stop-color="#93A3B8"/><stop offset=".45" stop-color="#F1F5F9"/><stop offset=".6" stop-color="#E2E8F0"/><stop offset="1" stop-color="#8B9BB0"/></linearGradient></defs>
  <rect x="0" y="38" width="12" height="40" rx="3" fill="#0B0F17"/><rect x="98" y="38" width="12" height="40" rx="3" fill="#0B0F17"/>
  <rect x="0" y="160" width="12" height="40" rx="3" fill="#0B0F17"/><rect x="98" y="160" width="12" height="40" rx="3" fill="#0B0F17"/>
  <rect x="6" y="2" width="98" height="226" rx="30" fill="url(#body)"/>
  <path d="M18 72h74l-9 28H27z" fill="#1E293B"/><rect x="26" y="102" width="58" height="60" rx="8" fill="#CBD5E1"/>
  <path d="M27 164h56l7 24H20z" fill="#1E293B"/>
  <rect x="16" y="7" width="20" height="7" rx="3" fill="#FEF9C3"/><rect x="74" y="7" width="20" height="7" rx="3" fill="#FEF9C3"/>
  <rect x="16" y="216" width="20" height="7" rx="3" fill="#EF4444"/><rect x="74" y="216" width="20" height="7" rx="3" fill="#EF4444"/>
</svg>`;

// ---------- Отрисовка ----------
const ROUTES = [
  { id: 'box', title: 'Бокс', icon: ICONS.box },
  { id: 'calendar', title: 'Календарь', icon: ICONS.calendar },
  { id: 'settings', title: 'Настройки', icon: ICONS.settings },
];

function render() {
  const nav = ROUTES.map((r) => `<button class="tab ${ui.route === r.id ? 'active' : ''}" data-route="${r.id}">
    <span class="tab-icon">${r.icon}</span><span>${r.title}</span></button>`).join('');
  $('#tabbar').innerHTML = nav;
  $('#side-nav').innerHTML = nav;
  $('#refresh').classList.toggle('spinning', store.busy);
  $('#side-status').textContent = statusLine();
  renderBanner();

  const scroller = $('.g-scroll');
  if (scroller && !ui.ganttReset) ui.ganttScroll = scroller.scrollLeft;

  if (ui.route === 'calendar') renderCalendar();
  else if (ui.route === 'settings') renderSettings();
  else renderBox();

  const g = $('.g-scroll');
  if (g) {
    // При первом открытии периода — прокручиваем к сегодняшнему дню
    if (ui.ganttReset) { ui.ganttScroll = ui.ganttTodayX || 0; ui.ganttReset = false; }
    g.scrollLeft = ui.ganttScroll;
  }
}

function statusLine() {
  if (isDemo) return 'Демо-режим: данные не из Google';
  if (!clientId()) return 'Google не настроен';
  if (!store.gw || !store.gw.isSignedIn) return 'Вход в Google не выполнен';
  if (!store.calendarId) return 'Не выбран календарь';
  if (store.busy) return 'Обновление…';
  return store.lastSync ? `Обновлено в ${hm(store.lastSync)}` : 'Ещё не обновлялось';
}

function renderBanner() {
  let html = '';
  if (isDemo) {
    html = `<div class="banner info"><div class="spacer">Демо-режим: примеры данных, Google не подключён.</div></div>`;
  } else if (!clientId() || !store.calendarId) {
    if (ui.route !== 'settings') html = `<div class="banner info"><div class="spacer">Подключите Google Календарь, чтобы видеть и записывать заявки.</div>
      <button class="btn small" data-route="settings">Настроить</button></div>`;
  } else if (!store.gw.isSignedIn || store.needsAuth) {
    html = `<div class="banner info"><div class="spacer">Чтобы обновить данные, войдите в Google.</div>
      <button class="btn small" data-action="sign-in">Войти</button></div>`;
  } else if (store.error) {
    html = `<div class="banner error"><div class="spacer">${esc(store.error)}</div>
      <button class="btn small secondary" data-action="refresh">Повторить</button></div>`;
  } else if (store.duplicates > 0) {
    html = `<div class="banner info"><div class="spacer">Найдено дублей в календаре: ${store.duplicates}. Показана одна копия; лишние удалит программа на компьютере при синхронизации.</div></div>`;
  }
  $('#banner').innerHTML = html;
}

function setTitle(title, subtitle) {
  $('#title').textContent = title;
  $('#subtitle').textContent = subtitle;
  document.title = `${title} — АвтоСервис CRM`;
}

// ===== Бокс =====
function renderBox() {
  const now = new Date();
  setTitle('Бокс', cap(fmt(now, { weekday: 'long', day: 'numeric', month: 'long' })) + ' · ' + hm(now));

  if (!store.lifts.length) {
    $('#view').innerHTML = `<div class="card empty">${store.busy ? 'Загрузка…' : 'Подъёмники появятся после подключения к Google Календарю.'}</div>`;
    return;
  }
  const lifts = store.lifts.map((l) => ({ ...l, current: store.current(l.number, now) }));
  const busy = lifts.filter((l) => l.current).length;

  $('#view').innerHTML = `
    <div class="chips">
      <span class="chip"><span class="dot" style="color:var(--free)"></span>Свободно <b>${lifts.length - busy}</b></span>
      <span class="chip"><span class="dot" style="color:var(--busy)"></span>Занято <b>${busy}</b></span>
    </div>
    <div class="box">
      <div class="box-title"><span>БОКС</span><span>нажмите на подъёмник</span></div>
      <div class="lifts">
        ${lifts.map((l) => `
          <button class="lift-card ${l.current ? 'busy' : 'free'}" data-action="open-lift" data-lift="${l.number}">
            <span class="pill ${l.current ? 'solid-busy' : 'solid-free'}"><span class="dot" style="color:#fff"></span>${l.current ? 'Занят' : 'Свободен'}</span>
            <span class="bay">
              <span class="rail l"></span><span class="rail r"></span><span class="post l"></span><span class="post r"></span>
              ${l.current ? CAR_SVG + `<span class="plate">${esc(l.current.plate || '—')}</span>` : '<span class="free-label">СВОБОДНО</span>'}
            </span>
            <span class="lift-name">${esc(l.name)}</span>
            <span class="lift-sub">${l.current ? esc(l.current.clientName) + ' · до ' + hm(l.current.end) : 'Нет автомобиля'}</span>
          </button>`).join('')}
        <button class="add-lift" data-action="add-lift">+ Подъёмник</button>
      </div>
    </div>`;
}

function openLiftSheet(number) {
  const lift = store.lifts.find((l) => l.number === number);
  if (!lift) return;
  const now = new Date();
  const today = startOfDay(now);
  const current = store.current(number, now);
  const list = store.inRange(today, addDays(today, 1)).filter((a) => a.liftNumber === number);
  const next = list.find((a) => a.start > now && a.status !== 'Done');

  const info = current ? `
    <div class="info-block">
      <div class="section-label">Автомобиль</div>
      <div class="big">${esc(carTitle(current) || '—')}</div>
      <div style="margin-top:8px"><span class="plate">${esc(current.plate || '—')}</span></div>
    </div>
    <div class="info-block">
      <div class="section-label">Клиент</div>
      <div class="big">${esc(current.clientName)}</div>
      ${current.phone ? `<div class="kv"><a href="tel:${esc(current.phone.replace(/[^\d+]/g, ''))}">${esc(current.phone)}</a></div>` : '<div class="kv muted">телефон не указан</div>'}
    </div>
    <div class="info-block">
      <div class="section-label">Работы</div>
      <div>${esc(current.work || '—')}</div>
      <div class="kv"><span class="k">Время:</span><b>${range(current)}</b><span class="spacer"></span><span class="muted">${statusTitle(current.status)}</span></div>
      <div class="kv"><span class="k">Ответственный:</span><b>${esc(current.responsible || 'не назначен')}</b></div>
      <button class="btn secondary small" style="margin-top:10px" data-action="edit" data-event="${esc(current.eventId)}">Изменить заявку</button>
    </div>` : `
    <div class="info-block" style="background:var(--free-soft)">
      <div class="big" style="color:#166534">Подъёмник свободен</div>
      <div style="color:#15803D">${next ? `Следующая запись: ${hm(next.start)} — ${esc(next.plate || next.clientName)}` : 'Сегодня больше записей нет'}</div>
    </div>`;

  openSheet(`
    <div class="grabber"></div>
    <div class="sheet-head"><h2>${esc(lift.name)}</h2>
      <span class="pill ${current ? 'busy' : 'free'}">${current ? 'Занят' : 'Свободен'}</span>
      <button class="icon-btn" data-action="close-sheet" aria-label="Закрыть">${ICONS.close}</button></div>
    <div class="sheet-body">
      ${info}
      <div class="section-label" style="margin-top:14px">Записи на сегодня</div>
      ${list.length ? `<div class="card" style="box-shadow:none">${list.map(apptRow).join('')}</div>` : '<div class="muted">Записей нет</div>'}
    </div>
    <div class="sheet-foot"><button class="btn" data-action="new" data-lift="${number}">${ICONS.plus} Новая заявка на этот подъёмник</button></div>`);
}

function apptRow(a) {
  return `<button class="appt ${a.status}" data-action="edit" data-event="${esc(a.eventId)}">
    <span class="appt-bar"></span>
    <span class="appt-time">${sameDay(a.start, a.end) ? `${hm(a.start)}<br><span class="muted" style="font-weight:400">${hm(a.end)}</span>` : `${dm(a.start)} ${hm(a.start)}<br><span class="muted" style="font-weight:400">${dm(a.end)} ${hm(a.end)}</span>`}</span>
    <span class="appt-body">
      <div class="t1">${esc(a.plate || '—')} · ${esc(a.clientName)}</div>
      <div class="t2">${esc([carTitle(a), a.work].filter(Boolean).join(' · ') || '—')}</div>
      <div class="t3">${statusTitle(a.status)}${a.responsible ? ' · ' + esc(a.responsible) : ''}</div>
    </span></button>`;
}

// ===== Календарь =====
function calRange() {
  const d = ui.calDate;
  if (ui.calMode === 'week') { const from = addDays(d, -((d.getDay() + 6) % 7)); return { from, days: 7 }; }
  if (ui.calMode === 'month') { const from = new Date(d.getFullYear(), d.getMonth(), 1); return { from, days: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }; }
  return { from: startOfDay(d), days: 1 };
}

function calTitle() {
  const { from, days } = calRange();
  const to = addDays(from, days - 1);
  if (ui.calMode === 'week') {
    return from.getMonth() === to.getMonth()
      ? `${from.getDate()}–${fmt(to, { day: 'numeric', month: 'long' })}`
      : `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short' })}`;
  }
  if (ui.calMode === 'month') return cap(fmt(from, { month: 'long', year: 'numeric' }).replace(' г.', ''));
  return cap(fmt(from, { weekday: 'short', day: 'numeric', month: 'long' }));
}

function renderCalendar() {
  setTitle('Календарь', calTitle());
  const { from, days } = calRange();
  ensureLoaded(from, addDays(from, days));

  const controls = `
    <div class="cal-controls">
      <div class="segmented">
        ${[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']].map(([m, t]) =>
          `<button class="${ui.calMode === m ? 'active' : ''}" data-action="cal-mode" data-mode="${m}">${t}</button>`).join('')}
      </div>
      <div class="date-nav">
        <button class="icon-btn" data-action="cal-prev" aria-label="Назад">${ICONS.left}</button>
        <label class="btn secondary small date-pick grow">${esc(calTitle())}
          <input type="date" value="${isoDate(ui.calDate)}" data-action="cal-date" aria-label="Выбрать дату"></label>
        <button class="icon-btn" data-action="cal-next" aria-label="Вперёд">${ICONS.right}</button>
        <button class="btn secondary small" data-action="cal-today">Сегодня</button>
      </div>
    </div>`;

  if (!store.lifts.length) {
    $('#view').innerHTML = controls + `<div class="card empty">${store.busy ? 'Загрузка…' : 'Нет данных — подключите Google Календарь в настройках.'}</div>`;
    return;
  }
  $('#view').innerHTML = controls + (ui.calMode === 'day' ? dayView(from) : ganttView(from, days));
}

function dayView(day) {
  const list = store.inRange(day, addDays(day, 1));
  return store.lifts.map((l) => {
    const items = list.filter((a) => a.liftNumber === l.number);
    return `<section class="card day-lift">
      <div class="day-lift-head"><h3>${esc(l.name)}</h3><span class="muted">${items.length ? items.length + ' ' + (items.length === 1 ? 'запись' : items.length < 5 ? 'записи' : 'записей') : 'свободен'}</span></div>
      ${items.map(apptRow).join('')}
      <button class="add-row" data-action="new" data-lift="${l.number}" data-date="${isoDate(day)}">+ Записать</button>
    </section>`;
  }).join('');
}

/** Позиция момента на шкале: каждый день — одинаковой ширины, внутри дня только рабочие часы. */
function position(moment, from, days) {
  const dayIndex = Math.floor((startOfDay(moment) - from) / 864e5 + 0.5);
  const hours = moment.getHours() + moment.getMinutes() / 60;
  const inDay = Math.min(Math.max((hours - WORK_START_HOUR) / (WORK_END_HOUR - WORK_START_HOUR), 0), 1);
  return Math.min(Math.max((dayIndex + inDay) / days, 0), 1);
}

function ganttView(from, days) {
  const narrow = window.innerWidth < 600;
  const liftCol = narrow ? 84 : 108;
  const available = ($('#view').clientWidth || window.innerWidth - 32) - liftCol - 2;
  const dayW = ui.calMode === 'week' ? Math.max(narrow ? 52 : 64, Math.floor(available / 7)) : Math.max(narrow ? 38 : 28, Math.floor(available / days));
  ui.ganttTodayX = null;
  const todayIndex = Math.round((startOfDay(new Date()) - from) / 864e5);
  if (todayIndex > 0 && todayIndex < days) ui.ganttTodayX = Math.max(0, (todayIndex - 1) * dayW);
  const width = dayW * days;
  const to = addDays(from, days);
  const today = startOfDay(new Date());
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const list = store.inRange(from, to);

  const head = `<div class="g-row g-head"><div class="g-lift">ПОДЪЁМНИК</div><div class="g-days">${dates.map((d) =>
    `<div class="g-day ${isWeekend(d) ? 'weekend' : ''} ${sameDay(d, today) ? 'today' : ''}" style="width:${dayW}px">
      <span class="wd">${fmt(d, { weekday: 'short' })}</span><b>${d.getDate()}</b></div>`).join('')}</div></div>`;

  const rows = store.lifts.map((l) => {
    const items = list.filter((a) => a.liftNumber === l.number);
    const cells = dates.map((d, i) => `<button class="g-cell ${isWeekend(d) ? 'weekend' : ''} ${sameDay(d, today) ? 'today' : ''}"
      style="left:${i * dayW}px;width:${dayW}px" data-action="new" data-lift="${l.number}" data-date="${isoDate(d)}" aria-label="Записать на ${dm(d)}"></button>`).join('');
    const bars = items.map((a) => {
      const left = position(a.start, from, days) * width;
      const w = Math.max(position(a.end, from, days) * width - left, 10);
      const span = Math.round((startOfDay(new Date(a.end.getTime() - 1)) - startOfDay(a.start)) / 864e5) + 1;
      return `<button class="g-bar ${a.status}" style="left:${left}px;width:${w}px" data-action="edit" data-event="${esc(a.eventId)}"
        title="${esc(`${a.plate} · ${a.clientName}\n${range(a)}`)}">
        <span class="b1">${esc(a.plate || '—')}${span > 1 ? `<span class="days">${daysWord(span)}</span>` : ''}</span>
        <span class="b2">${esc(a.clientName)}</span></button>`;
    }).join('');
    return `<div class="g-row"><div class="g-lift"><b>${esc(l.name)}</b><span>${items.length ? 'заявок: ' + items.length : 'нет заявок'}</span></div>
      <div class="g-track" style="width:${width}px">${cells}${bars}</div></div>`;
  }).join('');

  return `<div class="card gantt"><div class="g-scroll"><div class="g-inner" style="width:${liftCol + width}px">${head}${rows}</div></div></div>`;
}

// Подгружаем период календаря, если он выходит за уже загруженный
const loadedRanges = [];
function ensureLoaded(from, to) {
  if (!store.ready || store.busy) return;
  if (loadedRanges.some((r) => r.from <= from && r.to >= to)) return;
  const today = startOfDay(new Date());
  if (from >= addDays(today, -31) && to <= addDays(today, 62) && store.lastSync) return;
  loadedRanges.push({ from, to });
  store.loadRange(from, to).then(() => render()).catch((e) => toast(e.message));
}

// ===== Форма заявки =====
function openForm(appt, defaults = {}) {
  const isNew = !appt;
  const now = new Date();
  const start = appt ? appt.start : defaults.start || nextHalfHour(now);
  const end = appt ? appt.end : new Date(start.getTime() + 3600e3);
  const a = appt || { liftNumber: defaults.liftNumber || store.lifts[0].number, status: 'Planned' };

  openSheet(`
    <div class="grabber"></div>
    <div class="sheet-head"><h2>${isNew ? 'Новая заявка' : 'Заявка'}</h2>
      <button class="icon-btn" data-action="close-sheet" aria-label="Закрыть">${ICONS.close}</button></div>
    <form class="sheet-body" id="appt-form" novalidate>
      <div class="form-grid">
        <div class="section-label form-section">Клиент</div>
        <div class="field full"><label for="f-client">ФИО *</label><input id="f-client" autocomplete="name" value="${esc(a.clientName || '')}"></div>
        <div class="field full"><label for="f-phone">Телефон</label><input id="f-phone" type="tel" autocomplete="tel" value="${esc(a.phone || '')}"></div>

        <div class="section-label form-section">Автомобиль</div>
        <div class="field"><label for="f-brand">Марка *</label><input id="f-brand" value="${esc(a.brand || '')}"></div>
        <div class="field"><label for="f-model">Модель</label><input id="f-model" value="${esc(a.model || '')}"></div>
        <div class="field full"><label for="f-plate">Госномер *</label><input id="f-plate" autocapitalize="characters" value="${esc(a.plate || '')}"></div>

        <div class="section-label form-section">Заявка</div>
        <div class="field"><label for="f-lift">Подъёмник</label><select id="f-lift">${store.lifts.map((l) =>
          `<option value="${l.number}" ${l.number === a.liftNumber ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="f-status">Статус</label><select id="f-status">${STATUSES.map((s) =>
          `<option value="${s.value}" ${s.value === a.status ? 'selected' : ''}>${s.title}</option>`).join('')}</select></div>
        <div class="field"><label for="f-sdate">Начало</label><input id="f-sdate" type="date" value="${isoDate(start)}"></div>
        <div class="field"><label for="f-stime">&nbsp;</label><input id="f-stime" type="time" step="900" value="${hm(start)}"></div>
        <div class="field"><label for="f-edate">Окончание</label><input id="f-edate" type="date" value="${isoDate(end)}"></div>
        <div class="field"><label for="f-etime">&nbsp;</label><input id="f-etime" type="time" step="900" value="${hm(end)}"></div>
        <div class="field full"><label for="f-resp">Ответственный</label><input id="f-resp" value="${esc(a.responsible || '')}"></div>
        <div class="field full"><label for="f-work">Описание работ</label><textarea id="f-work">${esc(a.work || '')}</textarea></div>
      </div>
      <div id="form-error" class="form-error" hidden></div>
    </form>
    <div class="sheet-foot">
      ${isNew ? '' : '<button class="btn danger" data-action="delete" style="flex:0 0 auto">Удалить</button>'}
      <button class="btn secondary" data-action="close-sheet">Отмена</button>
      <button class="btn" data-action="save">Сохранить</button>
    </div>`);

  const sheet = $('#sheet');
  sheet._appt = appt;
  // Дата окончания не раньше даты начала
  $('#f-sdate', sheet).addEventListener('change', (e) => {
    const ed = $('#f-edate', sheet);
    if (ed.value < e.target.value) ed.value = e.target.value;
  });
}

async function saveForm(button) {
  const sheet = $('#sheet');
  const v = (id) => $(id, sheet).value.trim();
  const showError = (text) => { const el = $('#form-error', sheet); el.textContent = text; el.hidden = !text; if (text) el.scrollIntoView({ block: 'nearest' }); };

  if (!v('#f-client')) return showError('Укажите ФИО клиента.');
  if (!v('#f-brand')) return showError('Укажите марку автомобиля.');
  if (!v('#f-plate')) return showError('Укажите госномер.');
  const start = new Date(`${v('#f-sdate')}T${v('#f-stime') || '00:00'}`);
  const end = new Date(`${v('#f-edate')}T${v('#f-etime') || '00:00'}`);
  if (isNaN(start) || isNaN(end)) return showError('Укажите дату и время начала и окончания.');
  if (end <= start) return showError('Окончание должно быть позже начала.');

  const old = sheet._appt;
  const appt = {
    ...(old || {}),
    clientName: v('#f-client'), phone: v('#f-phone'), brand: v('#f-brand'), model: v('#f-model'),
    plate: normalizePlate(v('#f-plate')), liftNumber: Number(v('#f-lift')), status: v('#f-status'),
    start, end, responsible: v('#f-resp'), work: v('#f-work'),
  };

  button.disabled = true;
  button.textContent = 'Сохранение…';
  showError('');
  try {
    await withAuth(() => store.save(appt));
    closeSheet();
    toast(old ? 'Заявка сохранена' : 'Заявка создана');
  } catch (e) {
    showError(e.message || String(e));
    button.disabled = false;
    button.textContent = 'Сохранить';
  }
}

// ===== Настройки =====
function renderSettings() {
  setTitle('Настройки', 'Подключение и подъёмники');
  const signedIn = store.gw && store.gw.isSignedIn;
  const configuredInFile = !!(window.APP_CONFIG && window.APP_CONFIG.googleClientId);

  let google;
  if (isDemo) {
    google = `<p>Сейчас открыт демо-режим: примеры данных, Google не подключён. Изменения сохраняются только в этом браузере.</p>
      <a class="btn secondary" href="${location.pathname}">Выйти из демо-режима</a>`;
  } else if (!clientId()) {
    google = `<p>Чтобы телефон работал с тем же Google Календарём, что и программа на компьютере, нужен «Client ID» из Google Cloud.
      Его можно один раз вписать в файл <b>js/config.js</b> перед размещением приложения — или ввести здесь.</p>
      <div class="field full"><label for="client-id">Client ID</label><input id="client-id" placeholder="…apps.googleusercontent.com"></div>
      <button class="btn" style="margin-top:10px" data-action="save-client-id">Сохранить</button>
      <p class="muted" style="margin-top:14px">Или <a href="?demo">посмотрите демо-режим</a> с примерами.</p>`;
  } else if (!signedIn) {
    google = `<p>Войдите в тот же Google-аккаунт, к которому подключена программа на компьютере.</p>
      <button class="btn block" data-action="sign-in">Войти через Google</button>
      ${configuredInFile ? '' : '<button class="btn secondary small" style="margin-top:10px" data-action="reset-client-id">Изменить Client ID</button>'}`;
  } else {
    google = `<div class="stack">
      <div class="row"><span class="pill free"><span class="dot"></span>Вход выполнен</span><span class="spacer"></span>
        <button class="btn secondary small" data-action="sign-out">Выйти</button></div>
      <div class="field full"><label for="cal-select">Календарь с заявками</label>
        ${ui.calendars
          ? `<select id="cal-select" data-action="select-calendar"><option value="">— выберите —</option>${ui.calendars.map((c) =>
              `<option value="${esc(c.id)}" ${c.id === store.calendarId ? 'selected' : ''}>${esc(c.name)}${c.primary ? ' (основной)' : ''}</option>`).join('')}</select>`
          : `<button class="btn secondary" data-action="load-calendars">${store.calendarId ? esc(store.settings.calendarName || store.calendarId) + ' — изменить' : 'Выбрать календарь'}</button>`}
      </div>
      <p class="muted" style="margin:0">Выберите тот же календарь, что и в программе на компьютере, — тогда заявки будут общими.</p>
      <div class="row"><span class="muted">${esc(statusLine())}</span><span class="spacer"></span>
        <button class="btn small" data-action="refresh" ${store.calendarId ? '' : 'disabled'}>Обновить сейчас</button></div>
    </div>`;
  }

  $('#view').innerHTML = `<div class="settings">
    <section class="card"><h2>Google Календарь</h2>${google}</section>

    <section class="card"><h2>Подъёмники</h2>
      ${store.lifts.length ? `<ul class="lift-list">${store.lifts.map((l) => `<li><span>${l.number}.</span>${esc(l.name)}</li>`).join('')}</ul>` : '<p class="muted">Появятся после подключения к календарю.</p>'}
      <button class="btn secondary" data-action="add-lift" ${store.ready ? '' : 'disabled'}>+ Добавить подъёмник</button>
      <p class="muted" style="margin-bottom:0">Список общий для телефона и компьютера: он хранится в описании календаря Google.</p>
    </section>

    <section class="card"><h2>Как это работает</h2>
      <p>Телефон, программа на компьютере и Google Календарь показывают одни и те же заявки: изменения на любом из них появляются на остальных. Компьютер подхватывает их при синхронизации (по умолчанию раз в 5 минут).</p>
      <p>Заявку можно создать и прямо в Google Календаре — в описании события укажите подъёмник:</p>
      <pre class="example">Подъёмник: 2
Клиент: Иванов Иван
Госномер: А123ВС77
Работы: замена масла</pre>
      <p style="margin-top:14px"><b>На главный экран:</b> откройте меню браузера (⋮) и выберите «Добавить на главный экран» или «Установить приложение».</p>
      <p class="muted" style="margin-bottom:0">Версия ${VERSION}</p>
    </section>
  </div>`;
}

// ---------- Нижние панели ----------
function openSheet(html) {
  $('#sheet').innerHTML = `<div class="backdrop" data-action="backdrop"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').innerHTML = '';
  $('#sheet')._appt = null;
  document.body.style.overflow = '';
}

function promptLift() {
  openSheet(`
    <div class="grabber"></div>
    <div class="sheet-head"><h2>Новый подъёмник</h2><button class="icon-btn" data-action="close-sheet" aria-label="Закрыть">${ICONS.close}</button></div>
    <div class="sheet-body"><div class="field full"><label for="lift-name">Название</label>
      <input id="lift-name" value="Подъёмник ${Math.max(0, ...store.lifts.map((l) => l.number)) + 1}"></div></div>
    <div class="sheet-foot"><button class="btn secondary" data-action="close-sheet">Отмена</button><button class="btn" data-action="create-lift">Создать</button></div>`);
  setTimeout(() => $('#lift-name').select(), 50);
}

// ---------- Вход ----------
/** Выполнить действие; если вход в Google истёк — войти (по нажатию пользователя) и повторить. */
async function withAuth(action) {
  try {
    if (store.gw && !store.gw.isSignedIn) await store.gw.signIn();
    return await action();
  } catch (e) {
    if (e instanceof AuthRequiredError) {
      await store.gw.signIn();
      return action();
    }
    throw e;
  }
}

// ---------- Обработка нажатий ----------
document.addEventListener('click', async (e) => {
  const routeEl = e.target.closest('[data-route]');
  if (routeEl) { location.hash = routeEl.dataset.route; return; }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'backdrop' && e.target !== el) return;

  try {
    switch (action) {
      case 'backdrop':
      case 'close-sheet': closeSheet(); break;
      case 'open-lift': openLiftSheet(Number(el.dataset.lift)); break;
      case 'edit': {
        const a = store.appts.get(el.dataset.event);
        if (a) openForm(a);
        break;
      }
      case 'new': {
        if (!store.ready) { toast('Сначала подключите Google Календарь'); location.hash = 'settings'; return; }
        const liftNumber = Number(el.dataset.lift) || undefined;
        let start;
        if (el.dataset.date) {
          const [y, m, d] = el.dataset.date.split('-').map(Number);
          const day = new Date(y, m - 1, d);
          start = sameDay(day, new Date()) ? nextHalfHour(new Date()) : setHour(day, 9);
          if (start.getHours() >= WORK_END_HOUR) start = setHour(addDays(day, 1), 9);
        } else {
          const cur = liftNumber ? store.current(liftNumber) : null;
          start = nextHalfHour(cur ? cur.end : new Date());
        }
        openForm(null, { liftNumber, start });
        break;
      }
      case 'save': await saveForm(el); break;
      case 'delete': {
        const a = $('#sheet')._appt;
        if (a && confirm('Удалить эту заявку? Она удалится и из Google Календаря, и с компьютера.')) {
          await withAuth(() => store.remove(a));
          closeSheet();
          toast('Заявка удалена');
        }
        break;
      }
      case 'refresh': await withAuth(() => store.refresh()); break;
      case 'sign-in': await store.gw.signIn(); await store.refresh(); break;
      case 'sign-out': store.gw.signOut(); ui.calendars = null; render(); break;
      case 'save-client-id': {
        const id = $('#client-id').value.trim();
        if (!id.endsWith('.apps.googleusercontent.com')) { toast('Client ID должен заканчиваться на .apps.googleusercontent.com'); return; }
        localStorage.setItem(CLIENT_ID_KEY, id);
        store = new Store(makeGateway());
        store.addEventListener('change', () => render());
        render();
        break;
      }
      case 'reset-client-id': localStorage.removeItem(CLIENT_ID_KEY); render(); break;
      case 'load-calendars': ui.calendars = await withAuth(() => store.gw.listCalendars()); render(); break;
      case 'add-lift': if (store.ready) promptLift(); else toast('Сначала подключите Google Календарь'); break;
      case 'create-lift': {
        const name = $('#lift-name').value.trim();
        if (!name) return;
        el.disabled = true;
        await withAuth(() => store.addLift(name));
        closeSheet();
        toast(`Добавлен: ${name}`);
        break;
      }
      case 'cal-mode': ui.calMode = el.dataset.mode; localStorage.setItem('asc.calMode', ui.calMode); ui.ganttReset = true; render(); break;
      case 'cal-prev': shiftCal(-1); break;
      case 'cal-next': shiftCal(1); break;
      case 'cal-today': ui.calDate = startOfDay(new Date()); ui.ganttReset = true; render(); break;
    }
  } catch (err) {
    toast(err.message || String(err));
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.action === 'cal-date' && el.value) {
    const [y, m, d] = el.value.split('-').map(Number);
    ui.calDate = new Date(y, m - 1, d);
    render();
  }
  if (el.dataset.action === 'select-calendar' && el.value) {
    const cal = ui.calendars.find((c) => c.id === el.value);
    store.selectCalendar(cal);
    ui.calendars = null;
    await store.refresh();
    toast(`Календарь: ${cal.name}`);
  }
});

function shiftCal(dir) {
  const d = ui.calDate;
  ui.calDate = ui.calMode === 'month' ? new Date(d.getFullYear(), d.getMonth() + dir, 1)
    : addDays(d, ui.calMode === 'week' ? 7 * dir : dir);
  ui.ganttReset = true;
  render();
}

$('#refresh').addEventListener('click', async () => {
  try { await withAuth(() => store.refresh()); } catch (e) { toast(e.message); }
});

window.addEventListener('hashchange', () => { ui.route = location.hash.slice(1) || 'box'; closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener('resize', () => { if (ui.route === 'calendar' && ui.calMode !== 'day') render(); });

// Автообновление: при возвращении в приложение и раз в минуту, пока оно открыто
document.addEventListener('visibilitychange', () => { if (!document.hidden && store.ready && !$('#sheet').innerHTML) store.refresh(); });
setInterval(() => {
  if (!document.hidden && store.ready && !store.busy && !$('#sheet').innerHTML) store.refresh();
  else if (ui.route === 'box') render();   // часы и статусы подъёмников
}, 60e3);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

render();
if (store.ready) store.refresh();
