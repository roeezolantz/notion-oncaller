import { routeRequest } from '../index';

describe('routeRequest', () => {
  it('routes GET / to health', () => {
    expect(routeRequest('/', 'GET')).toBe('health');
  });

  it('routes POST /cron/daily to cron', () => {
    expect(routeRequest('/cron/daily', 'POST')).toBe('cron');
  });

  it('routes POST /slack/commands to slash_command', () => {
    expect(routeRequest('/slack/commands', 'POST')).toBe('slash_command');
  });

  it('routes POST /slack/interactions to interaction', () => {
    expect(routeRequest('/slack/interactions', 'POST')).toBe('interaction');
  });

  it('returns not_found for unknown paths', () => {
    expect(routeRequest('/unknown', 'GET')).toBe('not_found');
    expect(routeRequest('/unknown', 'POST')).toBe('not_found');
  });

  it('returns not_found for wrong method on valid path', () => {
    expect(routeRequest('/', 'POST')).toBe('not_found');
    expect(routeRequest('/cron/daily', 'GET')).toBe('not_found');
    expect(routeRequest('/slack/commands', 'GET')).toBe('not_found');
  });
});
