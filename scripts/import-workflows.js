/**
 * CLI Utility to import and activate workflows idempotently via n8n REST API
 * Usage: node scripts/import-workflows.js
 */
const fs = require('fs');
const path = require('path');

const N8N_HOST = process.env.N8N_BASE_URL || 'http://localhost:5678';
const N8N_API_KEY = process.env.N8N_API_KEY || '';

async function fetchExistingWorkflows() {
  try {
    const res = await fetch(`${N8N_HOST}/api/v1/workflows`, {
      method: 'GET',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return [];
    const body = await res.json();
    return body.data || body || [];
  } catch {
    return [];
  }
}

async function importWorkflow(filePath, existingWorkflows) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Workflow file not found: ${fullPath}`);
    return;
  }

  const workflowJson = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  console.log(`Processing workflow: "${workflowJson.name}"...`);

  if (!N8N_API_KEY) {
    console.warn(`[WARN] N8N_API_KEY not provided in environment. Skipping remote HTTP upload.`);
    console.log(`[INFO] You can import this file directly using n8n CLI inside the docker container:`);
    console.log(`       docker exec -i triage_n8n n8n import:workflow < ${filePath}`);
    return;
  }

  const existing = existingWorkflows.find(
    (w) => w.name === workflowJson.name || (workflowJson.id && w.id === workflowJson.id)
  );

  try {
    let result;
    if (existing) {
      console.log(`  -> Found existing workflow (ID: ${existing.id}), updating idempotently...`);
      const response = await fetch(`${N8N_HOST}/api/v1/workflows/${existing.id}`, {
        method: 'PUT',
        headers: {
          'X-N8N-API-KEY': N8N_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflowJson),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Failed to update (${response.status}): ${err}`);
      }
      result = await response.json();
      console.log(`✓ Workflow updated successfully (ID: ${existing.id})`);
    } else {
      console.log(`  -> Creating new workflow...`);
      const response = await fetch(`${N8N_HOST}/api/v1/workflows`, {
        method: 'POST',
        headers: {
          'X-N8N-API-KEY': N8N_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(workflowJson),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Failed to create (${response.status}): ${err}`);
      }
      result = await response.json();
      const newId = result.data?.id || result.id;
      console.log(`✓ Workflow created successfully with ID: ${newId}`);
    }
  } catch (error) {
    console.error(`Error during API import: ${error.message}`);
  }
}

async function main() {
  const workflowsDir = path.join(__dirname, '..', 'workflows');
  const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.json'));

  const existingWorkflows = N8N_API_KEY ? await fetchExistingWorkflows() : [];

  for (const file of files) {
    await importWorkflow(path.join(workflowsDir, file), existingWorkflows);
  }
}

main();
