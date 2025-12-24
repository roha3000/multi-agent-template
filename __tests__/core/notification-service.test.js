/**
 * NotificationService Tests
 *
 * Tests for SMS/Email notification service including:
 * - Initialization and configuration
 * - Preference management
 * - Alert sending (context threshold, phase completion, task group)
 * - Quiet hours logic
 * - Cooldown and deduplication
 */

const NotificationService = require('../../.claude/core/notification-service');
const path = require('path');
const fs = require('fs');

describe('NotificationService', () => {
  let service;
  let testPrefsPath;

  beforeEach(() => {
    // Create unique test preferences file for each test
    testPrefsPath = path.join(__dirname, `test-prefs-${Date.now()}.json`);
    service = new NotificationService({
      preferencesPath: testPrefsPath
    });
  });

  afterEach(() => {
    // Clean up test preferences file
    if (fs.existsSync(testPrefsPath)) {
      fs.unlinkSync(testPrefsPath);
    }
  });

  describe('constructor', () => {
    test('should initialize with default preferences', () => {
      const prefs = service.getPreferences();
      expect(prefs.enabled).toBe(false);
      expect(prefs.channels.sms.enabled).toBe(false);
      expect(prefs.channels.email.enabled).toBe(false);
      expect(prefs.alerts.contextThreshold.enabled).toBe(true);
      expect(prefs.alerts.contextThreshold.levels).toEqual([70, 85, 95]);
      expect(prefs.alerts.phaseCompletion.enabled).toBe(true);
      expect(prefs.alerts.taskGroupCompletion.enabled).toBe(true);
      expect(prefs.quietHours.enabled).toBe(false);
    });

    test('should extend EventEmitter', () => {
      expect(typeof service.on).toBe('function');
      expect(typeof service.emit).toBe('function');
    });

    test('should initialize stats counters to zero', () => {
      const stats = service.getStats();
      expect(stats.smsSent).toBe(0);
      expect(stats.emailsSent).toBe(0);
      expect(stats.alertsTriggered).toBe(0);
      expect(stats.alertsSuppressed).toBe(0);
      expect(stats.errors).toBe(0);
    });

    test('should use environment variables for Twilio config', () => {
      const originalEnv = { ...process.env };
      process.env.TWILIO_ACCOUNT_SID = 'test-sid';
      process.env.TWILIO_AUTH_TOKEN = 'test-token';
      process.env.TWILIO_FROM_NUMBER = '+15555555555';

      const envService = new NotificationService({ preferencesPath: testPrefsPath });
      expect(envService.twilioConfig.accountSid).toBe('test-sid');
      expect(envService.twilioConfig.authToken).toBe('test-token');
      expect(envService.twilioConfig.fromNumber).toBe('+15555555555');

      // Restore environment
      Object.assign(process.env, originalEnv);
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_FROM_NUMBER;
    });

    test('should use environment variables for SendGrid config', () => {
      const originalEnv = { ...process.env };
      process.env.SENDGRID_API_KEY = 'test-api-key';
      process.env.SENDGRID_FROM_EMAIL = 'test@example.com';
      process.env.SENDGRID_FROM_NAME = 'Test System';

      const envService = new NotificationService({ preferencesPath: testPrefsPath });
      expect(envService.sendgridConfig.apiKey).toBe('test-api-key');
      expect(envService.sendgridConfig.fromEmail).toBe('test@example.com');
      expect(envService.sendgridConfig.fromName).toBe('Test System');

      // Restore environment
      Object.assign(process.env, originalEnv);
      delete process.env.SENDGRID_API_KEY;
      delete process.env.SENDGRID_FROM_EMAIL;
      delete process.env.SENDGRID_FROM_NAME;
    });
  });

  describe('preferences management', () => {
    test('should save preferences to file', () => {
      service.savePreferences({ enabled: true });
      expect(fs.existsSync(testPrefsPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(testPrefsPath, 'utf-8'));
      expect(content.enabled).toBe(true);
    });

    test('should merge preferences with defaults', () => {
      service.savePreferences({
        enabled: true,
        channels: {
          sms: { enabled: true, phoneNumber: '+15555555555' }
        }
      });

      const prefs = service.getPreferences();
      expect(prefs.enabled).toBe(true);
      expect(prefs.channels.sms.enabled).toBe(true);
      expect(prefs.channels.sms.phoneNumber).toBe('+15555555555');
      // Email should still have defaults
      expect(prefs.channels.email.enabled).toBe(false);
    });

    test('should load preferences from file on construction', () => {
      // Create preferences file
      fs.writeFileSync(testPrefsPath, JSON.stringify({
        enabled: true,
        channels: { sms: { enabled: true } }
      }));

      const loadedService = new NotificationService({ preferencesPath: testPrefsPath });
      const prefs = loadedService.getPreferences();
      expect(prefs.enabled).toBe(true);
      expect(prefs.channels.sms.enabled).toBe(true);
    });

    test('should emit preferences:saved event', (done) => {
      service.on('preferences:saved', (prefs) => {
        expect(prefs.enabled).toBe(true);
        done();
      });
      service.savePreferences({ enabled: true });
    });

    test('should update context threshold levels', () => {
      service.savePreferences({
        alerts: {
          contextThreshold: { levels: [50, 75, 90] }
        }
      });

      const prefs = service.getPreferences();
      expect(prefs.alerts.contextThreshold.levels).toEqual([50, 75, 90]);
    });
  });

  describe('quiet hours', () => {
    test('should return false when quiet hours disabled', () => {
      service.savePreferences({
        quietHours: { enabled: false, start: '22:00', end: '08:00' }
      });
      expect(service.isQuietHours()).toBe(false);
    });

    test('should detect quiet hours correctly - same day', () => {
      service.savePreferences({
        quietHours: { enabled: true, start: '09:00', end: '17:00' }
      });

      // Mock Date to be 12:00
      const realDate = Date;
      global.Date = class extends realDate {
        constructor() {
          super();
          return new realDate(2025, 0, 15, 12, 0, 0);
        }
      };

      expect(service.isQuietHours()).toBe(true);

      global.Date = realDate;
    });

    test('should detect quiet hours correctly - overnight', () => {
      service.savePreferences({
        quietHours: { enabled: true, start: '22:00', end: '08:00' }
      });

      // Mock Date to be 23:00
      const realDate = Date;
      global.Date = class extends realDate {
        constructor() {
          super();
          return new realDate(2025, 0, 15, 23, 0, 0);
        }
      };

      expect(service.isQuietHours()).toBe(true);

      global.Date = realDate;
    });

    test('should not be in quiet hours when outside range', () => {
      service.savePreferences({
        quietHours: { enabled: true, start: '22:00', end: '08:00' }
      });

      // Mock Date to be 12:00
      const realDate = Date;
      global.Date = class extends realDate {
        constructor() {
          super();
          return new realDate(2025, 0, 15, 12, 0, 0);
        }
      };

      expect(service.isQuietHours()).toBe(false);

      global.Date = realDate;
    });
  });

  describe('alert cooldown', () => {
    test('should allow first alert', () => {
      expect(service._shouldSendAlert('test:warning:project1')).toBe(true);
    });

    test('should record alert sent time', () => {
      service._recordAlertSent('test:warning:project1');
      expect(service.sentAlerts.has('test:warning:project1')).toBe(true);
    });

    test('should block duplicate alerts within cooldown', () => {
      service._recordAlertSent('test:warning:project1');
      expect(service._shouldSendAlert('test:warning:project1')).toBe(false);
    });

    test('should allow alert after cooldown expires', () => {
      // Set a past timestamp
      service.sentAlerts.set('test:warning:project1', Date.now() - 10 * 60 * 1000);
      expect(service._shouldSendAlert('test:warning:project1')).toBe(true);
    });

    test('should use unique keys for different alerts', () => {
      service._recordAlertSent('test:warning:project1');
      expect(service._shouldSendAlert('test:critical:project1')).toBe(true);
      expect(service._shouldSendAlert('test:warning:project2')).toBe(true);
    });
  });

  describe('notify', () => {
    test('should return sent:false when notifications disabled', async () => {
      service.savePreferences({ enabled: false });

      const result = await service.notify({
        type: 'test',
        title: 'Test',
        message: 'Test message',
        level: 'info'
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('notifications-disabled');
    });

    test('should suppress during quiet hours (except emergency)', async () => {
      service.savePreferences({
        enabled: true,
        quietHours: { enabled: true, start: '00:00', end: '23:59' }
      });

      const result = await service.notify({
        type: 'test',
        title: 'Test',
        message: 'Test message',
        level: 'warning'
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('quiet-hours');
      expect(service.getStats().alertsSuppressed).toBe(1);
    });

    test('should not suppress emergency alerts during quiet hours', async () => {
      service.savePreferences({
        enabled: true,
        quietHours: { enabled: true, start: '00:00', end: '23:59' }
      });

      const result = await service.notify({
        type: 'test',
        title: 'Emergency',
        message: 'Emergency message',
        level: 'emergency',
        data: { projectId: 'test-project' }
      });

      // Will return sent:true but results will be null (no channels configured)
      expect(result.sent).toBe(true);
    });

    test('should respect cooldown', async () => {
      service.savePreferences({ enabled: true });

      // Manually record an alert as sent (simulating a successful send)
      const alertKey = 'test:warning:cooldown-test-project';
      service._recordAlertSent(alertKey);

      // Now try to send the same alert - should be suppressed by cooldown
      const result = await service.notify({
        type: 'test',
        title: 'Test',
        message: 'Test message',
        level: 'warning',
        data: { projectId: 'cooldown-test-project' }
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('cooldown');
    });

    test('should emit notification:sent event', async () => {
      service.savePreferences({ enabled: true });

      const eventPromise = new Promise((resolve) => {
        service.on('notification:sent', (data) => {
          resolve(data);
        });
      });

      await service.notify({
        type: 'test',
        title: 'Test',
        message: 'Test message',
        level: 'info',
        data: { projectId: 'test-project' }
      });

      const eventData = await eventPromise;
      expect(eventData.notification.type).toBe('test');
    });
  });

  describe('alertContextThreshold', () => {
    test('should return sent:false when alert type disabled', async () => {
      service.savePreferences({
        enabled: true,
        alerts: { contextThreshold: { enabled: false } }
      });

      const result = await service.alertContextThreshold({
        projectId: 'test',
        projectName: 'Test Project',
        contextPercent: 85,
        threshold: 85
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('alert-type-disabled');
    });

    test('should return sent:false when threshold not configured', async () => {
      service.savePreferences({
        enabled: true,
        alerts: { contextThreshold: { enabled: true, levels: [70, 95] } }
      });

      const result = await service.alertContextThreshold({
        projectId: 'test',
        projectName: 'Test Project',
        contextPercent: 85,
        threshold: 85
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('threshold-level-not-configured');
    });

    test('should set correct alert level based on threshold', async () => {
      service.savePreferences({
        enabled: true,
        alerts: { contextThreshold: { enabled: true, levels: [70, 85, 95] } }
      });

      let capturedLevel = null;
      const originalNotify = service.notify.bind(service);
      service.notify = async (notification) => {
        capturedLevel = notification.level;
        return originalNotify(notification);
      };

      await service.alertContextThreshold({
        projectId: 'test-95',
        projectName: 'Test Project',
        contextPercent: 95,
        threshold: 95
      });

      expect(capturedLevel).toBe('emergency');
    });
  });

  describe('alertPhaseCompletion', () => {
    test('should return sent:false when alert type disabled', async () => {
      service.savePreferences({
        enabled: true,
        alerts: { phaseCompletion: { enabled: false } }
      });

      const result = await service.alertPhaseCompletion({
        phase: 'research',
        score: 85,
        iterations: 2,
        nextPhase: 'design'
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('alert-type-disabled');
    });

    test('should include phase details in notification', async () => {
      service.savePreferences({
        enabled: true,
        alerts: { phaseCompletion: { enabled: true } }
      });

      let capturedNotification = null;
      const originalNotify = service.notify.bind(service);
      service.notify = async (notification) => {
        capturedNotification = notification;
        return originalNotify(notification);
      };

      await service.alertPhaseCompletion({
        phase: 'research',
        score: 85,
        iterations: 2,
        nextPhase: 'design'
      });

      expect(capturedNotification.type).toBe('phaseCompletion');
      expect(capturedNotification.title).toBe('Phase Complete: research');
      expect(capturedNotification.message).toContain('85/100');
      expect(capturedNotification.message).toContain('design');
    });
  });

  describe('alertTaskGroupCompletion', () => {
    test('should return sent:false when alert type disabled', async () => {
      service.savePreferences({
        enabled: true,
        alerts: { taskGroupCompletion: { enabled: false } }
      });

      const result = await service.alertTaskGroupCompletion({
        groupName: 'Sprint 1',
        tasksCompleted: 5,
        totalTasks: 5,
        averageScore: 92
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('alert-type-disabled');
    });

    test('should include task group details in notification', async () => {
      service.savePreferences({
        enabled: true,
        alerts: { taskGroupCompletion: { enabled: true } }
      });

      let capturedNotification = null;
      const originalNotify = service.notify.bind(service);
      service.notify = async (notification) => {
        capturedNotification = notification;
        return originalNotify(notification);
      };

      await service.alertTaskGroupCompletion({
        groupName: 'Sprint 1',
        tasksCompleted: 5,
        totalTasks: 5,
        averageScore: 92
      });

      expect(capturedNotification.type).toBe('taskGroupCompletion');
      expect(capturedNotification.title).toBe('Task Group Complete: Sprint 1');
      expect(capturedNotification.message).toContain('5/5');
      expect(capturedNotification.message).toContain('92.0/100');
    });
  });

  describe('custom alert', () => {
    test('should send custom alert with provided parameters', async () => {
      service.savePreferences({ enabled: true });

      let capturedNotification = null;
      const originalNotify = service.notify.bind(service);
      service.notify = async (notification) => {
        capturedNotification = notification;
        return originalNotify(notification);
      };

      await service.alert('Custom Title', 'Custom Message', 'critical', { custom: 'data' });

      expect(capturedNotification.type).toBe('custom');
      expect(capturedNotification.title).toBe('Custom Title');
      expect(capturedNotification.message).toBe('Custom Message');
      expect(capturedNotification.level).toBe('critical');
      expect(capturedNotification.data.custom).toBe('data');
    });
  });

  describe('message formatting', () => {
    test('should format SMS message correctly', () => {
      const sms = service._formatSMS({
        level: 'warning',
        title: 'Context Alert',
        message: 'Project at 85% context usage'
      });

      expect(sms).toContain('!');
      expect(sms).toContain('Context Alert');
      expect(sms).toContain('Project at 85% context usage');
    });

    test('should truncate long SMS messages to 160 chars', () => {
      const longMessage = 'x'.repeat(200);
      const sms = service._formatSMS({
        level: 'info',
        title: 'Test',
        message: longMessage
      });

      expect(sms.length).toBeLessThanOrEqual(160);
      expect(sms).toContain('...');
    });

    test('should format email with proper HTML structure', () => {
      const { subject, text, html } = service._formatEmail({
        type: 'contextThreshold',
        level: 'critical',
        title: 'Context Alert',
        message: 'Project at 85% context usage',
        data: { projectId: 'test' }
      });

      expect(subject).toBe('[Critical] Context Alert');
      expect(text).toContain('Context Alert');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('#F44336'); // Critical color
      expect(html).toContain('Context Alert');
    });

    test('should use correct level prefixes in SMS', () => {
      const emergency = service._formatSMS({ level: 'emergency', title: 'Test' });
      const critical = service._formatSMS({ level: 'critical', title: 'Test' });
      const warning = service._formatSMS({ level: 'warning', title: 'Test' });
      const info = service._formatSMS({ level: 'info', title: 'Test' });

      expect(emergency).toContain('!!!');
      expect(critical).toContain('!!');
      expect(warning).toContain('!');
      expect(info).not.toContain('!');
    });
  });

  describe('getStatus', () => {
    test('should return complete status object', () => {
      service.savePreferences({
        enabled: true,
        channels: {
          sms: { enabled: true, phoneNumber: '+15555555555' },
          email: { enabled: false, address: '' }
        }
      });

      const status = service.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.sms.available).toBe(false); // Twilio not initialized
      expect(status.sms.enabled).toBe(true);
      expect(status.sms.configured).toBe(true);
      expect(status.email.available).toBe(false); // SendGrid not initialized
      expect(status.email.enabled).toBe(false);
      expect(status.email.configured).toBe(false);
      expect(status.quietHours).toBeDefined();
      expect(status.stats).toBeDefined();
    });
  });

  describe('initialize', () => {
    test('should return unavailable status without credentials', async () => {
      const status = await service.initialize();

      expect(status.sms.available).toBe(false);
      expect(status.sms.error).toContain('TWILIO');
      expect(status.email.available).toBe(false);
      expect(status.email.error).toContain('SENDGRID');
    });

    test('should emit initialized event', async () => {
      const eventPromise = new Promise((resolve) => {
        service.on('initialized', (status) => {
          resolve(status);
        });
      });

      await service.initialize();
      const status = await eventPromise;

      expect(status).toBeDefined();
      expect(status.sms).toBeDefined();
      expect(status.email).toBeDefined();
    });
  });
});
