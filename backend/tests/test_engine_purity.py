"""The engine must stay pure (no web, database or file access) so it can be ported to TypeScript."""

import ast
from pathlib import Path

import wsf_tournament.engine as engine

FORBIDDEN = {"fastapi", "sqlite3", "os", "pathlib", "starlette", "pydantic", "time", "datetime"}


def test_engine_imports_nothing_impure():
    for path in Path(engine.__file__).parent.glob("*.py"):
        for node in ast.walk(ast.parse(path.read_text())):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0:
                names = [node.module]
            for name in names:
                assert name.split(".")[0] not in FORBIDDEN, f"{path.name} imports {name}"
