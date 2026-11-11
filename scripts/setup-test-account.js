'use strict';
require('dotenv').config({ quiet: true });
const axios = require('axios');
const fs = require('node:fs');

// Run only against the explicitly created developer test account.
const expectedAccount = '247969085';
const seeds = [
  { name: 'Lead routing', platform: 'n8n', workflow_stage: 'Testing' },
  { name: 'CRM intake', platform: 'Make', workflow_stage: 'Planning' },
  { name: 'Weekly reporting', platform: 'Power BI', workflow_stage: 'Ready for review' },
];
(async () => {
  if (process.env.HUBSPOT_ACCOUNT_ID !== expectedAccount || !process.env.HUBSPOT_PRIVATE_APP_TOKEN) throw new Error('Set the dedicated developer test account and token first.');
  const api = axios.create({ baseURL: 'https://api.hubapi.com', timeout: 20000, headers: { Authorization: `Bearer ${process.env.HUBSPOT_PRIVATE_APP_TOKEN}`, 'Content-Type': 'application/json' } });
  const { data: info } = await api.post('/oauth/v2/private-apps/get/access-token-info', { tokenKey: process.env.HUBSPOT_PRIVATE_APP_TOKEN });
  if (String(info.hubId) !== expectedAccount) throw new Error('Token belongs to a different account; no data changed.');
  const schemaPath = '/crm-object-schemas/v3/schemas';
  const { data: existing } = await api.get(schemaPath);
  let schema = existing.results.find(item => item.name === 'automation_projects');
  if (!schema) {
    const result = await api.post(schemaPath, {
      name: 'automation_projects', description: 'Synthetic automation project register for the HubSpot Foundations practicum.',
      labels: { singular: 'Automation Project', plural: 'Automation Projects' },
      primaryDisplayProperty: 'name', secondaryDisplayProperties: ['platform','workflow_stage'],
      requiredProperties: ['name','platform','workflow_stage'], searchableProperties: ['name','platform'],
      associatedObjects: ['0-1'],
      properties: [
        { name: 'name', label: 'Name', type: 'string', fieldType: 'text' },
        { name: 'platform', label: 'Platform', type: 'string', fieldType: 'text' },
        { name: 'workflow_stage', label: 'Workflow stage', type: 'string', fieldType: 'text' },
      ],
    });
    schema = result.data;
  }
  const objectType = schema.objectTypeId;
  const env = fs.readFileSync('.env','utf8').replace(/^HUBSPOT_OBJECT_TYPE=.*$/m, `HUBSPOT_OBJECT_TYPE=${objectType}`);
  fs.writeFileSync('.env', env, { mode: 0o600 });
  const { data: records } = await api.get(`/crm/v3/objects/${objectType}`, { params: { properties: 'name,platform,workflow_stage', limit: 100 } });
  const names = new Set(records.results.map(item => item.properties.name));
  for (const properties of seeds) {
    if (!names.has(properties.name)) await api.post(`/crm/v3/objects/${objectType}`, { properties });
  }
  console.log(JSON.stringify({ accountId: expectedAccount, objectTypeId: objectType, properties: ['name','platform','workflow_stage'], associations: schema.associations?.map(a=>({from:a.fromObjectTypeId,to:a.toObjectTypeId})), listUrl: `https://app-na2.hubspot.com/contacts/${expectedAccount}/objects/${objectType}/views/all/list`, seedNames: seeds.map(s=>s.name) }, null, 2));
})().catch(error => {
  // Never log Axios error objects: they contain Authorization headers.
  console.error(JSON.stringify({ message: error.response?.data?.message || error.message, status: error.response?.status }));
  process.exitCode = 1;
});
