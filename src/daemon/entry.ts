import { runDaemon } from './index.js';

runDaemon().catch((err) => {
  console.error('Daemon fatal error:', err);
  process.exit(1);
});
