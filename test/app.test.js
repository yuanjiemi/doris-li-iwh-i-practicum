'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');

async function fixture(t, overrides = {}) {
  const calls = [];
  const records = [{ id: '1', properties: { name: 'Lead routing', platform: 'n8n', workflow_stage: 'Testing' } }];
  const client = {
    async get(url, config) { calls.push({ method: 'GET', url, config }); return { data: { results: records } }; },
    async post(url, body) { calls.push({ method: 'POST', url, body }); records.push({ id: '2', properties: body.properties }); return { data: records.at(-1) }; },
    ...overrides,
  };
  const server = createApp({ token: 'isolated-test-token', objectType: '2-123', client }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = await (await fetch(`${base}/update-cobj`)).text();
  const csrf = form.match(/name="_csrf" value="([^"]+)"/)[1];
  return { base, calls, records, csrf, form };
}
function body(csrf, values = {}) {
  return new URLSearchParams({ _csrf: csrf, name: 'New project', platform: 'Make', workflow_stage: 'Planning', ...values });
}

test('GET reads the required fields and renders all three table columns', async t => {
  const { base, calls } = await fixture(t);
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Lead routing/);
  assert.match(html, /<th scope="col">Platform<\/th>/);
  assert.match(html, /<th scope="col">Workflow stage<\/th>/);
  assert.equal(calls[0].url, '/crm/v3/objects/2-123');
  assert.equal(calls[0].config.params.properties, 'name,platform,workflow_stage');
  assert.doesNotMatch(html, /isolated-test-token/);
});

test('form POST creates the correct CRM payload, redirects and re-reads the saved record', async t => {
  const { base, calls, csrf, form } = await fixture(t);
  assert.match(form, /Update Custom Object Form \| Integrating With HubSpot I Practicum/);
  assert.match(form, /Return to the homepage/);
  const response = await fetch(`${base}/update-cobj`, { method: 'POST', body: body(csrf), redirect: 'manual' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/?created=1');
  assert.deepEqual(calls[0].body, { properties: { name: 'New project', platform: 'Make', workflow_stage: 'Planning' } });
  const result = await (await fetch(base + response.headers.get('location'))).text();
  assert.match(result, /New project/);
  assert.match(result, /Project created in HubSpot/);
});

test('invalid input is rejected without creating a CRM record and entered fields are retained', async t => {
  const { base, calls, csrf } = await fixture(t);
  const response = await fetch(`${base}/update-cobj`, { method: 'POST', body: body(csrf, { name: '  ' }) });
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.match(html, /Name is required/);
  assert.match(html, /value="Make"/);
  assert.equal(calls.length, 0);
});

test('a forged form cannot create a CRM record', async t => {
  const { base, calls } = await fixture(t);
  const response = await fetch(`${base}/update-cobj`, { method: 'POST', body: body('invalid') });
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

test('HubSpot rate errors are visible but secrets and headers never leak', async t => {
  const { base } = await fixture(t, { async get() { throw { response: { status: 429 }, config: { token: 'secret-credential' } }; } });
  const response = await fetch(base);
  assert.equal(response.status, 502);
  const html = await response.text();
  assert.match(html, /rate limiting/);
  assert.doesNotMatch(html, /secret-credential|isolated-test-token/);
});

test('API creation failure retains the form and does not claim successful creation', async t => {
  const { base, csrf } = await fixture(t, { async post() { throw { response: { status: 403 } }; } });
  const response = await fetch(`${base}/update-cobj`, { method: 'POST', body: body(csrf) });
  assert.equal(response.status, 502);
  const html = await response.text();
  assert.match(html, /denied access/);
  assert.match(html, /value="New project"/);
  assert.doesNotMatch(html, /Project created in HubSpot/);
});

test('record text is escaped and the paging cursor is forwarded', async t => {
  const { base, records, calls } = await fixture(t);
  records[0].properties.name = '<script>alert(1)</script>';
  const html = await (await fetch(`${base}/?after=123`)).text();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(calls[0].config.params.after, '123');
  assert.equal((await fetch(`${base}/?after=bad`)).status, 400);
});
