import importlib.util
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("validator", Path(__file__).parents[1] / "validate_archive.py")
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ArchiveTest(unittest.TestCase):
    def archive(self, name, *, link=False):
        temp = tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False)
        temp.close()
        self.addCleanup(Path(temp.name).unlink, missing_ok=True)
        with tarfile.open(temp.name, "w:gz") as archive:
            for entry in ["web/server.js", "web/.next/BUILD_ID", "web/public/wasm/spaceeyes_core_bg.wasm", name]:
                info = tarfile.TarInfo(entry)
                if entry == name and link:
                    info.type, info.linkname = tarfile.SYMTYPE, "../../etc/passwd"
                    archive.addfile(info)
                else:
                    info.size = 1
                    archive.addfile(info, io.BytesIO(b"x"))
        return temp.name

    def test_valid_archive_and_traversal_and_symlink_rejection(self):
        validator.validate(self.archive("web/public/icon.svg"))
        with self.assertRaises(ValueError):
            validator.validate(self.archive("../../escape"))
        with self.assertRaises(ValueError):
            validator.validate(self.archive("web/link", link=True))


if __name__ == "__main__":
    unittest.main()
