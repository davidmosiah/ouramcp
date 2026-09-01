import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConnectionStatus } from '../dist/services/connection-status.js';
import { formatCollection } from '../dist/services/format.js';

const dir = mkdtempSync(join(tmpdir(), 'oura-mcp-agent-readiness-'));

try {
  const markdown = formatCollection('Oura Activities', [
    { id: 1, name: 'Morning Tennis', sport_type: 'Tennis', start_date: '2026-04-27T12:30:43Z', distance: 41.3 },
    { id: 2, name: 'Afternoon Tennis', sport_type: 'Tennis', start_date: '2026-04-26T20:05:51Z', distance: 4557 }
  ], {
    endpoint: '/1/user/-/activities/list.json',
    privacy_mode: 'summary',
    count: 2,
    records: [{ id: 1 }, { id: 2 }],
    pages_fetched: 1
  });

  assert.doesNotMatch(markdown, /\[object Object\]/, 'Markdown previews must never leak JavaScript object stringification.');
  assert.doesNotMatch(markdown, /\*\*records\*\*/i, 'Collection markdown should not duplicate full record arrays in metadata.');
  assert.match(markdown, /Morning Tennis/);

  const tokenPath = join(dir, 'tokens.json');
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'personal'
  }), { mode: 0o600 });

  const limited = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });

  assert.equal(limited.ready_for_oura_api, false, 'A personal-only token should not be reported as fully ready for Oura health tools.');
  assert.equal(limited.ok, false);
  assert.deepEqual(limited.oauth.granted_scopes, ['personal']);
  assert.ok(limited.oauth.missing_recommended_scopes.includes('daily'));
  assert.ok(limited.oauth.missing_recommended_scopes.includes('workout'));
  assert.ok(!limited.oauth.missing_recommended_scopes.includes('sleep'), 'Oura has no sleep OAuth scope; doctor must not require it.');
  assert.equal(limited.oauth.activity_tools_ready, false);
  assert.equal(limited.oauth.profile_tools_ready, true);
  assert.ok(limited.next_steps.some((step) => /re-authorize/i.test(step) && /daily/.test(step)));

  // Real Oura consent grants (no separate "sleep" scope — sleep lives under daily).
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'daily heartrate personal workout spo2'
  }), { mode: 0o600 });

  const ready = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });

  assert.equal(ready.ok, true);
  assert.equal(ready.ready_for_oura_api, true);
  assert.deepEqual(ready.oauth.missing_recommended_scopes, []);
  assert.equal(ready.oauth.activity_tools_ready, true);

  // OpenAPI wire name spo2Daily must satisfy the spo2 recommendation (#8 regression).
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'daily heartrate personal workout spo2Daily'
  }), { mode: 0o600 });

  const aliased = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });

  assert.equal(aliased.oauth.scope_status, 'ok');
  assert.deepEqual(aliased.oauth.missing_recommended_scopes, []);
  assert.equal(aliased.ok, true);

  // Legacy local tokens that still list the non-existent "sleep" scope should not fail.
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'daily heartrate personal sleep workout spo2'
  }), { mode: 0o600 });

  const legacy = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(legacy.oauth.scope_status, 'ok');
  assert.deepEqual(legacy.oauth.missing_recommended_scopes, []);

  // Oura now returns scopes with an `extapi:` prefix (#11). Doctor must treat
  // those as the unprefixed recommended names without editing tokens.json.
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'extapi:daily extapi:heartrate extapi:personal extapi:workout extapi:spo2'
  }), { mode: 0o600 });

  const prefixed = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(prefixed.oauth.scope_status, 'ok');
  assert.deepEqual(prefixed.oauth.missing_recommended_scopes, []);
  assert.equal(prefixed.ok, true);
  assert.equal(prefixed.oauth.activity_tools_ready, true);
  assert.equal(prefixed.oauth.profile_tools_ready, true);

  // Prefix + existing alias: extapi:spo2Daily must still satisfy spo2.
  writeFileSync(tokenPath, JSON.stringify({
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: 2_000_000,
    scope: 'extapi:daily extapi:heartrate extapi:personal extapi:workout extapi:spo2Daily'
  }), { mode: 0o600 });

  const prefixedAlias = await buildConnectionStatus({
    env: {
      OURA_CLIENT_ID: 'client-id',
      OURA_CLIENT_SECRET: 'client-secret',
      OURA_REDIRECT_URI: 'http://127.0.0.1:4567/callback',
      OURA_TOKEN_PATH: tokenPath
    },
    homeDir: dir,
    nowMs: 1_000_000
  });
  assert.equal(prefixedAlias.oauth.scope_status, 'ok');
  assert.deepEqual(prefixedAlias.oauth.missing_recommended_scopes, []);
  assert.equal(prefixedAlias.ok, true);

  console.log(JSON.stringify({ ok: true, markdown: true, scope_diagnostics: true, spo2_alias: true, extapi_prefix: true }, null, 2));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
