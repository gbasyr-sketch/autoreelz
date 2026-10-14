#!/usr/bin/env python3
"""AUTO REELZ only: encrypted snapshots, scoped offsite copy and isolated restore drill.
No live restore, provider calls, CMS clone or global disk cleanup is implemented.
"""
import argparse, base64, datetime, fcntl, hashlib, json, os, pathlib, re, selectors, shutil, stat, subprocess, sys, time, traceback, uuid

ROOT = pathlib.Path('/srv/autoreelz2026')
PROJECT = 'autoreelz2026-release'
DATABASE = 'autoreelz2026_new'
DB = PROJECT + '-db-1'
PRIVATE = ROOT / 'shared/backup-private'
WORK = ROOT / 'shared/backup-runtime'
STATUS = ROOT / 'shared/backup-status/status.json'
RESTIC = ROOT / 'bin/backup/restic'
RCLONE = ROOT / 'bin/backup/rclone'
LOCAL = WORK / 'repository'
REMOTE = 'rclone:ar_yandex:AUTO-REELZ-backups/autoreelz2026'
DOCKER = ['runuser','-u','autoreelz2026','--','env','XDG_RUNTIME_DIR=/run/user/1018','DOCKER_HOST=unix:///run/user/1018/docker.sock','PATH=/srv/autoreelz2026/bin:/usr/local/bin:/usr/bin:/bin','docker']
HOST = 'autoreelz2026'
TAG = 'autoreelz2026-complete'

class BackupError(Exception):
    pass

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def atomic_json(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.chmod(temp, mode)
    os.replace(temp, path)

def read_json(path, default=None):
    if not path.exists():
        return {} if default is None else default
    if path.is_symlink() or not path.is_file():
        raise BackupError('unsafe_state')
    return json.loads(path.read_text(encoding='utf-8'))

def status_update(**values):
    current = read_json(STATUS)
    current.update(version=1, updatedAt=now(), **values)
    atomic_json(STATUS, current, 0o644)

def execute(args, *, input=None, timeout=180, stdout=None, env=None):
    try:
        result = subprocess.run([str(a) for a in args], input=input, text=True, stdout=stdout or subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, env=env)
    except subprocess.TimeoutExpired as error:
        raise BackupError('command_timeout') from error
    if result.returncode:
        # Private diagnostic only; never forward stderr into manager or a public artifact.
        with (PRIVATE/'last-error.log').open('w', encoding='utf-8') as f:
            os.chmod(f.name, 0o600)
            f.write(result.stderr[-32000:])
        raise BackupError('command_failed')
    return (result.stdout or '').strip()

def docker(*args, **kw):
    return execute(DOCKER + list(args), **kw)

def sql(query, *, container=DB, user='ar_migrator', database=DATABASE):
    return docker('exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U',user,'-d',database,input="SET TIME ZONE 'UTC';\n"+query)

def require_regular_tree(path):
    if path.is_symlink() or not path.is_dir():
        raise BackupError('unsafe_source')
    for entry in path.rglob('*'):
        mode = entry.lstat().st_mode
        if not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise BackupError('unsafe_source')

def mirror(source, target):
    require_regular_tree(source)
    if target.is_symlink() or not str(target).startswith(str(WORK/'stage')+'/'):
        raise BackupError('unsafe_target')
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    execute(['rsync','-a','--delete','--no-owner','--no-group',str(source)+'/',str(target)+'/'], timeout=120)

def inventory(root):
    result = {}
    require_regular_tree(root)
    for path in sorted(root.rglob('*')):
        if path.is_file():
            h = hashlib.sha256()
            with path.open('rb') as f:
                for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
            result[str(path.relative_to(root))] = {'bytes':path.stat().st_size,'sha256':h.hexdigest()}
    return result

def verify_files(root, manifest):
    if manifest.get('format') != 1 or manifest.get('project') != PROJECT or manifest.get('database') != DATABASE or manifest.get('complete') is not True:
        raise BackupError('invalid_manifest')
    files = inventory(root)
    files.pop('manifest.json', None)
    if files != manifest['files']:
        raise BackupError('checksum_mismatch')

MEDIA_QUERY="SELECT json_build_object('files',(SELECT coalesce(json_agg(json_build_object('path',filename_disk,'bytes',filesize)),'[]') FROM directus_files WHERE storage='local' AND filename_disk IS NOT NULL),'images',(SELECT coalesce(json_agg(json_build_object('id',id,'kind',kind,'digest',digest,'originalDigest',original_digest)),'[]') FROM ar_ai_image_assets));"

def verify_media(root, refs):
    for item in refs['files']:
        filename=item['path']
        if pathlib.PurePosixPath(filename).is_absolute() or '..' in pathlib.PurePosixPath(filename).parts or not (root/'uploads'/filename).is_file():raise BackupError('restored_media_missing')
        if not isinstance(item['bytes'],int) or item['bytes']<0 or (root/'uploads'/filename).stat().st_size!=item['bytes']:raise BackupError('restored_media_size')
    for asset in refs['images']:
        if not re.fullmatch('[a-f0-9-]{36}',asset['id']):raise BackupError('restored_asset_invalid')
        expected={'webp':asset['digest']}
        if asset['kind']=='result':expected['png']=asset['originalDigest']
        for extension,digest in expected.items():
            file=root/'ai_image_assets/assets'/(asset['id']+'.'+extension)
            if not file.is_file() or hashlib.sha256(base64.b64encode(file.read_bytes())).hexdigest()!=digest:raise BackupError('restored_image_missing')

def fingerprints_query(names):
    if not names or any(not re.fullmatch('[a-z][a-z0-9_]*', n) for n in names):
        raise BackupError('unexpected_schema')
    parts = [f"SELECT '{n}' name,count(*) rows,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM public.\"{n}\" t" for n in names]
    return "SELECT json_object_agg(name,json_build_object('rows',rows,'digest',digest)) FROM ("+' UNION ALL '.join(parts)+') tables;'

class Snapshot:
    """Short write barrier. Connections/reads stay up; NOWAIT avoids deadlocking writers."""
    def __enter__(self):
        self.log = (PRIVATE/'snapshot-error.log').open('w', encoding='utf-8')
        os.chmod(self.log.name, 0o600)
        self.p = subprocess.Popen(DOCKER+['exec','-i',DB,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','ar_migrator','-d',DATABASE],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.log,text=True,bufsize=1)
        try:
            acquired=self.ask("SET TIME ZONE 'UTC'; SET statement_timeout='15s'; SET idle_in_transaction_session_timeout='20s'; SELECT pg_try_advisory_lock(320260900);")
            if acquired!='t':raise BackupError('migration_active')
            names=json.loads(self.ask("SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';"))
            if any(not re.fullmatch('[a-z][a-z0-9_]*',n) for n in names): raise BackupError('unexpected_schema')
            self.ask('BEGIN ISOLATION LEVEL REPEATABLE READ; LOCK TABLE '+','.join('public."'+n+'"' for n in names)+' IN SHARE MODE NOWAIT; SELECT 1;')
            if json.loads(self.ask("SELECT jsonb_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';"))!=names:raise BackupError('schema_changed')
            active=int(self.ask("SELECT (SELECT count(*) FROM ar_ai_image_jobs WHERE state IN ('queued','preparing','running'))+(SELECT count(*) FROM ar_ai_text_requests WHERE state='running');"))
            if active: raise BackupError('active_generation')
            self.snapshot=self.ask('SELECT pg_export_snapshot();')
            if not re.fullmatch('[0-9A-F-]+', self.snapshot):raise BackupError('invalid_snapshot')
            self.names=names
            return self
        except BaseException:
            self.__exit__(None,None,None)
            raise
    def ask(self, query):
        self.p.stdin.write(query+'\n');self.p.stdin.flush()
        sel=selectors.DefaultSelector();sel.register(self.p.stdout,selectors.EVENT_READ)
        try:
            if not sel.select(17):raise BackupError('snapshot_timeout')
            line=self.p.stdout.readline().strip()
            if not line:raise BackupError('snapshot_busy')
            return line
        finally:sel.close()
    def __exit__(self,*args):
        try:
            if self.p.poll() is None:
                self.p.stdin.write('ROLLBACK;\n\\q\n');self.p.stdin.flush();self.p.stdin.close();self.p.wait(timeout=5)
        except (BrokenPipeError,subprocess.TimeoutExpired):
            self.p.terminate()
        self.log.close()

def live_sources():
    web=json.loads(docker('inspect',PROJECT+'-web-1'))[0]
    revision=web['Config']['Labels']['org.opencontainers.image.revision']
    if not re.fullmatch('[a-f0-9]{40}',revision):raise BackupError('invalid_release')
    db=json.loads(docker('inspect',DB))[0]
    if db['Config']['Labels'].get('com.docker.compose.project')!=PROJECT:raise BackupError('wrong_project')
    sources={'release':ROOT/'releases'/revision,'public':ROOT/'public','origin-tls':pathlib.Path('/etc/ssl/autoreelz2026'),'backup-runner':ROOT/'ops/backup'}
    for suffix in ['uploads','ai_image_assets']:
        v=json.loads(docker('volume','inspect',PROJECT+'_'+suffix))[0]
        expected=ROOT/'.local/share/docker/volumes'/(PROJECT+'_'+suffix)/'_data'
        if pathlib.Path(v['Mountpoint'])!=expected:raise BackupError('unexpected_volume')
        sources[suffix]=expected
    image=db['Config']['Image']
    if not re.fullmatch(r'postgres:17\.\d+-alpine@sha256:[a-f0-9]{64}',image):raise BackupError('unexpected_postgres_image')
    if int(sql('SELECT pg_database_size(current_database());'))>1024**3:raise BackupError('database_needs_new_backup_plan')
    return revision,image,sources

def capture():
    stage=WORK/'stage'
    if stage.is_symlink():raise BackupError('unsafe_target')
    if stage.exists():shutil.rmtree(stage)
    stage.mkdir(mode=0o700)
    revision,image,sources=live_sources()
    for name,path in sources.items():mirror(path,stage/name)
    configuration=stage/'configuration';configuration.mkdir(mode=0o700)
    config_files={'server.env':ROOT/'shared/bootstrap/server.env','origin-nginx.conf':pathlib.Path('/etc/nginx/conf.d/autoreelz2026.conf')}
    for name,path in config_files.items():
        if path.is_symlink() or not path.is_file():raise BackupError('unsafe_configuration')
        shutil.copyfile(path,configuration/name);os.chmod(configuration/name,0o600)
    # Configuration changes outside PostgreSQL are detected before accepting the snapshot.
    config_hashes={name:hashlib.sha256((configuration/name).read_bytes()).hexdigest() for name in config_files}
    started=now();lock_start=time.monotonic()
    with Snapshot() as barrier:
        for name in ['uploads','ai_image_assets']:mirror(sources[name],stage/name)
        with (stage/'database.dump').open('wb') as f:
            docker('exec',DB,'pg_dump','-U','ar_migrator','-d',DATABASE,'-Fc','--snapshot='+barrier.snapshot,'--lock-wait-timeout=3s',stdout=f,timeout=15)
        tables=json.loads(barrier.ask(fingerprints_query(barrier.names)))
        media=json.loads(barrier.ask(MEDIA_QUERY))
        migrations=json.loads(barrier.ask('SELECT jsonb_agg(t ORDER BY name) FROM ar_migrations t;'))
        if live_sources()[0]!=revision:raise BackupError('release_changed')
        if any(hashlib.sha256(path.read_bytes()).hexdigest()!=config_hashes[name] for name,path in config_files.items()):raise BackupError('configuration_changed')
    write_barrier=time.monotonic()-lock_start
    with (stage/'roles.sql').open('wb') as f:docker('exec',DB,'pg_dumpall','-U','ar_migrator','--roles-only',stdout=f)
    with (stage/'database.dump').open('rb') as f:
        result=subprocess.run(DOCKER+['exec','-i',DB,'pg_restore','--list'],stdin=f,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        if result.returncode:raise BackupError('dump_invalid')
    verify_media(stage,media)
    manifest={'format':1,'project':PROJECT,'database':DATABASE,'id':uuid.uuid4().hex,'capturedAt':started,'revision':revision,'postgresImage':image,'tables':tables,'migrations':migrations,'writeBarrierSeconds':round(write_barrier,3),'files':inventory(stage),'complete':True}
    atomic_json(stage/'manifest.json',manifest)
    return manifest

def restic(repo,*args,timeout=1800):
    env={**os.environ,'RESTIC_PASSWORD_FILE':str(PRIVATE/'password'),'RESTIC_CACHE_DIR':str(WORK/'cache'),'RCLONE_CONFIG':str(PRIVATE/'rclone.conf'),'TZ':'Europe/Moscow'}
    return execute([RESTIC,'--repo',repo,'-o','rclone.program='+str(RCLONE),*args],timeout=timeout,env=env)

def repo_ids():
    return read_json(PRIVATE/'repositories.json')

def verify_repo(repo, key):
    expected=repo_ids().get(key)
    if not expected or json.loads(restic(repo,'cat','config'))['id']!=expected:raise BackupError('repository_identity')

def snapshots(repo, tag=TAG):
    return json.loads(restic(repo,'snapshots','--json','--host',HOST,'--tag',tag))

def copy_pending():
    pending_path=PRIVATE/'pending.json';pending=read_json(pending_path,[])
    for item in list(pending):
        verify_repo(REMOTE,'remote')
        restic(REMOTE,'copy','--from-repo',str(LOCAL),'--from-password-file',str(PRIVATE/'password'),item['localId'])
        copies=snapshots(REMOTE,'run:'+item['runId'])
        if len(copies)!=1:raise BackupError('remote_snapshot_missing')
        item['remoteId']=copies[0]['id']
        status_update(lastSuccessAt=item['capturedAt'],uploadedAt=now(),lastSnapshot=item['remoteId'],lastBytes=item['bytes'],revision=item['revision'],error=None)
        pending.remove(next(p for p in pending if p['runId']==item['runId']))
        atomic_json(pending_path,pending)

def recover_pending():
    """Recover a crash between encrypted local commit and recording its upload queue."""
    remote_runs={tag for s in snapshots(REMOTE) for tag in s.get('tags',[]) if tag.startswith('run:')}
    pending=read_json(PRIVATE/'pending.json',[])
    for s in snapshots(str(LOCAL)):
        runs=[t[4:] for t in s.get('tags',[]) if t.startswith('run:')]
        if len(runs)!=1 or not re.fullmatch('[a-f0-9]{32}',runs[0]):raise BackupError('invalid_local_snapshot')
        if 'run:'+runs[0] in remote_runs or any(p['runId']==runs[0] for p in pending):continue
        manifest=json.loads(restic(str(LOCAL),'dump',s['id'],str(WORK/'stage/manifest.json')))
        if manifest.get('project')!=PROJECT or manifest.get('complete') is not True:raise BackupError('invalid_manifest')
        pending.append({'runId':runs[0],'localId':s['id'],'capturedAt':manifest['capturedAt'],'bytes':sum(f['bytes'] for f in manifest['files'].values()),'revision':manifest['revision']})
    atomic_json(PRIVATE/'pending.json',pending)

def local_capture():
    verify_repo(str(LOCAL),'local')
    status_update(state='running',lastAttemptAt=now(),error=None)
    manifest=capture()
    raw=restic(str(LOCAL),'backup',str(WORK/'stage'),'--host',HOST,'--tag',TAG,'--tag','run:'+manifest['id'],'--json')
    summary=next((json.loads(l) for l in reversed(raw.splitlines()) if l.startswith('{') and json.loads(l).get('message_type')=='summary'),None)
    if not summary or not re.fullmatch('[a-f0-9]{8,64}',summary.get('snapshot_id','')):raise BackupError('local_snapshot_missing')
    pending=read_json(PRIVATE/'pending.json',[])
    pending.append({'runId':manifest['id'],'localId':summary['snapshot_id'],'capturedAt':manifest['capturedAt'],'bytes':sum(f['bytes'] for f in manifest['files'].values()),'revision':manifest['revision']})
    atomic_json(PRIVATE/'pending.json',pending)
    status_update(lastLocalAt=manifest['capturedAt'],writeBarrierSeconds=manifest['writeBarrierSeconds'])
    shutil.rmtree(WORK/'stage')

def capture_only():
    local_capture()
    status_update(state='error',error='offsite_pending')

def capture_due(current=None):
    """Retry uploads without creating another snapshot in the same hourly timer slot."""
    current=current or datetime.datetime.now(datetime.timezone.utc)
    value=read_json(STATUS).get('lastLocalAt')
    try:previous=datetime.datetime.fromisoformat(value)
    except (TypeError,ValueError):return True
    if previous.tzinfo is None:return True
    return int((previous.timestamp()-17*60)//3600)!=int((current.timestamp()-17*60)//3600)

def backup():
    status_update(state='running',lastAttemptAt=now(),error=None)
    verify_repo(str(LOCAL),'local')
    # A cloud outage must not prevent a fresh encrypted local copy.
    if capture_due():local_capture()
    verify_repo(REMOTE,'remote')
    recover_pending()
    copy_pending()
    status_update(state='ok',error=None)


def restore_drill(repo=REMOTE):
    external=repo==REMOTE
    verify_repo(repo,'remote' if external else 'local')
    status_update(state='verifying',error=None,lastVerificationAttemptAt=now())
    candidates=snapshots(repo)
    if not candidates:raise BackupError('no_remote_snapshot')
    latest=max(candidates,key=lambda s:s['time']);sid=latest['id']
    if not re.fullmatch('[a-f0-9]{64}',sid):raise BackupError('invalid_snapshot')
    scratch=WORK/('restore-'+uuid.uuid4().hex);scratch.mkdir(mode=0o700)
    name='autoreelz2026-backup-drill-'+uuid.uuid4().hex[:12];created=False
    try:
        restic(repo,'check','--read-data',timeout=3600)
        restic(repo,'restore',sid,'--target',str(scratch),timeout=1800)
        source=scratch/str(WORK/'stage').lstrip('/')
        manifest=read_json(source/'manifest.json');verify_files(source,manifest)
        image=manifest['postgresImage']
        if not re.fullmatch(r'postgres:17\.\d+-alpine@sha256:[a-f0-9]{64}',image):raise BackupError('unexpected_postgres_image')
        environment={**os.environ,'POSTGRES_USER':'ar_restore_admin','POSTGRES_PASSWORD':uuid.uuid4().hex+uuid.uuid4().hex,'POSTGRES_DB':'postgres'}
        # Inherit only these named values; no password in argv or root-owned stdin file.
        docker('create','--name',name,'--network','none','--label','autoreelz.backup-drill='+name,'--env','POSTGRES_USER','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB','--memory','512m','--cpus','1',image,env=environment);created=True;docker('start',name)
        ready=False
        for _ in range(80):
            try:docker('exec',name,'pg_isready','-h','127.0.0.1','-U','ar_restore_admin');ready=True;break
            except BackupError:time.sleep(.25)
        if not ready:raise BackupError('restore_database_not_ready')
        sql((source/'roles.sql').read_text(),container=name,user='ar_restore_admin',database='postgres')
        sql('CREATE DATABASE ar_backup_restore OWNER ar_migrator;',container=name,user='ar_restore_admin',database='postgres')
        with (source/'database.dump').open('rb') as f:
            result=subprocess.run(DOCKER+['exec','-i',name,'pg_restore','--exit-on-error','--single-transaction','-U','ar_restore_admin','-d','ar_backup_restore'],stdin=f,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=180)
            if result.returncode:raise BackupError('restore_database_failed')
        tables=json.loads(sql(fingerprints_query(sorted(manifest['tables'])),container=name,user='ar_restore_admin',database='ar_backup_restore'))
        if tables!=manifest['tables']:raise BackupError('restored_tables_mismatch')
        verify_media(source,json.loads(sql(MEDIA_QUERY,container=name,user='ar_restore_admin',database='ar_backup_restore')))
        grants=json.loads(sql("SELECT json_build_object('appReadsCatalog',has_table_privilege('ar_app','ar_products','SELECT'),'appCannotDeleteVehicles',NOT has_table_privilege('ar_app','ar_vehicles','DELETE'),'cmsCannotWriteStock',NOT has_table_privilege('ar_cms','ar_stock','UPDATE'));",container=name,user='ar_restore_admin',database='ar_backup_restore'))
        if not all(grants.values()):raise BackupError('restored_grants_mismatch')
        saved_env={line.split('=',1)[0]:line.split('=',1)[1].strip() for line in (source/'configuration/server.env').read_text().splitlines() if '=' in line and not line.lstrip().startswith('#')}
        password=saved_env.get('APP_DB_PASSWORD','')
        if len(password)>1 and password[0]==password[-1] and password[0] in ['"',"'"]:password=password[1:-1]
        if not password or '\n' in password:raise BackupError('restored_credentials_missing')
        identity=docker('exec','-i',name,'sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U ar_app -d ar_backup_restore -c "SELECT current_user"',input=password+'\n')
        if identity!='ar_app':raise BackupError('restored_credentials_failed')
        report={'verifiedAt':now(),'snapshot':sid,'tables':len(tables),'rows':sum(t['rows'] for t in tables.values()),'files':len(manifest['files']),'grants':grants,'appCredentialsVerified':True,'isolated':True,'licensedCmsStarted':False,'external':external}
        atomic_json(PRIVATE/('verified-recovery.json' if external else 'local-verified-recovery.json'),report)
        if external:status_update(state='ok',lastVerifiedAt=report['verifiedAt'],verifiedSnapshot=sid,error=None,verificationError=None)
        else:status_update(state='error',lastLocalVerifiedAt=report['verifiedAt'],error='offsite_pending')
    finally:
        if created:
            actual=json.loads(docker('inspect',name))[0]
            if actual['Config']['Labels'].get('autoreelz.backup-drill')!=name:raise BackupError('restore_cleanup_guard')
            docker('rm','-f','-v',name)
        if scratch.parent==WORK and scratch.name.startswith('restore-'):shutil.rmtree(scratch)


def retention():
    if not read_json(PRIVATE/'verified-recovery.json').get('verifiedAt'):raise BackupError('recovery_not_verified')
    if read_json(PRIVATE/'pending.json',[]):raise BackupError('pending_uploads')
    verify_repo(REMOTE,'remote');verify_repo(str(LOCAL),'local')
    restic(REMOTE,'forget','--host',HOST,'--tag',TAG,'--group-by','host,paths','--keep-hourly','24','--keep-daily','7','--keep-weekly','4','--keep-monthly','3','--prune',timeout=3600)
    restic(str(LOCAL),'forget','--host',HOST,'--tag',TAG,'--group-by','host,paths','--keep-last','3','--prune',timeout=1800)
    status_update(lastRetentionAt=now())

def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['backup','verify','retention','capture','verify-local']);args=parser.parse_args()
    if os.geteuid()!=0 or not ROOT.is_dir():raise BackupError('wrong_host_or_user')
    for path in [PRIVATE,WORK,STATUS.parent]:
        if path.is_symlink():raise BackupError('unsafe_root')
        path.mkdir(parents=True,exist_ok=True)
    os.chmod(PRIVATE,0o700);os.chmod(WORK,0o700);os.chmod(STATUS.parent,0o755)
    with (PRIVATE/'run.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return 75
        try:
            if shutil.disk_usage(WORK).free<3*1024**3:raise BackupError('low_disk')
            {'backup':backup,'verify':restore_drill,'retention':retention,'capture':capture_only,'verify-local':lambda:restore_drill(str(LOCAL))}[args.action]()
        except BaseException as error:
            code=str(error) if isinstance(error,BackupError) else 'unexpected_failure'
            diagnostic=PRIVATE/'pipeline-error.log'
            diagnostic.write_text(traceback.format_exc(),encoding='utf-8');os.chmod(diagnostic,0o600)
            status_update(state='error',error=code,lastFailureAt=now(),**({'verificationError':code} if args.action=='verify' else {}))
            print(json.dumps({'ok':False,'action':args.action,'code':code}),flush=True)
            return 1
        finally:
            stage=WORK/'stage'
            if stage.exists() and not stage.is_symlink():shutil.rmtree(stage)
        print(json.dumps({'ok':True,'action':args.action}),flush=True)
        return 0

if __name__=='__main__':sys.exit(main())
