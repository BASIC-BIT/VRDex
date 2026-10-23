"""Independently compare a small BuildKit export with reviewed source and wheels.

No Docker operation, network access, or expected-image-generated hash authority.
Usage: python3 scripts/verify-restream-package.py EXPORT WHEELHOUSE OUTPUT_JSON
"""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
export, wheels, output = map(Path, sys.argv[1:])
paths = json.loads((root / 'workers/restream/packaging-manifest.json').read_text())
result = {'sources': {}, 'wheels': {}, 'installedFiles': {}}
for name in paths:
    expected, actual = root / name, export / 'app' / name
    assert expected.is_file() and actual.is_file() and not actual.is_symlink(), name
    assert expected.read_bytes() == actual.read_bytes(), name
    result['sources'][name] = hashlib.sha256(actual.read_bytes()).hexdigest()
assert not (export / 'app/workers/restream/broadcast-capacity.mjs').exists()
lock = json.loads((root / 'workers/restream/twitch-wheels.lock.json').read_text())
for row in lock['wheels']:
    if row['name'] == 'pip':
        continue
    wheel = wheels / row['filename']
    assert wheel.stat().st_size == row['bytes']
    assert hashlib.sha256(wheel.read_bytes()).hexdigest() == row['sha256']
    result['wheels'][row['filename']] = row['sha256']
    with zipfile.ZipFile(wheel) as archive:
        for item in archive.infolist():
            if item.is_dir() or '.data/' in item.filename or item.filename.endswith('/RECORD'):
                continue
            assert '..' not in Path(item.filename).parts and not item.filename.startswith('/')
            actual = export / 'opt/twitch' / item.filename
            assert actual.is_file() and not actual.is_symlink(), item.filename
            data = actual.read_bytes()
            assert data == archive.read(item), item.filename
            result['installedFiles'][item.filename] = hashlib.sha256(data).hexdigest()
output.write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
print(json.dumps({'verifiedSources': len(paths), 'verifiedWheelFiles': len(result['installedFiles'])}))
