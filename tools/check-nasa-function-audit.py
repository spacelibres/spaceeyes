"""Validate the source-comparison ledger without claiming runtime parity."""
import argparse
import collections
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--nasa-root", type=Path)
args = parser.parse_args()
base = Path(__file__).resolve().parents[1]
folder = base / "docs/evidence/function-audit-0.0.69"
allowed = {"different", "missing", "source-compared", "verified", "not-applicable"}
total = collections.Counter()
sources = {}
for name in ("camera-selection.json", "time-data.json", "render-resources.json"):
    data = json.loads((folder / name).read_text(encoding="utf-8-sig"))
    assert data["baseline"] == "36b6cac55", name
    rows = data.get("entries", data.get("functions"))
    assert rows, name
    for row in rows:
        for key in ("nasaFile", "nasaSymbol", "status", "evidence"):
            assert isinstance(row.get(key), str) and row[key].strip(), (name, key)
        counterpart = row.get("ours")
        assert (isinstance(counterpart, str) and counterpart.strip()) or (
            isinstance(counterpart, dict) and counterpart.get("path") and counterpart.get("function")
        ), (name, "ours")
        assert row["status"] in allowed, (name, row["status"])
        relative = Path(row["nasaFile"])
        assert not relative.is_absolute() and ".." not in relative.parts
        if args.nasa_root:
            source = args.nasa_root / relative
            assert source.is_file(), str(source)
            if row.get("nasaLine"):
                assert 1 <= row["nasaLine"] <= len(source.read_text(encoding="utf-8-sig").splitlines())
            sources[row["nasaFile"]] = hashlib.sha256(source.read_bytes()).hexdigest()
    counts = collections.Counter(row["status"] for row in rows)
    total.update(counts)
    print(name, len(rows), dict(counts))
print("Total comparison records (not unique functions or completed features):", sum(total.values()))
print("Statuses:", dict(total))
if args.nasa_root:
    print("Local source files verified:", len(sources))
    print("Source set SHA256:", hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest())
