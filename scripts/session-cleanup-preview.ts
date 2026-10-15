// Read-only: there is deliberately no apply flag or public cleanup endpoint.
import {sessionCleanupPreview} from '../src/server/session-cleanup.ts';
import {getPool} from '../src/server/db.ts';
try {console.log(JSON.stringify(await sessionCleanupPreview()));} finally {await getPool().end();}
