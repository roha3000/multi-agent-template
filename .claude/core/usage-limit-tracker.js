/**
 * Usage Limit Tracker for Claude Code Message Limits
 *
 * Tracks Claude Code's user-facing message limits:
 * - 5-hour rolling window (primary limit users hit)
 * - Daily limit
 * - Weekly limit
 *
 * @module usage-limit-tracker
 */

const fs = require('fs');
const path = require('path');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('UsageLimitTracker');

const DEFAULT_LIMITS = { fiveHour: 300, daily: 1500, weekly: 7000 };
const THRESHOLDS = { warning: 70, critical: 90 };

class UsageLimitTracker {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.dataFile = path.join(this.dataDir, 'usage-limits.json');

    this.limits = {
      fiveHour: options.fiveHourLimit || DEFAULT_LIMITS.fiveHour,
      daily: options.dailyLimit || DEFAULT_LIMITS.daily,
      weekly: options.weeklyLimit || DEFAULT_LIMITS.weekly
    };

    this.messageHistory = [];
    this.usage = {
      fiveHour: { count: 0, windowStart: new Date() },
      daily: { count: 0, dayStart: this._getStartOfDay() },
      weekly: { count: 0, weekStart: this._getStartOfWeek() }
    };

    this._loadState();
    this._checkWindowResets();
    logger.info('UsageLimitTracker initialized', { limits: this.limits });
  }

  recordMessage() {
    const now = new Date();
    this._checkWindowResets();

    this.usage.fiveHour.count++;
    this.usage.daily.count++;
    this.usage.weekly.count++;

    this.messageHistory.push(now.getTime());
    const oneHourAgo = now.getTime() - (60 * 60 * 1000);
    this.messageHistory = this.messageHistory.filter(ts => ts > oneHourAgo);

    this._saveState();
    return this.getStatus();
  }

  getStatus() {
    this._checkWindowResets();
    const now = new Date();
    return {
      fiveHour: this._getFiveHourStatus(now),
      daily: this._getDailyStatus(now),
      weekly: this._getWeeklyStatus(now),
      lastUpdated: now.toISOString()
    };
  }

  _getFiveHourStatus(now) {
    const windowMs = 5 * 60 * 60 * 1000;
    const resetAt = new Date(this.usage.fiveHour.windowStart.getTime() + windowMs);
    const used = this.usage.fiveHour.count;
    const limit = this.limits.fiveHour;
    const percent = Math.round((used / limit) * 100);

    return {
      used, limit, percent: Math.min(percent, 100),
      resetAt, resetIn: this._formatDuration(resetAt.getTime() - now.getTime()),
      pace: this.getPace()
    };
  }

  _getDailyStatus(now) {
    const resetAt = this._getEndOfDay();
    const used = this.usage.daily.count;
    const limit = this.limits.daily;
    const percent = Math.round((used / limit) * 100);

    return {
      used, limit, percent: Math.min(percent, 100),
      resetAt, resetIn: this._formatDuration(resetAt.getTime() - now.getTime()),
      projected: this.getProjection()
    };
  }

  _getWeeklyStatus(now) {
    const resetAt = this._getNextMonday();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const used = this.usage.weekly.count;
    const limit = this.limits.weekly;

    return {
      used, limit, percent: Math.min(Math.round((used / limit) * 100), 100),
      resetAt, resetDay: days[resetAt.getDay()]
    };
  }

  getPace() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const current = this.messageHistory.filter(ts => ts > oneHourAgo).length;

    const windowMs = 5 * 60 * 60 * 1000;
    const elapsed = now - this.usage.fiveHour.windowStart.getTime();
    const remaining = windowMs - elapsed;
    const remainingHours = remaining / (60 * 60 * 1000);
    const messagesRemaining = this.limits.fiveHour - this.usage.fiveHour.count;
    const safe = remainingHours > 0 ? Math.floor(messagesRemaining / remainingHours) : 0;

    let status = 'ok';
    if (current > safe * 1.5) status = 'critical';
    else if (current > safe) status = 'warning';

    return { current, safe: Math.max(0, safe), status };
  }

  getProjection() {
    const now = new Date();
    const endOfDay = this._getEndOfDay();
    const remainingHours = (endOfDay.getTime() - now.getTime()) / (60 * 60 * 1000);
    const pace = this.getPace();
    const projected = this.usage.daily.count + Math.round(pace.current * remainingHours);

    return {
      endOfDay: projected,
      percentOfLimit: Math.min(Math.round((projected / this.limits.daily) * 100), 200)
    };
  }

  isNearLimit(threshold = THRESHOLDS.warning) {
    const status = this.getStatus();
    return status.fiveHour.percent >= threshold ||
           status.daily.percent >= threshold ||
           status.weekly.percent >= threshold;
  }

  getAlerts() {
    const status = this.getStatus();
    const alerts = [];

    const windows = [
      { key: 'fiveHour', name: '5-hour window', data: status.fiveHour },
      { key: 'daily', name: 'daily limit', data: status.daily },
      { key: 'weekly', name: 'weekly limit', data: status.weekly }
    ];

    for (const w of windows) {
      if (w.data.percent >= THRESHOLDS.critical) {
        alerts.push({ window: w.key, severity: 'critical', message: `${w.name} at ${w.data.percent}%`, percent: w.data.percent });
      } else if (w.data.percent >= THRESHOLDS.warning) {
        alerts.push({ window: w.key, severity: 'warning', message: `${w.name} at ${w.data.percent}%`, percent: w.data.percent });
      }
    }

    if (status.fiveHour.pace.status === 'critical') {
      alerts.push({ window: 'fiveHour', severity: 'critical', message: `Rate too high: ${status.fiveHour.pace.current}/hr` });
    }

    return alerts;
  }

  reset(window = 'all') {
    const now = new Date();
    if (window === 'fiveHour' || window === 'all') {
      this.usage.fiveHour = { count: 0, windowStart: now };
    }
    if (window === 'daily' || window === 'all') {
      this.usage.daily = { count: 0, dayStart: this._getStartOfDay() };
    }
    if (window === 'weekly' || window === 'all') {
      this.usage.weekly = { count: 0, weekStart: this._getStartOfWeek() };
    }
    if (window === 'all') this.messageHistory = [];
    this._saveState();
  }

  setLimits(fiveHour, daily, weekly) {
    this.limits = {
      fiveHour: fiveHour || this.limits.fiveHour,
      daily: daily || this.limits.daily,
      weekly: weekly || this.limits.weekly
    };
    this._saveState();
  }

  _checkWindowResets() {
    const now = new Date();
    const fiveHourMs = 5 * 60 * 60 * 1000;

    if (now.getTime() - this.usage.fiveHour.windowStart.getTime() >= fiveHourMs) {
      this.usage.fiveHour = { count: 0, windowStart: now };
    }

    const startOfToday = this._getStartOfDay();
    if (this.usage.daily.dayStart.getTime() < startOfToday.getTime()) {
      this.usage.daily = { count: 0, dayStart: startOfToday };
    }

    const startOfWeek = this._getStartOfWeek();
    if (this.usage.weekly.weekStart.getTime() < startOfWeek.getTime()) {
      this.usage.weekly = { count: 0, weekStart: startOfWeek };
    }
  }

  _getStartOfDay() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  _getEndOfDay() {
    const start = this._getStartOfDay();
    return new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }

  _getStartOfWeek() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(now.getFullYear(), now.getMonth(), diff);
  }

  _getNextMonday() {
    const start = this._getStartOfWeek();
    return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  _formatDuration(ms) {
    if (ms < 0) return '0m';
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  _saveState() {
    try {
      if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
      const state = {
        limits: this.limits,
        usage: {
          fiveHour: { count: this.usage.fiveHour.count, windowStart: this.usage.fiveHour.windowStart.toISOString() },
          daily: { count: this.usage.daily.count, dayStart: this.usage.daily.dayStart.toISOString() },
          weekly: { count: this.usage.weekly.count, weekStart: this.usage.weekly.weekStart.toISOString() }
        },
        messageHistory: this.messageHistory,
        savedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.dataFile, JSON.stringify(state, null, 2));
    } catch (error) {
      logger.error('Failed to save state', { error: error.message });
    }
  }

  _loadState() {
    try {
      if (fs.existsSync(this.dataFile)) {
        const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        if (data.limits) this.limits = { ...this.limits, ...data.limits };
        if (data.usage) {
          if (data.usage.fiveHour) {
            this.usage.fiveHour = { count: data.usage.fiveHour.count || 0, windowStart: new Date(data.usage.fiveHour.windowStart) };
          }
          if (data.usage.daily) {
            this.usage.daily = { count: data.usage.daily.count || 0, dayStart: new Date(data.usage.daily.dayStart) };
          }
          if (data.usage.weekly) {
            this.usage.weekly = { count: data.usage.weekly.count || 0, weekStart: new Date(data.usage.weekly.weekStart) };
          }
        }
        if (data.messageHistory) this.messageHistory = data.messageHistory;
      }
    } catch (error) {
      logger.error('Failed to load state', { error: error.message });
    }
  }
}

let instance = null;

function getUsageLimitTracker(options) {
  if (!instance) instance = new UsageLimitTracker(options);
  return instance;
}

function resetInstance() {
  instance = null;
}

module.exports = { UsageLimitTracker, getUsageLimitTracker, resetInstance, DEFAULT_LIMITS, THRESHOLDS };
