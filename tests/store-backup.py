import base64,hashlib,importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('backup',pathlib.Path(__file__).parents[1]/'scripts/backup/store_backup.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class BackupTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def manifest(self,path):return {'format':1,'project':b.PROJECT,'database':b.DATABASE,'complete':True,'files':b.inventory(path)}
 def test_corrupt_and_missing_files_are_rejected(self):
  (self.root/'database.dump').write_bytes(b'original');manifest=self.manifest(self.root);b.verify_files(self.root,manifest)
  (self.root/'database.dump').write_bytes(b'changed')
  with self.assertRaisesRegex(b.BackupError,'checksum'):b.verify_files(self.root,manifest)
  (self.root/'database.dump').unlink()
  with self.assertRaisesRegex(b.BackupError,'checksum'):b.verify_files(self.root,manifest)
 def test_symlinks_and_unexpected_manifests_are_rejected(self):
  (self.root/'escape').symlink_to('/tmp')
  with self.assertRaisesRegex(b.BackupError,'unsafe_source'):b.inventory(self.root)
  with self.assertRaisesRegex(b.BackupError,'invalid_manifest'):b.verify_files(self.root,{'format':1,'project':'another-project','complete':True})
 def test_both_ai_formats_and_original_uploads_are_required(self):
  assets=self.root/'ai_image_assets/assets';assets.mkdir(parents=True);(self.root/'uploads').mkdir();(self.root/'uploads/photo.webp').write_bytes(b'photo')
  aid='11111111-1111-4111-8111-111111111111';webp=b'webp';png=b'png';(assets/(aid+'.webp')).write_bytes(webp);(assets/(aid+'.png')).write_bytes(png)
  refs={'files':['photo.webp'],'images':[{'id':aid,'kind':'result','digest':hashlib.sha256(base64.b64encode(webp)).hexdigest(),'originalDigest':hashlib.sha256(base64.b64encode(png)).hexdigest()}]};b.verify_media(self.root,refs)
  (assets/(aid+'.png')).unlink()
  with self.assertRaisesRegex(b.BackupError,'restored_image_missing'):b.verify_media(self.root,refs)
  with self.assertRaisesRegex(b.BackupError,'restored_media_missing'):b.verify_media(self.root,{'files':['../secret'],'images':[]})
 def test_retention_requires_verified_restore_and_no_pending_upload(self):
  with patch.object(b,'PRIVATE',self.root),patch.object(b,'restic') as run:
   with self.assertRaisesRegex(b.BackupError,'recovery_not_verified'):b.retention()
   b.atomic_json(self.root/'verified-recovery.json',{'verifiedAt':'2026-10-14'})
   b.atomic_json(self.root/'pending.json',[{'runId':'pending'}])
   with self.assertRaisesRegex(b.BackupError,'pending_uploads'):b.retention()
   run.assert_not_called()
 def test_retention_is_scoped_and_ignores_individual_run_tags(self):
  with patch.object(b,'PRIVATE',self.root),patch.object(b,'verify_repo'),patch.object(b,'status_update'),patch.object(b,'restic') as run:
   b.atomic_json(self.root/'verified-recovery.json',{'verifiedAt':'2026-10-14'});b.retention();self.assertEqual(run.call_count,2)
   for call in run.call_args_list:
    self.assertIn('--host',call.args);self.assertIn(b.HOST,call.args);self.assertIn(b.TAG,call.args);self.assertIn('host,paths',call.args)
   self.assertEqual(run.call_args_list[0].args[0],b.REMOTE)
 def test_failure_keeps_last_success_and_separate_restore_error(self):
  with patch.object(b,'STATUS',self.root/'status.json'):
   b.status_update(state='ok',lastSuccessAt='2026-10-14T11:00:00Z');b.status_update(state='error',verificationError='checksum_mismatch');b.status_update(state='ok',error=None)
   value=b.read_json(self.root/'status.json');self.assertEqual(value['lastSuccessAt'],'2026-10-14T11:00:00Z');self.assertEqual(value['verificationError'],'checksum_mismatch')
 def test_wrong_repository_stops_before_mutation(self):
  with patch.object(b,'repo_ids',return_value={'remote':'expected'}),patch.object(b,'restic',return_value='{"id":"wrong"}') as run:
   with self.assertRaisesRegex(b.BackupError,'repository_identity'):b.verify_repo(b.REMOTE,'remote')
   self.assertEqual(run.call_args.args,(b.REMOTE,'cat','config'))
 def test_schema_identifiers_cannot_inject_commands(self):
  with self.assertRaisesRegex(b.BackupError,'unexpected_schema'):b.fingerprints_query(['table; DROP DATABASE postgres'])
if __name__=='__main__':unittest.main()
