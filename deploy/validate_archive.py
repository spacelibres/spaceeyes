"""Reject deployment archives that can escape their release directory."""
import posixpath
import sys
import tarfile

REQUIRED = {
    "web/server.js", "web/.next/BUILD_ID", "web/public/wasm/spaceeyes_core_bg.wasm",
    "web/node_modules/@loaders.gl/textures/package.json",
    "web/node_modules/@loaders.gl/textures/dist/index.cjs",
    "web/node_modules/@loaders.gl/textures/dist/libs/basis_encoder.js",
    "web/node_modules/@loaders.gl/textures/dist/libs/basis_encoder.wasm",
}
MAX_UNPACKED = 1024 * 1024 * 1024


def validate(path):
    seen, total = set(), 0
    with tarfile.open(path, "r:gz") as archive:
        for item in archive:
            name = item.name
            if name.startswith("/") or "\\" in name or "\n" in name:
                raise ValueError("Invalid archive path")
            parts = name.split("/")
            if ".." in parts or not (item.isfile() or item.isdir()):
                raise ValueError("Unsafe archive entry")
            clean = posixpath.normpath(name)
            if clean in seen:
                raise ValueError("Duplicate archive entry")
            seen.add(clean)
            total += item.size
            if total > MAX_UNPACKED:
                raise ValueError("Archive exceeds unpacked budget")
    if not REQUIRED.issubset(seen):
        raise ValueError("Incomplete deployment package")


if __name__ == "__main__":
    validate(sys.argv[1])
