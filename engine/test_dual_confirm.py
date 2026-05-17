#!/usr/bin/env python3
"""Dual-confirm logic — unit tests.

Run: python -m pytest engine/test_dual_confirm.py -v
Or:  python engine/test_dual_confirm.py

The dual-confirm contract (README + settings/detection.html):
  - Perch detections with confidence >= PERCH_STANDALONE_CONFIDENCE pass on
    their own.
  - Below that threshold, a Perch detection is only accepted if BirdNET
    independently detected the SAME Sci_Name on a temporally overlapping
    chunk with confidence >= BIRDNET_ECHO_CONFIDENCE.
  - DUAL_CONFIRM_ENABLED=0 → no filtering, every Perch candidate over its
    own threshold passes (current pre-1.55.37 behavior).

These tests exercise `_dual_confirm_check` directly with hand-built
detection dicts so we don't depend on TFLite, ffmpeg, the DB, or any
audio file. The boot-time topology check (`_dual_confirm_active`) and
the threshold lowering for the BirdNET echo pool are covered by the
e2e flow tests; here we focus on the decision algorithm itself.
"""

import logging
import os
import sys
import unittest
from collections import defaultdict
from threading import Lock

sys.path.insert(0, os.path.dirname(__file__))


def _make_perch_det(sci, com, conf, start, stop):
    """Build the minimal Perch det dict that _dual_confirm_check reads."""
    return {
        "sci_name": sci,
        "com_name": com,
        "confidence": conf,
        "_start": float(start),
        "_stop": float(stop),
    }


def _make_birdnet_det(sci, conf, start, stop):
    """Same shape, used as primary_dets entries."""
    return {
        "sci_name": sci,
        "com_name": sci,
        "confidence": conf,
        "_start": float(start),
        "_stop": float(stop),
    }


class _FakeEngine:
    """Minimal stand-in for BirdEngine carrying only what
    _dual_confirm_check touches: a quality counter dict + its lock.
    Lets us assert log/counter behavior without loading the engine.
    """
    def __init__(self):
        self._quality_acc = defaultdict(int)
        self._quality_lock = Lock()
    def _quality_inc(self, key):
        with self._quality_lock:
            self._quality_acc[key] += 1


# Bind the real check function to the fake. Importing the bound method
# directly from the class lets us call it with a fake `self`, which
# keeps the test surface tiny.
def _bind_check():
    from engine import BirdEngine
    return BirdEngine._dual_confirm_check


class TestStandaloneAcceptance(unittest.TestCase):
    """conf >= standalone_thresh → 'standalone', regardless of primary_dets."""
    def setUp(self):
        self.eng = _FakeEngine()
        self.check = _bind_check()

    def test_at_threshold(self):
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.85, 0.0, 5.0)
        # Empty primary list — proves we don't even consult it
        out = self.check(self.eng, det, [], standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "standalone")
        self.assertEqual(self.eng._quality_acc["perch_standalone_accept"], 1)

    def test_above_threshold(self):
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.92, 0.0, 5.0)
        out = self.check(self.eng, det, [], standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "standalone")


class TestConfirmation(unittest.TestCase):
    """conf < standalone but matching BirdNET echo → 'confirmed'."""
    def setUp(self):
        self.eng = _FakeEngine()
        self.check = _bind_check()

    def test_exact_overlap_above_echo(self):
        # Perch 0..5s, BirdNET 0..3s — overlap is [0, 3) ≠ ∅
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.40, 0.0, 5.0)
        primary = [_make_birdnet_det("Turdus_merula", 0.18, 0.0, 3.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "confirmed")
        self.assertEqual(self.eng._quality_acc["perch_confirmed_by_birdnet"], 1)

    def test_partial_overlap(self):
        # Perch 2..7s, BirdNET 5..8s — overlap is [5, 7) → 2s
        det = _make_perch_det("Pica_pica", "Pie bavarde", 0.50, 2.0, 7.0)
        primary = [_make_birdnet_det("Pica_pica", 0.22, 5.0, 8.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "confirmed")

    def test_strongest_echo_wins(self):
        # Several candidates above echo threshold — the strongest is reported
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.40, 0.0, 5.0)
        primary = [
            _make_birdnet_det("Turdus_merula", 0.18, 0.0, 3.0),
            _make_birdnet_det("Turdus_merula", 0.45, 3.0, 6.0),
            _make_birdnet_det("Turdus_merula", 0.22, 6.0, 9.0),  # no overlap with perch
        ]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "confirmed")


class TestRejection(unittest.TestCase):
    """conf < standalone with no matching echo → 'rejected'."""
    def setUp(self):
        self.eng = _FakeEngine()
        self.check = _bind_check()

    def test_no_birdnet_candidate(self):
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.40, 0.0, 5.0)
        primary = [_make_birdnet_det("Pica_pica", 0.50, 0.0, 3.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "rejected")
        self.assertEqual(self.eng._quality_acc["perch_rejected_no_echo"], 1)

    def test_birdnet_below_echo_threshold(self):
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.40, 0.0, 5.0)
        # Same species, overlapping, but BirdNET 0.10 < echo 0.15
        primary = [_make_birdnet_det("Turdus_merula", 0.10, 0.0, 3.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "rejected")

    def test_no_temporal_overlap(self):
        # Perch 0..5s, BirdNET 10..13s — disjoint
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.40, 0.0, 5.0)
        primary = [_make_birdnet_det("Turdus_merula", 0.30, 10.0, 13.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "rejected")

    def test_touching_intervals_count_as_no_overlap(self):
        # Half-open: [0, 5) and [5, 8) touch at 5 but don't overlap
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.40, 0.0, 5.0)
        primary = [_make_birdnet_det("Turdus_merula", 0.30, 5.0, 8.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "rejected")


class TestSciNameMatchingIsStrict(unittest.TestCase):
    """Species matching is by Sci_Name only — never Com_Name / translations."""
    def setUp(self):
        self.eng = _FakeEngine()
        self.check = _bind_check()

    def test_different_sci_same_com_rejects(self):
        # Pathological: same com_name string but different sci_names → no match
        det = _make_perch_det("Turdus_merula", "Merle", 0.40, 0.0, 5.0)
        primary = [_make_birdnet_det("Turdus_pilaris", 0.50, 0.0, 3.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "rejected")


class TestIndependentEchoThreshold(unittest.TestCase):
    """BIRDNET_ECHO_CONFIDENCE is independent of BIRDNET_CONFIDENCE — even
    when echo < birdnet conf default (0.15 < 0.65), echoes at 0.20 must
    confirm. This is the whole point of the "low echo" feature.
    """
    def setUp(self):
        self.eng = _FakeEngine()
        self.check = _bind_check()

    def test_low_echo_threshold_accepts_low_birdnet(self):
        det = _make_perch_det("Turdus_merula", "Merle noir", 0.40, 0.0, 5.0)
        # BirdNET 0.20 — well below typical 0.65 BIRDNET_CONFIDENCE,
        # but the echo threshold is set lower (0.15) on purpose.
        primary = [_make_birdnet_det("Turdus_merula", 0.20, 0.0, 3.0)]
        out = self.check(self.eng, det, primary, standalone_thresh=0.85, echo_thresh=0.15)
        self.assertEqual(out, "confirmed")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(name)s][%(levelname)s] %(message)s")
    unittest.main(verbosity=2)
