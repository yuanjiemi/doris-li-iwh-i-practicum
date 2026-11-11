'use strict';
require('dotenv').config({ quiet: true });
const express = require('express');
const axios = require('axios');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const fields = [
  { name: 'name', label: 'Name', max: 120 },
  { name: 'platform', label: 'Platform', max: 80 },
  { name: 'workflow_stage', label: 'Workflow stage', max: 80 },
];

function createApp(options = {}) {
  const token = options.token ?? process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  const objectType = options.objectType ?? process.env.HUBSPOT_OBJECT_TYPE;
  const client = options.client ?? axios.create({
    baseURL: 'https://api.hubapi.com', timeout: 15000,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const csrf = randomBytes(32).toString('hex');
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'pug');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'");
    Object.assign(res.locals, { fields, csrf });
    next();
  });
  const endpoint = `/crm/v3/objects/${encodeURIComponent(objectType || '')}`;
  const configured = () => Boolean(token && objectType);
  function apiMessage(error) {
    const status = error.response?.status;
    if (status === 401) return 'HubSpot authentication failed. Check the server access token.';
    if (status === 403) return 'HubSpot denied access. Check the app scopes and object availability.';
    if (status === 429) return 'HubSpot is temporarily rate limiting requests. Please try again shortly.';
    return 'HubSpot could not complete the request. Please try again or check the server configuration.';
  }

  // Route 1: retrieve the three CRM properties and render the table with cursor paging.
  app.get('/', async (req, res) => {
    if (!configured()) return res.status(503).render('error', { message: 'Set HUBSPOT_PRIVATE_APP_TOKEN and HUBSPOT_OBJECT_TYPE in the server .env file before connecting.' });
    const after = typeof req.query.after === 'string' ? req.query.after : '';
    if (after && !/^\d+$/.test(after)) return res.status(400).render('error', { message: 'Invalid paging cursor.' });
    try {
      const response = await client.get(endpoint, {
        params: { properties: fields.map(field => field.name).join(','), limit: 100, archived: false, ...(after ? { after } : {}) },
      });
      res.render('homepage', {
        title: 'Automation Projects | Integrating With HubSpot I Practicum',
        records: response.data.results, next: response.data.paging?.next?.after,
        created: req.query.created === '1',
      });
    } catch (error) {
      res.status(502).render('error', { message: apiMessage(error) });
    }
  });

  // Route 2: display the form without changing CRM data.
  app.get('/update-cobj', (req, res) => {
    res.render('updates', { title: 'Update Custom Object Form | Integrating With HubSpot I Practicum', values: {}, errors: [] });
  });

  // Route 3: validate, create a HubSpot record, and redirect back to the table.
  app.post('/update-cobj', async (req, res) => {
    const supplied = Buffer.from(typeof req.body._csrf === 'string' ? req.body._csrf : '');
    const expected = Buffer.from(csrf);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return res.status(403).render('error', { message: 'This form has expired. Open a fresh form and try again.' });
    }
    const values = {}, errors = [];
    for (const field of fields) {
      values[field.name] = typeof req.body[field.name] === 'string' ? req.body[field.name].trim() : '';
      if (!values[field.name] || values[field.name].length > field.max) errors.push(`${field.label} is required and must contain at most ${field.max} characters.`);
    }
    const renderForm = status => res.status(status).render('updates', {
      title: 'Update Custom Object Form | Integrating With HubSpot I Practicum', values, errors,
    });
    if (errors.length) return renderForm(400);
    if (!configured()) {
      errors.push('Configure the HubSpot connection on the server before creating records.');
      return renderForm(503);
    }
    try {
      await client.post(endpoint, { properties: values });
      res.redirect(303, '/?created=1');
    } catch (error) {
      errors.push(apiMessage(error));
      return renderForm(502);
    }
  });
  app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));
  app.use((error, req, res, next) => {
    res.status(error.status === 413 ? 413 : 500).render('error', { message: 'The request could not be processed.' });
  });
  return app;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '127.0.0.1', () => console.log(`Listening on http://127.0.0.1:${port}`));
}
module.exports = { createApp };
