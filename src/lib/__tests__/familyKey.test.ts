import { describe, expect, it } from 'vitest';
import { registryKey, suggestTopic, topicAllowed, topicPrefix } from '../familyKey';
import { ntfyFor, type Config } from '../../../reminders/core';

const cfg: Config = { apiKey: 'k', projectId: 'p', familyId: 'aaaaaaaaaaaaaaaaaa', ntfyServer: 'https://ntfy.example', ntfyToken: 'geheim', timezone: 'Europe/Vienna' };

describe('Trennung zwischen Familien', () => {
  it('Präfix und Verzeichnisschlüssel sind je Familie verschieden und stabil', async () => {
    const a = await topicPrefix('familieaaaaaaaaaaa'), b = await topicPrefix('familiebbbbbbbbbbb');
    expect(a).toMatch(/^fk-[a-z2-9]{12}$/);
    expect(a).not.toBe(b);
    expect(await topicPrefix('familieaaaaaaaaaaa')).toBe(a);
    expect(await registryKey('familieaaaaaaaaaaa')).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toContain('familie');
  });
  it('Topics: nur mit dem eigenen Präfix', async () => {
    const p = await topicPrefix('familieaaaaaaaaaaa');
    expect(suggestTopic(p, 'Mama Müller')).toBe(`${p}-mama-muller`);
    expect(topicAllowed(`${p}-mama`, p)).toBe(true);
    expect(topicAllowed('mama', p)).toBe(false);
    expect(topicAllowed(`${p}x-mama`, p)).toBe(false);
  });
  it('Versand: fremde Familien nur über ihren eigenen Server, ohne Token des Dienstes, nur mit Präfix', () => {
    const ohne = ntfyFor({ ...cfg, topicPrefix: 'fk-abc' }, {});
    expect(ohne.missingServer).toBe(true);
    expect(ohne.allowed('fk-abc-mama')).toBe(false);
    expect(ohne.cfg.ntfyToken).toBeUndefined();
    const dienstServer = ntfyFor({ ...cfg, topicPrefix: 'fk-abc' }, { ntfyServer: 'https://ntfy.example/' });
    expect(dienstServer.missingServer).toBe(true); // der Server des Dienstes ist für Fremde gesperrt
    const eigen = ntfyFor({ ...cfg, topicPrefix: 'fk-abc' }, { ntfyServer: 'https://ntfy.sh' });
    expect(eigen.cfg.ntfyServer).toBe('https://ntfy.sh');
    expect(eigen.cfg.ntfyToken).toBeUndefined();
    expect(eigen.allowed('fk-abc-mama')).toBe(true);
    expect(eigen.allowed('mama')).toBe(false);
    expect(ntfyFor({ ...cfg, topicPrefix: 'fk-abc' }, { ntfyServer: 'http://unsicher.example' }).missingServer).toBe(true);
    // eigene Familie: wie bisher
    expect(ntfyFor(cfg, {}).allowed('mama')).toBe(true);
    expect(ntfyFor(cfg, {}).cfg.ntfyToken).toBe('geheim');
  });
});
