// Демо-режим (?demo): календарь-имитация с примерами, без входа в Google.
// Нужен, чтобы посмотреть приложение; данные живут только в этом браузере.
import { DEFAULT_LIFTS, toEvent, writeLifts, newSyncId, addDays, setHour, startOfDay } from './format.js';

const KEY = 'asc.demo';

export class DemoGateway {
  constructor() {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    this.data = saved || DemoGateway.sample();
    this.save();
  }

  get isSignedIn() { return true; }
  async signIn() {}
  signOut() { localStorage.removeItem(KEY); }

  save() { localStorage.setItem(KEY, JSON.stringify(this.data)); }

  static sample() {
    const now = new Date();
    const today = startOfDay(now);
    const lifts = DEFAULT_LIFTS;
    const name = (n) => lifts.find((l) => l.number === n).name;
    const mk = (lift, start, end, extra) => {
      const a = { syncId: newSyncId(), start, end, status: 'Planned', phone: '', model: '', responsible: '', ...extra };
      return { id: 'demo' + Math.random().toString(36).slice(2, 10), updated: new Date().toISOString(), ...toEvent(a, name(lift)) };
    };
    const at = (d, h) => setHour(d, Math.floor(h), Math.round((h % 1) * 60));
    const nowH = now.getHours() + now.getMinutes() / 60;
    const events = [
      mk(1, new Date(now.getTime() - 3600e3), new Date(now.getTime() + 3600e3), { clientName: 'Иванов Сергей', phone: '+7 916 123-45-67', brand: 'Toyota', model: 'Camry', plate: 'А123ВС77', work: 'Замена масла и фильтров', responsible: 'Алексей', status: 'InProgress' }),
      mk(3, new Date(now.getTime() - 1800e3), addDays(at(today, 18), 1), { clientName: 'Смирнова Анна', phone: '+7 903 555-12-34', brand: 'Kia', model: 'Rio', plate: 'К456МН199', work: 'Ремонт подвески', responsible: 'Олег', status: 'InProgress' }),
      mk(2, at(today, Math.min(nowH + 2, 18)), at(today, Math.min(nowH + 3, 19)), { clientName: 'Петров Олег', brand: 'Lada', model: 'Vesta', plate: 'Е777КХ50', work: 'Шиномонтаж' }),
      mk(4, at(addDays(today, 2), 9), at(addDays(today, 5), 18), { clientName: 'Морозов Кирилл', brand: 'Mercedes', model: 'E200', plate: 'Р777РР77', work: 'Капитальный ремонт двигателя', responsible: 'Алексей' }),
      mk(2, at(addDays(today, 1), 10), at(addDays(today, 1), 12), { clientName: 'Соколов Игорь', brand: 'Hyundai', model: 'Solaris', plate: 'О555ОО77', work: 'Диагностика' }),
      mk(1, at(addDays(today, -3), 9), at(addDays(today, -2), 17), { clientName: 'Фёдоров Иван', brand: 'Ford', model: 'Focus', plate: 'Н100НН50', work: 'Замена сцепления', status: 'Done' }),
    ];
    return { description: writeLifts('', lifts), events };
  }

  async listCalendars() { return [{ id: 'demo', name: 'Демо-календарь', primary: true }]; }
  async getCalendarDescription() { return this.data.description; }
  async setCalendarDescription(_, description) { this.data.description = description; this.save(); }

  async listEvents(_, timeMin, timeMax) {
    return this.data.events.filter((e) => new Date(e.end.dateTime) > timeMin && new Date(e.start.dateTime) < timeMax);
  }

  async insertEvent(_, ev) {
    const created = { ...ev, id: 'demo' + Math.random().toString(36).slice(2, 10), updated: new Date().toISOString() };
    this.data.events.push(created);
    this.save();
    return created;
  }

  async patchEvent(_, id, ev) {
    const i = this.data.events.findIndex((e) => e.id === id);
    if (i < 0) { const err = new Error('Не найдено'); err.status = 404; throw err; }
    this.data.events[i] = { ...this.data.events[i], ...ev, updated: new Date().toISOString() };
    this.save();
    return this.data.events[i];
  }

  async deleteEvent(_, id) {
    this.data.events = this.data.events.filter((e) => e.id !== id);
    this.save();
  }
}
