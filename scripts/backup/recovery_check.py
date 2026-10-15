#!/usr/bin/env python3
"""Explicit offsite restore check in disposable, network-isolated containers.
Never captures/restores production, starts workers/CMS, changes timers or live status.
Run only on the store's deployment host; reports contain no restored row/file contents.
"""
import argparse,fcntl,hashlib,importlib.util,json,os,pathlib,re,secrets,shutil,signal,subprocess,time,traceback,uuid

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--run-isolated',action='store_true');parser.add_argument('--reuse-read-check-report');args=parser.parse_args()
    if not args.run_isolated or os.geteuid()!=0:raise SystemExit('Explicit --run-isolated as deployment root required')
    spec=importlib.util.spec_from_file_location('backup','/opt/autoreelz2026-backup/runner/store_backup.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
    started=time.monotonic();name='autoreelz2026-recovery-'+uuid.uuid4().hex[:12]
    root=b.WORK/name;root.mkdir(mode=0o700);report_path=b.PRIVATE/(name+'.json')
    image='autoreelz2026-recovery:'+name;volume=name+'-uploads';db=name+'-db';web=name+'-web';copy_name=name+'-copy';created=[];made_volume=False;made_image=False;made_builder=False
    report={'isolated':True,'external':True,'licensedCmsStarted':False,'workersStarted':False,'productionMutations':False,'startedAt':b.now()}
    def progress(step):print(json.dumps({'step':step}),flush=True)
    def exec_safe(command,*,input=None,timeout=180,stdout=None,env=None):
        r=subprocess.run([str(a) for a in command],input=input,text=True,stdout=stdout or subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,env=env)
        if r.returncode:
            p=root/'command-error.log';p.write_text((r.stdout or '')[-16000:]+'\n'+r.stderr[-16000:]);os.chmod(p,0o600);raise b.BackupError('recovery_command_failed')
        return (r.stdout or '').strip()
    b.execute=exec_safe
    def interrupted(_signal,_frame):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,interrupted)
    def tar_pipeline(source,command,log_path,timeout):
        with log_path.open('wb') as log:
            tar=subprocess.Popen(['tar','-C',str(source),'-cf','-','.'],stdout=subprocess.PIPE,stderr=log)
            try:
                result=subprocess.run(command,stdin=tar.stdout,stdout=log,stderr=subprocess.STDOUT,timeout=timeout)
                tar.stdout.close();tar.wait(timeout=30)
                if result.returncode or tar.returncode:raise b.BackupError('recovery_pipeline_failed')
            finally:
                if tar.poll() is None:tar.terminate()
                try:tar.wait(timeout=5)
                except subprocess.TimeoutExpired:tar.kill();tar.wait()
    def inspect_production():
        values=json.loads(b.docker('inspect',*[b.PROJECT+'-'+s+'-1' for s in ['web','worker','image-worker','edge','cms','db','background']]))
        return {v['Name']:{'id':v['Id'],'startedAt':v['State']['StartedAt'],'image':v['Image']} for v in values}
    baseline=inspect_production();env_path=b.ROOT/'shared/bootstrap/server.env';env_hash=hashlib.sha256(env_path.read_bytes()).hexdigest()
    try:
        with (b.PRIVATE/'run.lock').open('a') as lock:
            progress('waiting_for_existing_backup_lock')
            deadline=time.monotonic()+1200
            while True:
                try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                except BlockingIOError:
                    if time.monotonic()>deadline:raise b.BackupError('backup_still_busy')
                    time.sleep(5)
            if shutil.disk_usage(root).free<5*1024**3:raise b.BackupError('insufficient_isolated_restore_space')
            b.verify_repo(b.REMOTE,'remote');candidates=b.snapshots(b.REMOTE)
            if not candidates:raise b.BackupError('no_external_snapshot')
            snap=max(candidates,key=lambda s:s['time']);sid=snap['id']
            if not re.fullmatch('[a-f0-9]{64}',sid):raise b.BackupError('invalid_snapshot')
            report.update(snapshot=sid,snapshotTime=snap['time']);progress('offsite_repository_read_check')
            reused=False
            if args.reuse_read_check_report:
                if not re.fullmatch(r'autoreelz2026-recovery-[a-f0-9]{12}\.json',args.reuse_read_check_report):raise b.BackupError('invalid_prior_report')
                prior_path=b.PRIVATE/args.reuse_read_check_report;info=prior_path.lstat()
                if prior_path.is_symlink() or info.st_uid!=0 or info.st_mode&0o077:raise b.BackupError('unsafe_prior_report')
                prior=b.read_json(prior_path);age=time.time()-b.datetime.datetime.fromisoformat(prior['finishedAt']).timestamp()
                if prior.get('snapshot')!=sid or prior.get('external') is not True or prior.get('repositoryReadCheck') is not True or not 0<=age<=3600:raise b.BackupError('prior_read_check_not_applicable')
                reused=True;report['repositoryReadCheckReusedFrom']=args.reuse_read_check_report
            if not reused:b.restic(b.REMOTE,'check','--read-data',timeout=3600)
            progress('restore_offsite_snapshot')
            b.restic(b.REMOTE,'restore',sid,'--target',str(root/'snapshot'),'--verify',timeout=1800)
            source=root/'snapshot'/b.snapshot_root(snap).lstrip('/');manifest=b.read_json(source/'manifest.json');b.verify_files(source,manifest)
            report.update(revision=manifest['revision'],capturedAt=manifest['capturedAt'],files=len(manifest['files']),fileManifestMatched=True,repositoryReadCheck=True,offsitePhaseSeconds=round(time.monotonic()-started,1))
            # Remote reads are complete; the regular hourly backup need not wait for app QA.
            b.stop_transport();fcntl.flock(lock,fcntl.LOCK_UN)
        progress('restore_postgresql_without_network')
        pgimage=manifest['postgresImage']
        if not re.fullmatch(r'postgres:17\.\d+-alpine@sha256:[a-f0-9]{64}',pgimage):raise b.BackupError('unexpected_postgres_image')
        env={**os.environ,'POSTGRES_USER':'ar_restore_admin','POSTGRES_PASSWORD':secrets.token_hex(32),'POSTGRES_DB':'postgres'}
        b.docker('create','--name',db,'--network','none','--label','autoreelz.recovery-check='+name,'--env','POSTGRES_USER','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB','--memory','512m','--cpus','1',pgimage,env=env);created.append(db);b.docker('start',db)
        for n in range(100):
            try:b.docker('exec',db,'pg_isready','-h','127.0.0.1','-U','ar_restore_admin');break
            except b.BackupError:
                if n==99:raise
                time.sleep(.2)
        def sql(s):return b.sql(s,container=db,user='ar_restore_admin',database='ar_qa_recovery_restore')
        b.sql((source/'roles.sql').read_text(),container=db,user='ar_restore_admin',database='postgres')
        b.sql('CREATE DATABASE ar_qa_recovery_restore OWNER ar_migrator;',container=db,user='ar_restore_admin',database='postgres')
        with (source/'database.dump').open('rb') as f:
            result=subprocess.run(b.DOCKER+['exec','-i',db,'pg_restore','--exit-on-error','--single-transaction','-U','ar_restore_admin','-d','ar_qa_recovery_restore'],stdin=f,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=240)
            if result.returncode:raise b.BackupError('restore_database_failed')
        tables=json.loads(sql(b.fingerprints_query(sorted(manifest['tables']))));assert tables==manifest['tables'],'restored_table_fingerprints_mismatch'
        b.verify_media(source,json.loads(sql(b.MEDIA_QUERY)))
        migrations=json.loads(sql('SELECT jsonb_agg(t ORDER BY name) FROM ar_migrations t;'));assert migrations==manifest['migrations'],'migration_checksums_mismatch'
        grants=json.loads(sql("SELECT json_build_object('appReadsCatalog',has_table_privilege('ar_app','ar_products','SELECT'),'cmsCannotWriteStock',NOT has_table_privilege('ar_cms','ar_stock','UPDATE'),'appCannotDeleteVehicles',NOT has_table_privilege('ar_app','ar_vehicles','DELETE'));"));assert all(grants.values())
        saved={l.split('=',1)[0]:l.split('=',1)[1].strip().strip('\"\'') for l in (source/'configuration/server.env').read_text().splitlines() if '=' in l and not l.lstrip().startswith('#')}
        password=saved.get('APP_DB_PASSWORD','');assert password and '\n' not in password
        identity=b.docker('exec','-i',db,'sh','-c','IFS= read -r PGPASSWORD; export PGPASSWORD; exec psql -XAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -U ar_app -d ar_qa_recovery_restore -c "SELECT current_user"',input=password+'\n');assert identity=='ar_app'
        report.update(tables=len(tables),tableFingerprintsMatched=True,migrations=len(migrations),migrationChecksumsMatched=True,mediaVerified=True,grants=grants,restoredCredentialsVerified=True)
        # The clone gets new credentials. No production secret enters the app container.
        qa_password=secrets.token_hex(32);sql("ALTER ROLE ar_app PASSWORD '"+qa_password+"';")
        del saved,password
        progress('build_application_from_restored_release')
        revision=manifest['revision'];assert re.fullmatch('[a-f0-9]{40}',revision)
        release=source/'release';assert (release/'Dockerfile').is_file() and (release/'package-lock.json').is_file()
        b.docker('buildx','create','--name',name,'--driver','docker-container','--driver-opt','memory=1g,memory-swap=1g,cpu-quota=100000,cpu-period=100000,restart-policy=no');made_builder=True
        tar_pipeline(release,b.DOCKER+['buildx','build','--builder',name,'--load','--build-arg','VCS_REF='+revision,'-t',image,'-'],root/'build.log',1200)
        made_image=True
        label=b.docker('image','inspect',image,'--format','{{index .Config.Labels "org.opencontainers.image.revision"}}');assert label==revision
        report['applicationBuiltFromBackup']=True
        b.docker('volume','create','--label','autoreelz.recovery-check='+name,volume);made_volume=True
        b.docker('create','--name',copy_name,'-i','--network','none','--user','root','--memory','256m','--cpus','1','--label','autoreelz.recovery-check='+name,'-v',volume+':/restore-uploads',image,'sh','-c','tar -xf - -C /restore-uploads && chown -R node:node /restore-uploads');created.append(copy_name)
        tar_pipeline(source/'uploads',b.DOCKER+['start','-ai',copy_name],root/'uploads-copy.log',180)
        appenv={'AR_DB_HOST':'127.0.0.1','AR_DB_PORT':'5432','AR_DATABASE_NAME':'ar_qa_recovery_restore','APP_DB_PASSWORD':qa_password,'APP_SECRET':secrets.token_hex(32),'APP_ORIGIN':'http://127.0.0.1:4321','STORE_MODE':'local-test','SEO_INDEXING_ENABLED':'false','CMS_INTERNAL_URL':'http://127.0.0.1:9','CMS_UPLOADS_PATH':'/cms-uploads','SHIPPING_PROVIDER':'simulation','PAYMENT_PROVIDER':'simulation','MAIL_PROVIDER':'simulation','YOOKASSA_LIVE_OPERATIONS_ENABLED':'false','CDEK_SHIPMENTS_MODE':'disabled','CDEK_SHIPMENTS_ALLOW_LIVE':'false','AI_TEXT_PROVIDER':'disabled','AI_IMAGE_PROVIDER':'disabled','METRIKA_ENABLED':'false','HOST':'127.0.0.1','PORT':'4321'}
        run=['create','--name',web,'--network','container:'+db,'--label','autoreelz.recovery-check='+name,'--memory','512m','--cpus','1','--read-only','--tmpfs','/tmp','-v',volume+':/cms-uploads:ro']
        for k in appenv:run+=['--env',k]
        b.docker(*run,image,env={**os.environ,**appenv});created.append(web);b.docker('start',web)
        progress('verify_isolated_storefront_and_image')
        js="""let healthy=false;for(let n=0;n<100;n++){try{if((await fetch('http://127.0.0.1:4321/health')).ok){healthy=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}if(!healthy)throw Error('health');const paths=['/','/catalog','/account','/robots.txt','/sitemap.xml'];let product=null,photo=null;for(const path of paths){const r=await fetch('http://127.0.0.1:4321'+path);if(!r.ok)throw Error('http');const s=await r.text();if(['/','/catalog','/account'].includes(path)&&!s.includes('noindex'))throw Error('indexing');if(path==='/catalog')product=s.match(/href=\"(\\/product\\/[^\"?]+)[^\"]*\"/)?.[1];if(path==='/robots.txt'&&!s.includes('Disallow: /'))throw Error('robots')}if(!product)throw Error('no_product');let r=await fetch('http://127.0.0.1:4321'+product),s=await r.text();if(!r.ok)throw Error('product');photo=s.match(/src=\"(\\/media\\/[a-f0-9-]+)/)?.[1];if(!photo)throw Error('no_photo');r=await fetch('http://127.0.0.1:4321'+photo);if(!r.ok||!(r.headers.get('content-type')??'').startsWith('image/'))throw Error('photo');const bytes=(await r.arrayBuffer()).byteLength;if(!bytes)throw Error('empty_photo');console.log(JSON.stringify({routes:7,health:true,catalog:true,product:true,photo:true,noindex:true}));"""
        appcheck=json.loads(b.docker('exec',web,'node','--input-type=module','-e',js,timeout=120))
        network=json.loads(b.docker('inspect',db,web));assert network[0]['HostConfig']['NetworkMode']=='none';assert network[1]['HostConfig']['NetworkMode'].startswith('container:');assert all(not x['HostConfig'].get('PortBindings') for x in network)
        report.update(applicationBuiltFromBackup=True,appCheck=appcheck,networkIsolated=True,hostPortsPublished=False,restorationVerified=True,passed=True)
    except BaseException as e:
        (root/'error.log').write_text(traceback.format_exc());os.chmod(root/'error.log',0o600);report.update(passed=False,error=str(e) if isinstance(e,b.BackupError) else type(e).__name__)
        progress('failed_see_private_report')
    finally:
        cleanup_errors=[]
        def cleanup_step(key,fn):
            try:fn()
            except BaseException:cleanup_errors.append(key)
        cleanup_step('transport',b.stop_transport)
        def remove_container(container):
            info=json.loads(b.docker('inspect',container))[0]
            if info['Config']['Labels'].get('autoreelz.recovery-check')!=name:raise b.BackupError('cleanup_identity')
            b.docker('rm','-f','-v',container)
        for container in reversed(created):cleanup_step(container,lambda c=container:remove_container(c))
        def remove_volume():
            info=json.loads(b.docker('volume','inspect',volume))[0];assert info['Labels'].get('autoreelz.recovery-check')==name;b.docker('volume','rm',volume)
        if made_volume:cleanup_step(volume,remove_volume)
        if made_image:cleanup_step('image',lambda:b.docker('image','rm',image))
        if made_builder:cleanup_step('builder',lambda:b.docker('buildx','rm','--force',name))
        try:
            report.update(productionContainersUnchanged=inspect_production()==baseline,productionEnvUnchanged=hashlib.sha256(env_path.read_bytes()).hexdigest()==env_hash)
        except BaseException:cleanup_errors.append('production_identity_check')
        report.update(elapsedSeconds=round(time.monotonic()-started,1),finishedAt=b.now(),cleanupErrors=cleanup_errors,testContainersRemoved=not cleanup_errors)
        report['passed']=report.get('passed',False) and not cleanup_errors and report.get('productionContainersUnchanged',False) and report.get('productionEnvUnchanged',False)
        try:
            # Private diagnostics only; never preserve the decrypted snapshot after a failure.
            if not report['passed']:
                for filename in ['error.log','command-error.log','build.log']:
                    if (root/filename).exists():shutil.copyfile(root/filename,b.PRIVATE/(name+'-'+filename));os.chmod(b.PRIVATE/(name+'-'+filename),0o600)
        finally:
            try:shutil.rmtree(root);report['decryptedScratchRemoved']=True
            except BaseException:report['decryptedScratchRemoved']=False;report['passed']=False
            b.atomic_json(report_path,report)
        print(json.dumps({'passed':report['passed'],'report':str(report_path),'elapsedSeconds':report['elapsedSeconds']}),flush=True)
    return 0 if report['passed'] else 1

if __name__=='__main__':raise SystemExit(main())
