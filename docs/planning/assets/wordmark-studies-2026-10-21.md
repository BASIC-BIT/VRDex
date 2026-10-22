# Historical wordmark studies (2026-10-21)

The [ZIP archive](./wordmark-studies-2026-10-21.zip) preserves all 198 files from
nine historical study directories at commit
`bda7c65da2793b0832d066336da7bb62e819ec9d`. Every README, script, SVG, PNG,
manifest and license retains its original bytes and full repository-relative
path. The studies are bundled to keep the pull request within the automated
review input limits. The approved [canonical wordmark](../../brand/wordmark/README.md)
and current homepage/organizer concept assets remain outside this archive.

The archive contains 3,110,106 payload bytes and is 3,154,232 bytes long.
Its SHA-256 is
`5d27da654a04390309dae7bea7d3d3d08eae72831e28748596f5ceadd69d4da2`.
The [SHA-256 inventory](./wordmark-studies-2026-10-21.sha256) lists every member;
its own SHA-256 is
`74a4f1cbbdc6a3e7b539d60f8dcc0b0ab74392b54be567547e9f3f9aa261b16c`.
All 198 members were extracted and compared byte for byte with the originals
before the source directories were removed from the working tree.

## Contents

Directory paths below are relative to `docs/planning/assets/` inside the ZIP.
Each directory contains its original `README.md`, which describes the study
and links to its artifacts. Relative links between archived studies work after
extracting the complete archive.

| Directory | Files | Study |
| --- | ---: | --- |
| `wordmark-study-2026-10-21` | 15 | Initial outlined wordmarks and color comparison |
| `wordmark-stroke-study-2026-10-21` | 36 | Stroke removal and shared-stroke variants |
| `wordmark-dex-study-2026-10-21` | 36 | DEX letterform variants |
| `wordmark-dx-study-2026-10-21` | 33 | Combined D/X variants |
| `wordmark-d-angle-study-2026-10-21` | 21 | D cut angles and geometry helpers |
| `wordmark-refined-2026-10-21` | 12 | Refined selected letterforms |
| `wordmark-matched-gaps-2026-10-21` | 12 | Matched D/X gap widths |
| `wordmark-spacing-study-2026-10-21` | 21 | Letter-spacing variants |
| `wordmark-spacing-refined-2026-10-21` | 12 | Approved final spacing and exports |

## Approved source

The approved source directory is
`docs/planning/assets/wordmark-spacing-refined-2026-10-21/` inside the archive.
Its `README.md`, `build_refined_spacing.py` and `manifest.json` retain their
original names and bytes. The canonical manifest's `source_study` is this
archive member prefix; `source_archive` identifies the ZIP. Its existing
`source_manifest_sha256` still identifies the unchanged archived manifest.
Canonical geometry, exports, previews and license bytes are unchanged.

## Extract and verify

From the repository root, extract into a separate directory and verify all
198 files with the supplied inventory:

```sh
repo_root="$PWD"
study_root="$(mktemp -d)"
unzip "$repo_root/docs/planning/assets/wordmark-studies-2026-10-21.zip" -d "$study_root"
(cd "$study_root" && sha256sum -c "$repo_root/docs/planning/assets/wordmark-studies-2026-10-21.sha256")
```

Open the extracted READMEs locally to inspect the original studies. To run their
generation scripts, extract into a repository checkout with the dependencies
and font specified by those READMEs; no dependency or font is installed by the
archive. The scripts' repository-relative imports and source paths are preserved.

## Deterministic packaging

Members are sorted by full path, stored without compression, and use the fixed
ZIP timestamp `2026-10-21 00:00:00`, Unix regular-file mode `0644`, and no extra
fields or archive comment. This avoids compression-version and filesystem-time
differences. After restoring the members at their original repository paths,
the following Python 3 command rebuilds the same archive bytes:

```python
from hashlib import sha256
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_STORED

base = Path("docs/planning/assets/wordmark-studies-2026-10-21")
entries = [line.split("  ", 1) for line in base.with_suffix(".sha256").read_text().splitlines()]
assert len(entries) == 198
with ZipFile(base.with_suffix(".zip"), "w", compression=ZIP_STORED) as archive:
    for expected, path in sorted(entries, key=lambda entry: entry[1]):
        data = Path(path).read_bytes()
        assert sha256(data).hexdigest() == expected, path
        member = ZipInfo(path, date_time=(2026, 10, 21, 0, 0, 0))
        member.create_system = 3
        member.external_attr = 0o100644 << 16
        member.compress_type = ZIP_STORED
        archive.writestr(member, data)
```
