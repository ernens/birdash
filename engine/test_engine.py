#!/usr/bin/env python3
"""BirdEngine unit tests. Run: python -m pytest test_engine.py -v"""

import json
import os
import sys
import tempfile
import unittest

import numpy as np

# Add engine directory to path
sys.path.insert(0, os.path.dirname(__file__))


class TestLoadConfig(unittest.TestCase):
    def test_load_valid_toml(self):
        from engine import load_config
        with tempfile.NamedTemporaryFile(mode='w', suffix='.toml', delete=False) as f:
            f.write('[station]\nname = "Test"\nlatitude = 50.0\nlongitude = 4.0\n')
            f.flush()
            config = load_config(f.name)
            self.assertEqual(config['station']['name'], 'Test')
            self.assertEqual(config['station']['latitude'], 50.0)
        os.unlink(f.name)


class TestSplitSignal(unittest.TestCase):
    def test_basic_split(self):
        from engine import split_signal
        sig = np.zeros(48000 * 10, dtype=np.float32)  # 10s at 48kHz
        chunks = split_signal(sig, 48000, 0.5, seconds=3.0)
        self.assertGreater(len(chunks), 0)
        self.assertEqual(len(chunks[0]), 48000 * 3)

    def test_short_signal(self):
        from engine import split_signal
        sig = np.zeros(1000, dtype=np.float32)  # Too short
        chunks = split_signal(sig, 48000, 0.0, seconds=3.0)
        self.assertEqual(len(chunks), 0)

    def test_zero_padding(self):
        from engine import split_signal
        sig = np.ones(48000 * 4, dtype=np.float32)  # 4s
        chunks = split_signal(sig, 48000, 0.0, seconds=3.0)
        self.assertEqual(len(chunks), 1)  # Only 1 full chunk, remainder too short

    def test_overlap(self):
        from engine import split_signal
        sig = np.zeros(48000 * 10, dtype=np.float32)
        chunks_no_overlap = split_signal(sig, 48000, 0.0, seconds=3.0)
        chunks_overlap = split_signal(sig, 48000, 1.0, seconds=3.0)
        self.assertGreater(len(chunks_overlap), len(chunks_no_overlap))


class TestLoadLabels(unittest.TestCase):
    def test_load_and_strip(self):
        from engine import load_labels
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, 'Test_Labels.txt'), 'w') as f:
                f.write('Pica pica_Eurasian Magpie\nTurdus merula_Common Blackbird\n')
            labels = load_labels('Test', d)
            self.assertEqual(labels[0], 'Pica pica')
            self.assertEqual(labels[1], 'Turdus merula')

    def test_no_strip_when_no_underscore(self):
        from engine import load_labels
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, 'Test_Labels.txt'), 'w') as f:
                f.write('Pica pica\nTurdus merula\n')
            labels = load_labels('Test', d)
            self.assertEqual(labels[0], 'Pica pica')


class TestWriteDetection(unittest.TestCase):
    def test_no_duplicate(self):
        from engine import init_db, write_detection
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
            db_path = f.name
        conn = init_db(db_path)
        det = {
            'date': '2026-01-01', 'time': '12:00:00',
            'sci_name': 'Pica pica', 'com_name': 'Pie bavarde',
            'confidence': 0.95, 'lat': 50.0, 'lon': 4.0,
            'cutoff': 0.65, 'week': 1, 'sens': 1.0, 'overlap': 0.5,
            'file_name': 'test.mp3', 'model': 'TestModel',
        }
        result1 = write_detection(conn, det)
        result2 = write_detection(conn, det)
        self.assertTrue(result1)  # First insert succeeds
        self.assertFalse(result2)  # Duplicate blocked
        # Verify only 1 row
        count = conn.execute('SELECT COUNT(*) FROM detections').fetchone()[0]
        self.assertEqual(count, 1)
        conn.close()
        os.unlink(db_path)


class TestDetToSql(unittest.TestCase):
    def test_escaping(self):
        from engine import _det_to_sql
        det = {
            'date': '2026-01-01', 'time': '12:00:00',
            'sci_name': "Test's bird", 'com_name': "L'oiseau",
            'confidence': 0.9, 'lat': 50.0, 'lon': 4.0,
            'cutoff': 0.65, 'week': 1, 'sens': 1.0, 'overlap': 0.5,
            'file_name': 'test.mp3', 'model': 'Test',
        }
        sql = _det_to_sql(det)
        self.assertIn("Test''s bird", sql)
        self.assertIn("L''oiseau", sql)
        self.assertNotIn(";", sql.rstrip(";"))


class TestNotifier(unittest.TestCase):
    def test_init(self):
        from engine import Notifier
        config = {'notifications': {'ntfy_url': '', 'notify_new_species_daily': False, 'cooldown_seconds': 60}}
        notifier = Notifier(config)
        self.assertEqual(notifier.ntfy_url, '')
        self.assertEqual(notifier.ntfy_url, '')

    def test_no_notification_when_disabled(self):
        from engine import Notifier
        config = {'notifications': {'ntfy_url': '', 'notify_new_species_daily': False, 'cooldown_seconds': 60}}
        notifier = Notifier(config)
        det = {'date': '2026-01-01', 'sci_name': 'Pica pica', 'com_name': 'Magpie',
               'confidence': 0.9, 'model': 'Test'}
        # Should not raise
        notifier.check_and_notify(det)


class TestReadAudio(unittest.TestCase):
    def test_read_wav(self):
        import soundfile as sf
        from engine import read_audio
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            data = np.random.randn(48000).astype(np.float32)
            sf.write(f.name, data, 48000)
            result = read_audio(f.name, 48000)
            self.assertEqual(len(result), 48000)
        os.unlink(f.name)

    def test_stereo_to_mono(self):
        import soundfile as sf
        from engine import read_audio
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            data = np.random.randn(48000, 2).astype(np.float32)
            sf.write(f.name, data, 48000)
            result = read_audio(f.name, 48000)
            self.assertEqual(result.ndim, 1)
        os.unlink(f.name)


if __name__ == '__main__':
    unittest.main()
