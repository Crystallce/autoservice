// Данные телефона. Источник правды — Google Календарь (через него же синхронизируется компьютер),
// здесь только копия для быстрого запуска и работы с экранами.
import {
  parseEvent, toEvent, parseLifts, writeLifts, newSyncId, DEFAULT_LIFTS, addDays, startOfDay,
} from './format.js';
import { AuthRequiredError } from './google.js';

const SETTINGS_KEY = 'asc.settings';
const CACHE_KEY = 'asc.cache';

export class Store extends EventTarget {
  constructor(gateway, { demo = false } = {}) {
    super();
    this.gw = gateway;
    this.demo = demo;
    this.settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (demo) this.settings = { calendarId: 'demo', calendarName: 'Демо-календарь' };
    this.lifts = [];
    this.appts = new Map();      // eventId → заявка
    this.busy = false;
    this.error = '';
    this.needsAuth = false;
    this.lastSync = null;
    this.duplicates = 0;
    this.restoreCache();
  }

  emit() { this.dispatchEvent(new Event('change')); }

  get calendarId() { return this.settings.calendarId; }
  get ready() { return !!this.calendarId && this.gw && this.gw.isSignedIn; }

  saveSettings() { if (!this.demo) localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); }

  // ---------- кэш ----------
  restoreCache() {
    if (this.demo) return;
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c || c.calendarId !== this.calendarId) return;
      this.lifts = c.lifts || [];
      for (const a of c.appts || []) this.appts.set(a.eventId, { ...a, start: new Date(a.start), end: new Date(a.end) });
      this.lastSync = c.lastSync ? new Date(c.lastSync) : null;
    } catch { /* кэш повреждён — загрузим заново */ }
  }

  saveCache() {
    if (this.demo) return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      calendarId: this.calendarId,
      lifts: this.lifts,
      appts: [...this.appts.values()],
      lastSync: this.lastSync,
    }));
  }

  // ---------- загрузка ----------
  async refreshLifts() {
    const description = await this.gw.getCalendarDescription(this.calendarId);
    let lifts = parseLifts(description);
    if (lifts.length === 0) {
      // Календарь ещё не использовался — заводим подъёмники по умолчанию (компьютер добавит свои)
      lifts = DEFAULT_LIFTS;
      await this.gw.setCalendarDescription(this.calendarId, writeLifts(description, lifts));
    }
    this.lifts = lifts;
  }

  async loadRange(from, to) {
    const events = await this.gw.listEvents(this.calendarId, from, to);
    for (const [id, a] of this.appts) if (a.start < to && a.end > from) this.appts.delete(id);

    // Защита от дублей: одна заявка (один id) — одна запись, берём самую свежую
    const bySync = new Map();
    let duplicates = 0;
    for (const ev of events) {
      const a = parseEvent(ev, this.lifts);
      if (!a) continue;
      if (a.syncId) {
        const prev = bySync.get(a.syncId);
        if (prev) {
          duplicates++;
          if (prev.updated >= a.updated) continue;
          this.appts.delete(prev.eventId);
        }
        bySync.set(a.syncId, a);
      }
      this.appts.set(a.eventId, a);
    }
    this.duplicates = duplicates;
  }

  /** Обновить подъёмники и заявки за период (по умолчанию — месяц назад и два вперёд). */
  async refresh(from, to) {
    if (!this.calendarId || !this.gw) return;
    const today = startOfDay(new Date());
    from = from || addDays(today, -31);
    to = to || addDays(today, 62);
    this.busy = true;
    this.emit();
    try {
      await this.refreshLifts();
      await this.loadRange(from, to);
      this.lastSync = new Date();
      this.error = '';
      this.needsAuth = false;
      this.saveCache();
    } catch (e) {
      if (e instanceof AuthRequiredError) this.needsAuth = true;
      else this.error = e.message || String(e);
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  // ---------- выборки ----------
  liftName(number) { return (this.lifts.find((l) => l.number === number) || {}).name || `Подъёмник ${number}`; }

  inRange(from, to) {
    return [...this.appts.values()].filter((a) => a.start < to && a.end > from).sort((a, b) => a.start - b.start);
  }

  current(liftNumber, now = new Date()) {
    return [...this.appts.values()].find((a) => a.liftNumber === liftNumber && a.start <= now && a.end > now && a.status !== 'Done') || null;
  }

  // ---------- изменения ----------
  /** Проверяем по свежим данным из Google, не занят ли подъёмник (там могли записать с компьютера). */
  async findOverlap(a) {
    const events = await this.gw.listEvents(this.calendarId, a.start, a.end);
    return events
      .map((ev) => parseEvent(ev, this.lifts))
      .find((x) => x && x.liftNumber === a.liftNumber && x.eventId !== a.eventId &&
        !(a.syncId && x.syncId === a.syncId) && x.start < a.end && x.end > a.start) || null;
  }

  async save(a) {
    const overlap = await this.findOverlap(a);
    if (overlap) {
      const t = (d) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      throw new Error(`${this.liftName(a.liftNumber)} в это время занят: ${overlap.plate || overlap.clientName}, ${t(overlap.start)}–${t(overlap.end)}`);
    }
    const ev = toEvent({ ...a, syncId: a.syncId || newSyncId() }, this.liftName(a.liftNumber));
    let saved;
    if (a.eventId) {
      try {
        saved = await this.gw.patchEvent(this.calendarId, a.eventId, ev);
      } catch (e) {
        if (e.status !== 404 && e.status !== 410) throw e;
        saved = await this.gw.insertEvent(this.calendarId, ev);   // событие удалили — создаём заново
        this.appts.delete(a.eventId);
      }
    } else {
      saved = await this.gw.insertEvent(this.calendarId, ev);
    }
    const parsed = parseEvent(saved, this.lifts);
    if (parsed) this.appts.set(parsed.eventId, parsed);
    this.saveCache();
    this.emit();
  }

  async remove(a) {
    await this.gw.deleteEvent(this.calendarId, a.eventId);
    this.appts.delete(a.eventId);
    this.saveCache();
    this.emit();
  }

  async addLift(name) {
    const description = await this.gw.getCalendarDescription(this.calendarId);
    const lifts = parseLifts(description);
    const base = lifts.length ? lifts : (this.lifts.length ? this.lifts : DEFAULT_LIFTS);
    const number = Math.max(0, ...base.map((l) => l.number)) + 1;
    const next = [...base, { number, name: name.trim() }];
    await this.gw.setCalendarDescription(this.calendarId, writeLifts(description, next));
    this.lifts = next;
    this.saveCache();
    this.emit();
  }

  selectCalendar(cal) {
    this.settings.calendarId = cal.id;
    this.settings.calendarName = cal.name;
    this.saveSettings();
    this.appts.clear();
    this.lifts = [];
    this.lastSync = null;
    localStorage.removeItem(CACHE_KEY);
    this.emit();
  }
}
