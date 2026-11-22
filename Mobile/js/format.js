// Формат событий Google Календаря — тот же, что у программы на компьютере
// (Sync/EventFormat.cs и Sync/LiftsBlock.cs). Если меняете здесь — меняйте и там.

export const STATUSES = [
  { value: 'Planned', title: 'Запланировано' },
  { value: 'InProgress', title: 'В работе' },
  { value: 'Done', title: 'Завершено' },
];
const STATUS_COLORS = { Planned: '9', InProgress: '5', Done: '8' };
export const statusTitle = (s) => (STATUSES.find((x) => x.value === s) || STATUSES[0]).title;

export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 20;

const FIELD_LINE = /^(подъ[её]мник|клиент|телефон|автомобиль|авто|машина|госномер|ответственный|мастер|статус|работы|описание)\s*:\s*(.*)$/i;
const LIFT_MENTION = /подъемник\p{L}*\s*(?:№|#|n|-)?\s*(\d+)/u;
const LIFT_ONLY_LINE = /^(на\s+)?подъемник\p{L}*\s*(?:№|#|n|-)?\s*\d+[.!]?$/u;
const PLATE = /(?:^|[^\p{L}\d])([АВЕКМНОРСТУХABEKMHOPCTYX]\s?\d{3}\s?[АВЕКМНОРСТУХABEKMHOPCTYX]{2}\s?\d{2,3})(?![\p{L}\d])/u;

export const normalize = (s) => (s || '').trim().toLowerCase().replaceAll('ё', 'е');
export const normalizePlate = (s) => (s || '').trim().toUpperCase().replaceAll(' ', '');
export const newSyncId = () => crypto.randomUUID().replaceAll('-', '');

/** HTML из веб-версии Google → обычный текст. */
export function plainText(html) {
  if (!html) return '';
  let text = html.replace(/<\s*(br|\/p|\/div|\/li)\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '');
  const ta = document.createElement('textarea');
  ta.innerHTML = text;
  return ta.value.replaceAll('\r', '').replaceAll(' ', ' ');
}

/** Подъёмник: поле «Подъёмник: …», затем «подъёмник 2» в описании/названии, затем название целиком. */
export function findLift(liftField, summary, description, lifts) {
  if (liftField && liftField.trim()) {
    const field = normalize(liftField);
    const byName = lifts.find((l) => normalize(l.name) === field);
    if (byName) return byName;
    const digits = field.match(/\d+/);
    if (digits) {
      const byNumber = lifts.find((l) => l.number === Number(digits[0]));
      if (byNumber) return byNumber;
    }
  }
  for (const text of [description, summary]) {
    const m = normalize(text).match(LIFT_MENTION);
    if (m) {
      const byNumber = lifts.find((l) => l.number === Number(m[1]));
      if (byNumber) return byNumber;
    }
  }
  for (const text of [description, summary]) {
    const n = normalize(text);
    const byName = [...lifts]
      .filter((l) => l.name.length >= 3)
      .sort((a, b) => b.name.length - a.name.length)
      .find((l) => n.includes(normalize(l.name)));
    if (byName) return byName;
  }
  return null;
}

function parseStatus(value) {
  const v = normalize(value);
  if (v.includes('работ')) return 'InProgress';
  if (v.includes('заверш') || v.includes('готов')) return 'Done';
  if (v.includes('заплан')) return 'Planned';
  return null;
}

function readTimes(ev) {
  if (ev.start && ev.start.date) {
    const s = parseDateOnly(ev.start.date);
    const e = ev.end && ev.end.date ? parseDateOnly(ev.end.date) : addDays(s, 1);
    return { start: setHour(s, 8), end: setHour(addDays(e, -1), 20) };
  }
  const start = new Date(ev.start && ev.start.dateTime);
  const end = ev.end && ev.end.dateTime ? new Date(ev.end.dateTime) : new Date(start.getTime() + 3600e3);
  return { start, end };
}

/** Событие Google → заявка (или null, если подъёмник не указан). */
export function parseEvent(ev, lifts) {
  if (!ev || ev.status === 'cancelled') return null;
  const summary = ev.summary || '';
  const description = plainText(ev.description || '');
  const f = {};
  let liftField = null;
  const free = [];

  for (const raw of description.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('— создано в')) continue;
    const m = line.match(FIELD_LINE);
    if (!m) {
      if (!LIFT_ONLY_LINE.test(normalize(line))) free.push(line);
      continue;
    }
    const key = normalize(m[1]);
    const value = m[2].trim();
    if (!value) continue;
    if (key === 'подъемник') liftField = value;
    else if (key === 'клиент') f.clientName = value;
    else if (key === 'телефон') f.phone = value;
    else if (['автомобиль', 'авто', 'машина'].includes(key)) {
      const i = value.indexOf(' ');
      f.brand = i < 0 ? value : value.slice(0, i);
      f.model = i < 0 ? '' : value.slice(i + 1).trim();
    } else if (key === 'госномер') f.plate = value;
    else if (key === 'ответственный' || key === 'мастер') f.responsible = value;
    else if (key === 'статус') f.status = parseStatus(value);
    else if (key === 'работы' || key === 'описание') f.work = value;
  }

  const lift = findLift(liftField, summary, description, lifts);
  if (!lift) return null;
  const { start, end } = readTimes(ev);
  if (isNaN(start) || isNaN(end)) return null;

  const plateMatch = (summary + '\n' + description).toUpperCase().match(PLATE);
  const freeText = free.join('\n').trim();
  const syncId = (ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private.autoserviceId) || '';

  return {
    eventId: ev.id,
    syncId,
    liftNumber: lift.number,
    start,
    end,
    clientName: f.clientName || summary || 'Без имени',
    phone: f.phone || '',
    brand: f.brand || '',
    model: f.model || '',
    plate: normalizePlate(f.plate || (plateMatch ? plateMatch[1] : '')),
    responsible: f.responsible || '',
    work: f.work || freeText || summary,
    status: f.status || 'Planned',
    updated: ev.updated || '',
  };
}

/** Заявка → ресурс события Google. */
export function toEvent(a, liftName) {
  const carTitle = `${a.brand || ''} ${a.model || ''}`.trim();
  const summary = [a.plate, carTitle, a.clientName].filter((s) => s && s.trim()).join(' · ');
  const lines = [`Подъёмник: ${liftName}`];
  const add = (k, v) => { if (v && String(v).trim()) lines.push(`${k}: ${String(v).trim()}`); };
  add('Клиент', a.clientName);
  add('Телефон', a.phone);
  add('Автомобиль', carTitle);
  add('Госномер', a.plate);
  add('Ответственный', a.responsible);
  add('Статус', statusTitle(a.status));
  add('Работы', a.work);
  lines.push('', '— создано в АвтоСервис CRM');

  return {
    summary: summary || 'Заявка',
    description: lines.join('\n'),
    start: { dateTime: toLocalIso(a.start) },
    end: { dateTime: toLocalIso(a.end) },
    colorId: STATUS_COLORS[a.status] || '9',
    extendedProperties: { private: { autoserviceId: a.syncId } },
  };
}

// ---- Список подъёмников в описании календаря ----
export const LIFTS_BEGIN = '[АвтоСервис CRM: подъёмники]';
export const LIFTS_END = '[/АвтоСервис CRM]';

export function parseLifts(description) {
  const d = description || '';
  const start = d.indexOf(LIFTS_BEGIN);
  if (start < 0) return [];
  const end = d.indexOf(LIFTS_END, start);
  const body = end < 0 ? d.slice(start + LIFTS_BEGIN.length) : d.slice(start + LIFTS_BEGIN.length, end);
  const result = [];
  for (const line of body.split('\n')) {
    const m = line.trim().match(/^(\d+)\s*[.)]\s*(.+)$/);
    if (m && !result.some((r) => r.number === Number(m[1]))) result.push({ number: Number(m[1]), name: m[2].trim() });
  }
  return result.sort((a, b) => a.number - b.number);
}

export function writeLifts(description, lifts) {
  const d = description || '';
  const block = [LIFTS_BEGIN, ...[...lifts].sort((a, b) => a.number - b.number).map((l) => `${l.number}. ${l.name}`), LIFTS_END].join('\n');
  const start = d.indexOf(LIFTS_BEGIN);
  if (start < 0) return d.length === 0 ? block : d.trimEnd() + '\n\n' + block;
  const end = d.indexOf(LIFTS_END, start);
  const after = end < 0 ? '' : d.slice(end + LIFTS_END.length);
  return d.slice(0, start) + block + after;
}

export const DEFAULT_LIFTS = [1, 2, 3, 4].map((n) => ({ number: n, name: `Подъёмник ${n}` }));

// ---- Даты ----
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function setHour(d, h, m = 0) { const x = new Date(d); x.setHours(h, m, 0, 0); return x; }
function parseDateOnly(s) { const [y, mo, d] = s.split('-').map(Number); return new Date(y, mo - 1, d); }

/** 2026-11-23T09:00:00+03:00 — локальное время с часовым поясом. */
export function toLocalIso(d) {
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00` +
    `${sign}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}
