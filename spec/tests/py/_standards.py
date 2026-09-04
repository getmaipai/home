"""Loads a generated module from the sibling @maipai/standards checkout by
explicit file path, rather than sys.path/pythonpath tricks. Both spec/gen/py
and standards/gen/py are conventionally named "gen.py.*", so adding both
directories to sys.path at once would collide; importlib.util avoids that
entirely by never registering a top-level "gen" package for the standards
side.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType

_DEFAULT_STANDARDS_DIR = Path(__file__).resolve().parents[4] / ".github"
STANDARDS_DIR = Path(os.environ.get("MAIPAI_STANDARDS_DIR", _DEFAULT_STANDARDS_DIR))


def load_standards_module(module_file_stem: str) -> ModuleType:
    """module_file_stem e.g. "error_entry_schema" for standards/gen/py/error_entry_schema.py."""
    path = STANDARDS_DIR / "standards" / "gen" / "py" / f"{module_file_stem}.py"
    if not path.exists():
        raise FileNotFoundError(
            f"missing @maipai/standards generated module at {path}; "
            "is the sibling .github checkout present and its gen-py.sh run?"
        )
    qualified_name = f"maipai_standards_gen_py_{module_file_stem}"
    spec = importlib.util.spec_from_file_location(qualified_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified_name] = module
    spec.loader.exec_module(module)
    return module
