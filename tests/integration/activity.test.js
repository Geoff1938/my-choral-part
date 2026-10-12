/**
 * Integration tests for activity logging (rehearsal time tracking)
 * Uses the throwaway database set up in tests/setup.js
 */

const request = require('supertest');
const { clientKey } = require('../../middleware/rateLimiter');

describe('Activity logging', () => {
  let app;
  let database;

  beforeAll(() => {
    app = require('../../server').app;
    database = require('../../utils/database');
  });

  const logEvent = (body) => request(app)
    .post('/api/activity/log')
    .send({ deviceId: 'test-device', ...body });

  test('accepts rehearsal_time with a duration', async () => {
    const response = await logEvent({ eventType: 'rehearsal_time', durationSeconds: 125 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  test('rejects rehearsal_time without a duration', async () => {
    const response = await logEvent({ eventType: 'rehearsal_time' });

    expect(response.status).toBe(400);
  });

  test('rejects rehearsal_time with an out-of-range duration', async () => {
    const tooShort = await logEvent({ eventType: 'rehearsal_time', durationSeconds: 0 });
    const tooLong = await logEvent({ eventType: 'rehearsal_time', durationSeconds: 7200 });

    expect(tooShort.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });

  test('still accepts the old rehearsal_heartbeat event', async () => {
    const response = await logEvent({ eventType: 'rehearsal_heartbeat' });

    expect(response.status).toBe(200);
  });

  test('rejects unknown event types', async () => {
    const response = await logEvent({ eventType: 'something_else' });

    expect(response.status).toBe(400);
  });

  test('summary totals rehearsal hours from durations', async () => {
    await logEvent({ eventType: 'rehearsal_time', durationSeconds: 3600 - 125 });

    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const summary = await database.getActivitySummary(start, end);

    expect(summary.rehearsalHours).toBe(1);
  });

  test('export includes the duration', async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const activities = await database.getActivitiesForExport(start, end);

    const durations = activities
      .filter(activity => activity.eventType === 'rehearsal_time')
      .map(activity => activity.durationSeconds)
      .sort((a, b) => a - b);
    expect(durations).toEqual([125, 3475]);
  });
});

describe('Activity field validation and limits', () => {
  let app;

  beforeAll(() => {
    app = require('../../server').app;
  });

  // Each test uses its own client address so the rate limit buckets are separate
  const logEvent = (body, clientIp) => request(app)
    .post('/api/activity/log')
    .set('CF-Connecting-IP', clientIp)
    .send({ deviceId: 'test-device', eventType: 'download', ...body });

  test('accepts strings up to 200 characters and null optional fields', async () => {
    const response = await logEvent({ composer: 'x'.repeat(200), work: null }, '198.51.100.1');

    expect(response.status).toBe(200);
  });

  test('rejects fields longer than 200 characters', async () => {
    const longDevice = await logEvent({ deviceId: 'd'.repeat(201) }, '198.51.100.2');
    const longWork = await logEvent({ work: 'w'.repeat(201) }, '198.51.100.2');

    expect(longDevice.status).toBe(400);
    expect(longWork.status).toBe(400);
  });

  test('rejects fields that are not strings', async () => {
    const numberDevice = await logEvent({ deviceId: 12345 }, '198.51.100.3');
    const objectComposer = await logEvent({ composer: { $gt: '' } }, '198.51.100.3');
    const arrayMovement = await logEvent({ movement: ['a', 'b'] }, '198.51.100.3');

    expect(numberDevice.status).toBe(400);
    expect(objectComposer.status).toBe(400);
    expect(arrayMovement.status).toBe(400);
  });

  test('rejects bodies over 10kb with 413', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const response = await logEvent({ padding: 'p'.repeat(11 * 1024) }, '198.51.100.4');

    expect(response.status).toBe(413);
    jest.restoreAllMocks();
  });

  test('limits each client to 60 events a minute, keyed on CF-Connecting-IP', async () => {
    for (let i = 0; i < 60; i++) {
      const response = await logEvent({}, '198.51.100.5');
      expect(response.status).toBe(200);
    }

    const limited = await logEvent({}, '198.51.100.5');
    const otherClient = await logEvent({}, '198.51.100.6');

    expect(limited.status).toBe(429);
    expect(otherClient.status).toBe(200);
  });
});

describe('clientKey', () => {
  test('prefers a valid CF-Connecting-IP header', () => {
    expect(clientKey({ headers: { 'cf-connecting-ip': ' 203.0.113.9 ' }, ip: '10.0.0.1' })).toBe('203.0.113.9');
  });

  test('falls back to req.ip when the header is missing or not an IP', () => {
    expect(clientKey({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(clientKey({ headers: { 'cf-connecting-ip': 'nonsense' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  test('groups IPv6 addresses by /56 subnet', () => {
    const a = clientKey({ headers: { 'cf-connecting-ip': '2001:db8:0:1::1' } });
    const b = clientKey({ headers: { 'cf-connecting-ip': '2001:db8:0:2::99' } });

    expect(a).toBe(b);
  });
});
