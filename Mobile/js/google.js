// Вход через Google (Google Identity Services) и Google Calendar API.
// Телефон работает прямо с календарём — он и есть общая «база» для компьютера и телефона.

const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TOKEN_KEY = 'asc.token';

export class AuthRequiredError extends Error {
  constructor() { super('Нужно войти в Google'); }
}

let tokenClient = null;
let gisLoading = null;

function loadGis() {
  if (window.google && window.google.accounts) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { gisLoading = null; reject(new Error('Не удалось загрузить вход Google — проверьте интернет')); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

function savedToken() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
    if (t && t.expiresAt > Date.now() + 60e3) return t;
  } catch { /* нет сохранённого входа */ }
  return null;
}

export class GoogleGateway {
  constructor(clientId) {
    this.clientId = clientId;
    this.token = savedToken();
  }

  get isSignedIn() { return !!this.token && this.token.expiresAt > Date.now() + 30e3; }
  get hadSession() { return localStorage.getItem(TOKEN_KEY) !== null; }

  /** Вход. Вызывать из обработчика нажатия — иначе браузер заблокирует окно Google. */
  async signIn(forceConsent = false) {
    await loadGis();
    return new Promise((resolve, reject) => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
          this.token = { accessToken: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
          localStorage.setItem(TOKEN_KEY, JSON.stringify(this.token));
          resolve();
        },
        error_callback: (err) => reject(new Error(err && err.type === 'popup_closed' ? 'Окно входа закрыто' : 'Вход не выполнен')),
      });
      tokenClient.requestAccessToken({ prompt: forceConsent || !this.hadSession ? 'consent' : '' });
    });
  }

  signOut() {
    if (this.token && window.google && window.google.accounts) {
      window.google.accounts.oauth2.revoke(this.token.accessToken, () => {});
    }
    this.token = null;
    localStorage.removeItem(TOKEN_KEY);
  }

  async request(method, path, body, query) {
    if (!this.isSignedIn) throw new AuthRequiredError();
    const url = new URL(API + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const resp = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${this.token.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (resp.status === 401) { this.token = null; throw new AuthRequiredError(); }
    if (resp.status === 204) return null;
    if (!resp.ok) {
      let message = `Ошибка Google ${resp.status}`;
      try { message = (await resp.json()).error.message || message; } catch { /* оставляем код */ }
      const err = new Error(message);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  }

  async listCalendars() {
    const data = await this.request('GET', '/users/me/calendarList', null, { minAccessRole: 'writer' });
    return (data.items || [])
      .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary }))
      .sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name, 'ru'));
  }

  async getCalendarDescription(calendarId) {
    const c = await this.request('GET', `/calendars/${encodeURIComponent(calendarId)}`);
    return c.description || '';
  }

  setCalendarDescription(calendarId, description) {
    return this.request('PATCH', `/calendars/${encodeURIComponent(calendarId)}`, { description });
  }

  async listEvents(calendarId, timeMin, timeMax) {
    const items = [];
    let pageToken;
    do {
      const data = await this.request('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, null, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: 'true',
        maxResults: '2500',
        pageToken,
      });
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }

  insertEvent(calendarId, ev) {
    return this.request('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, ev);
  }

  patchEvent(calendarId, eventId, ev) {
    return this.request('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, ev);
  }

  async deleteEvent(calendarId, eventId) {
    try {
      await this.request('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (e) {
      if (e.status !== 404 && e.status !== 410) throw e;   // уже удалено
    }
  }
}
