/**
 * Integration tests for activity logging (rehearsal time tracking)
 * Uses a throwaway database so the real data/activity.db is untouched
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB_PATH = path.join(os.tmpdir(), `activity-test-${process.pid}.db`);
process.env.DATABASE_PATH = TEST_DB_PATH;

describe('Activity logging', () => {
  let app;
  let database;

  beforeAll(() => {
    app = require('../../server').app;
    database = require('../../utils/database');
  });

  afterAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
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
