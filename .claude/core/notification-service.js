/**
 * Notification Service
 *
 * Unified notification system for SMS (Twilio) and Email (SendGrid) alerts.
 * Supports phase completion notifications, context threshold alerts, and
 * configurable notification preferences.
 *
 * @module notification-service
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

// Lazy-load external dependencies to avoid errors when not configured
let twilio = null;
let sgMail = null;

/**
 * @typedef {Object} NotificationPreferences
 * @property {boolean} enabled - Master enable/disable switch
 * @property {Object} channels - Channel-specific settings
 * @property {Object} channels.sms - SMS settings
 * @property {boolean} channels.sms.enabled - Whether SMS is enabled
 * @property {string} channels.sms.phoneNumber - Recipient phone number
 * @property {Object} channels.email - Email settings
 * @property {boolean} channels.email.enabled - Whether email is enabled
 * @property {string} channels.email.address - Recipient email address
 * @property {Object} alerts - Alert type settings
 * @property {Object} alerts.contextThreshold - Context threshold alert settings
 * @property {boolean} alerts.contextThreshold.enabled - Whether context alerts are enabled
 * @property {number[]} alerts.contextThreshold.levels - Alert levels (e.g., [70, 85, 95])
 * @property {Object} alerts.phaseCompletion - Phase completion alert settings
 * @property {boolean} alerts.phaseCompletion.enabled - Whether phase alerts are enabled
 * @property {Object} alerts.taskGroupCompletion - Task group completion alert settings
 * @property {boolean} alerts.taskGroupCompletion.enabled - Whether task group alerts are enabled
 * @property {Object} quietHours - Quiet hours settings
 * @property {boolean} quietHours.enabled - Whether quiet hours are enabled
 * @property {string} quietHours.start - Start time (HH:MM format)
 * @property {string} quietHours.end - End time (HH:MM format)
 */

const DEFAULT_PREFERENCES = {
  enabled: false,
  channels: {
    sms: {
      enabled: false,
      phoneNumber: '',
    },
    email: {
      enabled: false,
      address: '',
    },
  },
  alerts: {
    contextThreshold: {
      enabled: true,
      levels: [70, 85, 95],
    },
    phaseCompletion: {
      enabled: true,
    },
    taskGroupCompletion: {
      enabled: true,
    },
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
};

class NotificationService extends EventEmitter {
  /**
   * @param {Object} options - Configuration options
   * @param {string} options.preferencesPath - Path to preferences JSON file
   * @param {Object} options.twilioConfig - Twilio configuration
   * @param {string} options.twilioConfig.accountSid - Twilio account SID
   * @param {string} options.twilioConfig.authToken - Twilio auth token
   * @param {string} options.twilioConfig.fromNumber - Twilio sender number
   * @param {Object} options.sendgridConfig - SendGrid configuration
   * @param {string} options.sendgridConfig.apiKey - SendGrid API key
   * @param {string} options.sendgridConfig.fromEmail - Sender email address
   * @param {string} options.sendgridConfig.fromName - Sender name
   */
  constructor(options = {}) {
    super();

    this.preferencesPath = options.preferencesPath ||
      path.join(__dirname, '..', 'data', 'notification-preferences.json');

    // Twilio configuration from options or environment
    this.twilioConfig = {
      accountSid: options.twilioConfig?.accountSid || process.env.TWILIO_ACCOUNT_SID,
      authToken: options.twilioConfig?.authToken || process.env.TWILIO_AUTH_TOKEN,
      fromNumber: options.twilioConfig?.fromNumber || process.env.TWILIO_FROM_NUMBER,
    };

    // SendGrid configuration from options or environment
    this.sendgridConfig = {
      apiKey: options.sendgridConfig?.apiKey || process.env.SENDGRID_API_KEY,
      fromEmail: options.sendgridConfig?.fromEmail || process.env.SENDGRID_FROM_EMAIL || 'alerts@multi-agent.local',
      fromName: options.sendgridConfig?.fromName || process.env.SENDGRID_FROM_NAME || 'Multi-Agent System',
    };

    // Load preferences
    this.preferences = this._loadPreferences();

    // Initialize clients lazily
    this.twilioClient = null;
    this.sendgridClient = null;

    // Track sent alerts to prevent duplicates
    this.sentAlerts = new Map();
    this.alertCooldown = 5 * 60 * 1000; // 5 minutes cooldown

    // Statistics
    this.stats = {
      smsSent: 0,
      emailsSent: 0,
      alertsTriggered: 0,
      alertsSuppressed: 0,
      errors: 0,
    };
  }

  /**
   * Initialize the notification service
   * @returns {Promise<Object>} Initialization status
   */
  async initialize() {
    const status = {
      sms: { available: false, error: null },
      email: { available: false, error: null },
    };

    // Initialize Twilio
    if (this.twilioConfig.accountSid && this.twilioConfig.authToken) {
      try {
        if (!twilio) {
          twilio = require('twilio');
        }
        this.twilioClient = twilio(
          this.twilioConfig.accountSid,
          this.twilioConfig.authToken
        );
        status.sms.available = true;
        this.emit('initialized:sms');
      } catch (err) {
        status.sms.error = err.message;
        this.emit('error', { channel: 'sms', error: err });
      }
    } else {
      status.sms.error = 'Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN';
    }

    // Initialize SendGrid
    if (this.sendgridConfig.apiKey) {
      try {
        if (!sgMail) {
          sgMail = require('@sendgrid/mail');
        }
        sgMail.setApiKey(this.sendgridConfig.apiKey);
        this.sendgridClient = sgMail;
        status.email.available = true;
        this.emit('initialized:email');
      } catch (err) {
        status.email.error = err.message;
        this.emit('error', { channel: 'email', error: err });
      }
    } else {
      status.email.error = 'Missing SENDGRID_API_KEY';
    }

    this.emit('initialized', status);
    return status;
  }

  /**
   * Load preferences from file
   * @returns {NotificationPreferences}
   * @private
   */
  _loadPreferences() {
    try {
      if (fs.existsSync(this.preferencesPath)) {
        const content = fs.readFileSync(this.preferencesPath, 'utf-8');
        const loaded = JSON.parse(content);
        // Merge with defaults to ensure all fields exist
        return this._mergeDeep(DEFAULT_PREFERENCES, loaded);
      }
    } catch (err) {
      this.emit('error', { type: 'preferences-load', error: err });
    }
    return { ...DEFAULT_PREFERENCES };
  }

  /**
   * Save preferences to file
   * @param {Partial<NotificationPreferences>} updates - Preference updates
   * @returns {NotificationPreferences}
   */
  savePreferences(updates = {}) {
    this.preferences = this._mergeDeep(this.preferences, updates);

    try {
      const dir = path.dirname(this.preferencesPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this.preferencesPath,
        JSON.stringify(this.preferences, null, 2)
      );
      this.emit('preferences:saved', this.preferences);
    } catch (err) {
      this.emit('error', { type: 'preferences-save', error: err });
    }

    return this.preferences;
  }

  /**
   * Get current preferences
   * @returns {NotificationPreferences}
   */
  getPreferences() {
    return { ...this.preferences };
  }

  /**
   * Deep merge two objects
   * @private
   */
  _mergeDeep(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this._mergeDeep(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  /**
   * Check if currently in quiet hours
   * @returns {boolean}
   */
  isQuietHours() {
    if (!this.preferences.quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [startHour, startMin] = this.preferences.quietHours.start.split(':').map(Number);
    const [endHour, endMin] = this.preferences.quietHours.end.split(':').map(Number);

    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  /**
   * Check if an alert should be sent (not in cooldown)
   * @param {string} alertKey - Unique key for the alert
   * @returns {boolean}
   */
  _shouldSendAlert(alertKey) {
    const lastSent = this.sentAlerts.get(alertKey);
    if (lastSent && (Date.now() - lastSent) < this.alertCooldown) {
      return false;
    }
    return true;
  }

  /**
   * Record that an alert was sent
   * @param {string} alertKey - Unique key for the alert
   */
  _recordAlertSent(alertKey) {
    this.sentAlerts.set(alertKey, Date.now());
  }

  /**
   * Send SMS via Twilio
   * @param {string} to - Recipient phone number
   * @param {string} body - Message body
   * @returns {Promise<Object>} Send result
   */
  async sendSMS(to, body) {
    if (!this.twilioClient) {
      throw new Error('Twilio client not initialized');
    }

    if (!this.twilioConfig.fromNumber) {
      throw new Error('TWILIO_FROM_NUMBER not configured');
    }

    try {
      const message = await this.twilioClient.messages.create({
        body,
        from: this.twilioConfig.fromNumber,
        to,
      });

      this.stats.smsSent++;
      this.emit('sms:sent', { to, messageId: message.sid });

      return {
        success: true,
        messageId: message.sid,
        status: message.status,
      };
    } catch (err) {
      this.stats.errors++;
      this.emit('error', { channel: 'sms', error: err });
      throw err;
    }
  }

  /**
   * Send email via SendGrid
   * @param {string} to - Recipient email address
   * @param {string} subject - Email subject
   * @param {string} text - Plain text body
   * @param {string} html - HTML body (optional)
   * @returns {Promise<Object>} Send result
   */
  async sendEmail(to, subject, text, html = null) {
    if (!this.sendgridClient) {
      throw new Error('SendGrid client not initialized');
    }

    const msg = {
      to,
      from: {
        email: this.sendgridConfig.fromEmail,
        name: this.sendgridConfig.fromName,
      },
      subject,
      text,
      html: html || text.replace(/\n/g, '<br>'),
    };

    try {
      const [response] = await this.sendgridClient.send(msg);

      this.stats.emailsSent++;
      this.emit('email:sent', { to, subject, statusCode: response.statusCode });

      return {
        success: true,
        statusCode: response.statusCode,
      };
    } catch (err) {
      this.stats.errors++;
      this.emit('error', { channel: 'email', error: err });
      throw err;
    }
  }

  /**
   * Send notification through configured channels
   * @param {Object} notification - Notification details
   * @param {string} notification.type - Alert type (contextThreshold, phaseCompletion, etc.)
   * @param {string} notification.title - Notification title
   * @param {string} notification.message - Notification message
   * @param {string} notification.level - Alert level (info, warning, critical, emergency)
   * @param {Object} notification.data - Additional data
   * @returns {Promise<Object>} Send results
   */
  async notify(notification) {
    if (!this.preferences.enabled) {
      return { sent: false, reason: 'notifications-disabled' };
    }

    // Check quiet hours (except for emergency alerts)
    if (notification.level !== 'emergency' && this.isQuietHours()) {
      this.stats.alertsSuppressed++;
      return { sent: false, reason: 'quiet-hours' };
    }

    // Check cooldown
    const alertKey = `${notification.type}:${notification.level}:${notification.data?.projectId || 'global'}`;
    if (!this._shouldSendAlert(alertKey)) {
      this.stats.alertsSuppressed++;
      return { sent: false, reason: 'cooldown' };
    }

    const results = {
      sms: null,
      email: null,
    };

    // Format message for different channels
    const smsBody = this._formatSMS(notification);
    const { subject, text, html } = this._formatEmail(notification);

    // Send SMS
    if (this.preferences.channels.sms.enabled && this.twilioClient) {
      try {
        results.sms = await this.sendSMS(
          this.preferences.channels.sms.phoneNumber,
          smsBody
        );
      } catch (err) {
        results.sms = { success: false, error: err.message };
      }
    }

    // Send Email
    if (this.preferences.channels.email.enabled && this.sendgridClient) {
      try {
        results.email = await this.sendEmail(
          this.preferences.channels.email.address,
          subject,
          text,
          html
        );
      } catch (err) {
        results.email = { success: false, error: err.message };
      }
    }

    // Record alert sent
    if (results.sms?.success || results.email?.success) {
      this._recordAlertSent(alertKey);
      this.stats.alertsTriggered++;
    }

    this.emit('notification:sent', { notification, results });
    return { sent: true, results };
  }

  /**
   * Format notification for SMS
   * @private
   */
  _formatSMS(notification) {
    const levelEmoji = {
      info: '',
      warning: '!',
      critical: '!!',
      emergency: '!!!',
    };

    const prefix = levelEmoji[notification.level] || '';
    let msg = `${prefix} ${notification.title}`;

    if (notification.message) {
      msg += `\n${notification.message}`;
    }

    // Keep SMS under 160 chars when possible
    if (msg.length > 160) {
      msg = msg.substring(0, 157) + '...';
    }

    return msg;
  }

  /**
   * Format notification for email
   * @private
   */
  _formatEmail(notification) {
    const levelEmoji = {
      info: 'Info',
      warning: 'Warning',
      critical: 'Critical',
      emergency: 'EMERGENCY',
    };

    const levelColors = {
      info: '#2196F3',
      warning: '#FF9800',
      critical: '#F44336',
      emergency: '#B71C1C',
    };

    const subject = `[${levelEmoji[notification.level]}] ${notification.title}`;

    const text = [
      notification.title,
      '',
      notification.message,
      '',
      `Type: ${notification.type}`,
      `Level: ${notification.level}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${levelColors[notification.level]}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f5f5f5; padding: 20px; border-radius: 0 0 8px 8px; }
    .meta { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">${notification.title}</h2>
    </div>
    <div class="content">
      <p>${notification.message.replace(/\n/g, '<br>')}</p>
      ${notification.data ? `<pre>${JSON.stringify(notification.data, null, 2)}</pre>` : ''}
      <div class="meta">
        <p>Type: ${notification.type} | Level: ${notification.level}</p>
        <p>Sent: ${new Date().toISOString()}</p>
      </div>
    </div>
  </div>
</body>
</html>`;

    return { subject, text, html };
  }

  // ============================================================================
  // ALERT METHODS
  // ============================================================================

  /**
   * Send context threshold alert
   * @param {Object} data - Alert data
   * @param {string} data.projectId - Project identifier
   * @param {string} data.projectName - Project name
   * @param {number} data.contextPercent - Current context usage percentage
   * @param {number} data.threshold - Threshold that was crossed
   * @returns {Promise<Object>}
   */
  async alertContextThreshold(data) {
    if (!this.preferences.alerts.contextThreshold.enabled) {
      return { sent: false, reason: 'alert-type-disabled' };
    }

    // Check if this threshold level is configured
    const levels = this.preferences.alerts.contextThreshold.levels;
    if (!levels.includes(data.threshold)) {
      return { sent: false, reason: 'threshold-level-not-configured' };
    }

    let level = 'info';
    if (data.threshold >= 95) level = 'emergency';
    else if (data.threshold >= 85) level = 'critical';
    else if (data.threshold >= 70) level = 'warning';

    return this.notify({
      type: 'contextThreshold',
      title: `Context at ${data.contextPercent.toFixed(1)}%`,
      message: `Project "${data.projectName}" has reached ${data.contextPercent.toFixed(1)}% context usage.\n\nAction: Run /clear soon to prevent auto-compaction.`,
      level,
      data,
    });
  }

  /**
   * Send phase completion alert
   * @param {Object} data - Alert data
   * @param {string} data.phase - Completed phase name
   * @param {number} data.score - Phase quality score
   * @param {number} data.iterations - Number of iterations taken
   * @param {string} data.nextPhase - Next phase to execute
   * @returns {Promise<Object>}
   */
  async alertPhaseCompletion(data) {
    if (!this.preferences.alerts.phaseCompletion.enabled) {
      return { sent: false, reason: 'alert-type-disabled' };
    }

    return this.notify({
      type: 'phaseCompletion',
      title: `Phase Complete: ${data.phase}`,
      message: `Phase "${data.phase}" completed with score ${data.score}/100.\n\nIterations: ${data.iterations}\nNext phase: ${data.nextPhase || 'None (all phases complete)'}`,
      level: 'info',
      data,
    });
  }

  /**
   * Send task group completion alert
   * @param {Object} data - Alert data
   * @param {string} data.groupName - Task group name
   * @param {number} data.tasksCompleted - Number of tasks completed
   * @param {number} data.totalTasks - Total tasks in group
   * @param {number} data.averageScore - Average quality score
   * @returns {Promise<Object>}
   */
  async alertTaskGroupCompletion(data) {
    if (!this.preferences.alerts.taskGroupCompletion.enabled) {
      return { sent: false, reason: 'alert-type-disabled' };
    }

    return this.notify({
      type: 'taskGroupCompletion',
      title: `Task Group Complete: ${data.groupName}`,
      message: `Completed ${data.tasksCompleted}/${data.totalTasks} tasks in "${data.groupName}".\n\nAverage score: ${data.averageScore.toFixed(1)}/100`,
      level: 'info',
      data,
    });
  }

  /**
   * Send custom alert
   * @param {string} title - Alert title
   * @param {string} message - Alert message
   * @param {string} level - Alert level (info, warning, critical, emergency)
   * @param {Object} data - Additional data
   * @returns {Promise<Object>}
   */
  async alert(title, message, level = 'info', data = {}) {
    return this.notify({
      type: 'custom',
      title,
      message,
      level,
      data,
    });
  }

  /**
   * Get notification statistics
   * @returns {Object}
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Get service status
   * @returns {Object}
   */
  getStatus() {
    return {
      enabled: this.preferences.enabled,
      sms: {
        available: !!this.twilioClient,
        enabled: this.preferences.channels.sms.enabled,
        configured: !!this.preferences.channels.sms.phoneNumber,
      },
      email: {
        available: !!this.sendgridClient,
        enabled: this.preferences.channels.email.enabled,
        configured: !!this.preferences.channels.email.address,
      },
      quietHours: {
        enabled: this.preferences.quietHours.enabled,
        active: this.isQuietHours(),
      },
      stats: this.stats,
    };
  }
}

module.exports = NotificationService;
