import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const backendRoot = process.env.AGENTHUB_BACKEND_ROOT;
const dataDirectory = process.env.AGENTHUB_TEST_DATA_DIR;
const port = Number(process.env.AGENTHUB_TEST_PORT ?? '3210');
if (!backendRoot || !dataDirectory) {
  console.error('AGENTHUB_BACKEND_ROOT and AGENTHUB_TEST_DATA_DIR are required');
  process.exit(1);
}

const applicationModule = await import(pathToFileURL(path.join(backendRoot, 'dist', 'application', 'index.js')).href);
const apiModule = await import(pathToFileURL(path.join(backendRoot, 'dist', 'api', 'index.js')).href);
const owned = await applicationModule.createLocalAgentHubApplication({
  repositoryRoot: backendRoot,
  dataDirectory
});
const server = new apiModule.AgentHubHttpServer({
  application: owned.application,
  database: owned.database,
  host: '127.0.0.1',
  port
});
const address = await server.start();
writeFileSync(path.join(dataDirectory, 'test-backend.pid'), String(process.pid), 'utf8');
console.log(`AgentHub test API listening on http://${address.host}:${String(address.port)}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  try { await server.stop(); } catch { /* already stopped */ }
  try { await owned.close(); } catch { /* already closed */ }
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
