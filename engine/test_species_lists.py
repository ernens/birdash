#!/usr/bin/env python3
"""User inclusion / exclusion lists — unit tests.

Run: python -m pytest engine/test_species_lists.py -v
Or:  python engine/test_species_lists.py

The contract from Settings → Species:
  - exclude_species_list.txt drops species regardless of model / confidence
  - include_species_list.txt, when non-empty, acts as a whitelist
  - empty include = no whitelist (detect everything except exclude)
  - both apply BEFORE write_detection + clip extraction
  - hot-reload via file mtime so dashboard saves take effect on next WAV

These tests exercise the helper `_get_user_species_lists()` directly by
running it against a temporary base_dir, so we don't need TFLite, ffmpeg,
or any audio. The filtering logic itself is one branch in
_analyze_with_model and is small enough to read in the source — the
high-value tests are the hot-reload + parsing behavior.
"""

import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(__file__))


class _MinimalEngine:
    """Carries just the fields _get_user_species_lists touches."""
    def __init__(self, base_dir):
        self.base_dir = base_dir
        self._species_lists = {'include': set(), 'exclude': set()}
        self._species_lists_mtimes = None


def _bind_helper():
    from engine import BirdEngine
    return BirdEngine._get_user_species_lists


def _write(path, content):
    with open(path, 'w') as f:
        f.write(content)


class TestEmptyState(unittest.TestCase):
    """No files / empty files → empty sets, no whitelist behavior."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.eng = _MinimalEngine(self.tmp.name)
        self.helper = _bind_helper()

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_files(self):
        lists = self.helper(self.eng)
        self.assertEqual(lists['include'], set())
        self.assertEqual(lists['exclude'], set())

    def test_empty_files(self):
        _write(os.path.join(self.tmp.name, 'include_species_list.txt'), '')
        _write(os.path.join(self.tmp.name, 'exclude_species_list.txt'), '\n\n  \n')
        lists = self.helper(self.eng)
        self.assertEqual(lists['include'], set())
        self.assertEqual(lists['exclude'], set())


class TestParsing(unittest.TestCase):
    """Lines trimmed, blanks dropped, duplicates deduped via set."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.eng = _MinimalEngine(self.tmp.name)
        self.helper = _bind_helper()

    def tearDown(self):
        self.tmp.cleanup()

    def test_strips_whitespace(self):
        _write(os.path.join(self.tmp.name, 'exclude_species_list.txt'),
               '  Cygnus olor  \n\nHomo sapiens\n')
        lists = self.helper(self.eng)
        self.assertEqual(lists['exclude'], {'Cygnus olor', 'Homo sapiens'})

    def test_dedup(self):
        _write(os.path.join(self.tmp.name, 'include_species_list.txt'),
               'Pica pica\nPica pica\nTurdus merula\n')
        lists = self.helper(self.eng)
        self.assertEqual(lists['include'], {'Pica pica', 'Turdus merula'})


class TestHotReload(unittest.TestCase):
    """Mtime change → reread. No change → cache hit (no IO churn)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.eng = _MinimalEngine(self.tmp.name)
        self.helper = _bind_helper()

    def tearDown(self):
        self.tmp.cleanup()

    def test_picks_up_new_file(self):
        # First call: no files
        self.helper(self.eng)
        # Now write one and bump mtime
        exc_path = os.path.join(self.tmp.name, 'exclude_species_list.txt')
        _write(exc_path, 'Sturnus vulgaris\n')
        # Force a new mtime in case the test ran in < 1s resolution
        os.utime(exc_path, (time.time(), time.time() + 1))
        lists = self.helper(self.eng)
        self.assertEqual(lists['exclude'], {'Sturnus vulgaris'})

    def test_cache_hit_when_unchanged(self):
        exc_path = os.path.join(self.tmp.name, 'exclude_species_list.txt')
        _write(exc_path, 'Sturnus vulgaris\n')
        first = self.helper(self.eng)
        # Mutate the underlying set; cache hit means we get the same object
        # (identity), proving we didn't reread.
        first['exclude'].add('SHOULD_NOT_BE_IN_FILE')
        second = self.helper(self.eng)
        self.assertIn('SHOULD_NOT_BE_IN_FILE', second['exclude'])

    def test_picks_up_edited_file(self):
        exc_path = os.path.join(self.tmp.name, 'exclude_species_list.txt')
        _write(exc_path, 'Sturnus vulgaris\n')
        self.helper(self.eng)
        # Edit + bump mtime
        _write(exc_path, 'Sturnus vulgaris\nPica pica\n')
        os.utime(exc_path, (time.time(), time.time() + 2))
        lists = self.helper(self.eng)
        self.assertEqual(lists['exclude'], {'Sturnus vulgaris', 'Pica pica'})


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(name)s][%(levelname)s] %(message)s")
    unittest.main(verbosity=2)
