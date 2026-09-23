"""Install only the owner-provided static museum export on the dedicated server."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import shutil
import stat
import sys
import time
import xml.etree.ElementTree as ET
import zipfile

root = Path('/srv/autoreelz2026')
archive = Path(sys.argv[1]).resolve()
expected = sys.argv[2]
assert archive.is_relative_to(root / 'incoming')
assert len(expected) == 64 and all(c in '0123456789abcdef' for c in expected)
digest = hashlib.sha256()
with archive.open('rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        digest.update(chunk)
assert digest.hexdigest() == expected, 'Archive checksum mismatch'
owner = pwd.getpwnam('autoreelz2026')
public = root / 'public'
public.mkdir(mode=0o755, exist_ok=True)
temporary = public / f'.muzey-upload-{os.getpid()}'
temporary.mkdir(mode=0o755)
files = 0
total = 0
skipped = 0
try:
    with zipfile.ZipFile(archive) as source:
        assert sum(i.file_size for i in source.infolist()) < 1024 * 1024 * 1024
        seen = set()
        for item in source.infolist():
            path = PurePosixPath(item.filename)
            assert not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename
            assert not stat.S_ISLNK(item.external_attr >> 16)
            assert not item.flag_bits & 1, 'Encrypted entry unsupported'
            if path.parts[0] != 'muzey' or path.name == '.DS_Store' or path.name.startswith('._'):
                skipped += 1
                continue
            relative = path.relative_to('muzey')
            destination = temporary / str(relative)
            if item.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
                continue
            assert str(relative) not in seen, 'Duplicate file path'
            seen.add(str(relative))
            destination.parent.mkdir(parents=True, exist_ok=True)
            with source.open(item) as incoming, destination.open('xb') as target:
                shutil.copyfileobj(incoming, target)
            destination.chmod(0o644)
            os.chown(destination, owner.pw_uid, owner.pw_gid)
            files += 1
            total += item.file_size
    for name in ['index.html', 'pano.xml', 'pano2vr_player.js', 'skin.js']:
        assert (temporary / name).is_file(), f'Missing {name}'
    tour = ET.parse(temporary / 'pano.xml').getroot()
    nodes = [p.attrib['id'] for p in tour.findall('panorama')]
    assert nodes
    for path in [temporary] + [p for p in temporary.rglob('*') if p.is_dir()]:
        path.chmod(0o755)
        os.chown(path, owner.pw_uid, owner.pw_gid)
    destination = public / 'muzey'
    previous = None
    if destination.exists():
        backups = root / 'static-backups'
        backups.mkdir(mode=0o700, exist_ok=True)
        previous = backups / f'muzey-{time.time_ns()}'
        destination.rename(previous)
    try:
        temporary.rename(destination)
    except BaseException:
        if previous is not None:
            previous.rename(destination)
        raise
    report = {'archiveSha256': expected, 'fileCount': files, 'bytes': total,
              'skippedMetadataEntries': skipped, 'nodeIds': nodes,
              'directory': str(destination), 'url': 'https://autoreelz.ru/muzey/',
              'deployedAtUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'contentChanged': False, 'previousCopy': str(previous) if previous else None}
    (root / 'shared' / 'muzey-deployment.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
finally:
    if temporary.exists():
        shutil.rmtree(temporary)
