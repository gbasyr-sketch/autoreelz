import type {APIRoute} from 'astro';
import {staff} from '../../../server/security';
import {json,failure} from '../../../server/http';
import {readBackupStatus} from '../../../server/backup-status';
export const GET:APIRoute=async ctx=>{try{await staff(ctx.request);return json(await readBackupStatus());}catch(e){return failure(e);}};
