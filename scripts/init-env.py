"""Create project-only local credentials without printing secrets."""
from pathlib import Path
import secrets
import os

root = Path(__file__).resolve().parents[1]
target = root / '.env'
if target.exists():
    lines = target.read_text().splitlines()
    current = {line.split('=', 1)[0]: line.split('=', 1)[1] for line in lines if '=' in line and not line.startswith('#')}
    added = 0
    for line in (root / '.env.example').read_text().splitlines():
        if '=' not in line or line.startswith('#'):
            continue
        key, value = line.split('=', 1)
        if key in current:
            continue
        if key.endswith('_PASSWORD') or key.endswith('_SECRET'):
            value = secrets.token_urlsafe(36)
        lines.append(key + '=' + value)
        added += 1
    if added:
        fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write('\n'.join(lines) + '\n')
    print(f'.env preserved; {added} missing settings added.')
else:
    lines = []
    for line in (root / '.env.example').read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            if key.endswith('_PASSWORD') or key.endswith('_SECRET'):
                value = secrets.token_urlsafe(36)
            line = key + '=' + value
        lines.append(line)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('Created private .env with independent credentials (mode 0600).')
