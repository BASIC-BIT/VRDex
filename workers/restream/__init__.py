"""Activate the image's private wheels only inside worker Python processes.

Do not export PYTHONPATH: Debian awscli must retain its own urllib3/botocore
closure. Importing this package does not change child-process environments.
"""

from pathlib import Path
import sys

_dependencies = Path("/opt/twitch")
if _dependencies.is_dir():
    sys.path.insert(0, str(_dependencies))
