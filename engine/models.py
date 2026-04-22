"""BirdEngine — model wrappers (BirdNET v1/v2.4, Perch v2, MData filter).

Extracted from engine.py during the refactor; behavior unchanged.
"""

import json
import logging
import math
import os
import re

import numpy as np

log = logging.getLogger("birdengine")


# ---------------------------------------------------------------------------
# Label loading
# ---------------------------------------------------------------------------

def load_labels(model_name, models_dir):
    """Load species labels for a model."""
    label_path = os.path.join(models_dir, f"{model_name}_Labels.txt")
    with open(label_path) as f:
        labels = [line.strip() for line in f.readlines()]
    # Strip common name suffix if present (e.g. "Pica pica_Eurasian Magpie")
    # Check multiple labels to avoid edge case where first label differs
    has_suffix = any(l.count("_") == 1 for l in labels[:10] if l)
    if has_suffix:
        labels = [re.sub(r"_.+$", "", label) for label in labels]
    return labels


def load_language(lang, models_dir):
    """Load localized species names."""
    path = os.path.join(models_dir, "l18n", f"labels_{lang}.json")
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# TFLite interpreter factory
# ---------------------------------------------------------------------------

def create_interpreter(model_path, num_threads=None):
    """Create a TFLite interpreter, supporting both ai_edge_litert and tflite_runtime."""
    try:
        from ai_edge_litert.interpreter import Interpreter
    except ImportError:
        try:
            import tflite_runtime.interpreter as tflite
            Interpreter = tflite.Interpreter
        except ImportError:
            from tensorflow import lite as tflite
            Interpreter = tflite.Interpreter

    kwargs = {"model_path": model_path}
    if num_threads:
        kwargs["num_threads"] = num_threads
    interp = Interpreter(**kwargs)
    interp.allocate_tensors()
    return interp


# ---------------------------------------------------------------------------
# Model classes
# ---------------------------------------------------------------------------

class MDataModel:
    """Geographic species filter using BirdNET metadata model."""

    def __init__(self, model_path, sf_thresh):
        self.interpreter = create_interpreter(model_path)
        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        self._output_idx = out[0]["index"]
        self._sf_thresh = sf_thresh
        self._cache_key = None
        self._cached_list = None

    def get_species_list(self, labels, lat, lon, week):
        key = (lat, lon, week)
        if self._cache_key == key and self._cached_list is not None:
            return self._cached_list

        sample = np.expand_dims(np.array([lat, lon, week], dtype="float32"), 0)
        self.interpreter.set_tensor(self._input_idx, sample)
        self.interpreter.invoke()
        scores = self.interpreter.get_tensor(self._output_idx)[0]

        filtered = [
            labels[i].split("_")[0]
            for i, s in enumerate(scores)
            if s >= self._sf_thresh
        ]
        self._cache_key = key
        self._cached_list = filtered
        return filtered


class BirdNETv1Model:
    """BirdNET V1 (6K Global) model wrapper — has metadata input layer."""

    name = "BirdNET_6K_GLOBAL_MODEL"
    sample_rate = 48000
    chunk_duration = 3

    def __init__(self, models_dir, sensitivity, sf_thresh, mdata_version):
        model_path = os.path.join(models_dir, f"{self.name}.tflite")
        self.interpreter = create_interpreter(model_path)

        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        self._mdata_idx = inp[1]["index"]
        self._output_idx = out[0]["index"]

        self.labels = load_labels(self.name, models_dir)
        self._sensitivity = max(0.5, min(1.0 - (sensitivity - 1.0), 1.5))
        self._mdata = None

    def set_meta_data(self, lat, lon, week):
        m = np.array([lat, lon, week], dtype=np.float32)
        if 1 <= m[2] <= 48:
            m[2] = math.cos(math.radians(m[2] * 7.5)) + 1
        else:
            m[2] = -1
        mask = np.ones(3, dtype=np.float32)
        if m[0] == -1 or m[1] == -1:
            mask = np.zeros(3, dtype=np.float32)
        if m[2] == -1:
            mask[2] = 0.0
        self._mdata = np.expand_dims(np.concatenate([m, mask]), 0)

    def predict(self, chunk):
        self.interpreter.set_tensor(self._input_idx, chunk[np.newaxis, :].astype(np.float32))
        if self._mdata is not None:
            self.interpreter.set_tensor(self._mdata_idx, self._mdata)
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self._output_idx)[0]
        probs = 1.0 / (1.0 + np.exp(-self._sensitivity * logits))
        return sorted(zip(self.labels, probs), key=lambda x: x[1], reverse=True)

    def get_species_list(self, lat, lon, week):
        self.set_meta_data(lat, lon, week)
        return []


class BirdNETModel:
    """BirdNET V2.4 FP16 model wrapper."""

    name = "BirdNET_GLOBAL_6K_V2.4_Model_FP16"
    sample_rate = 48000
    chunk_duration = 3

    def __init__(self, models_dir, sensitivity, sf_thresh, mdata_version):
        model_path = os.path.join(models_dir, f"{self.name}.tflite")
        self.interpreter = create_interpreter(model_path)

        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        self._output_idx = out[0]["index"]

        self.labels = load_labels(self.name, models_dir)
        self._sensitivity = max(0.5, min(1.0 - (sensitivity - 1.0), 1.5))

        # Load MData model for geographic filtering
        mdata_name = (
            "BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16" if mdata_version == 1
            else "BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16"
        )
        mdata_path = os.path.join(models_dir, f"{mdata_name}.tflite")
        self.mdata = MDataModel(mdata_path, sf_thresh) if os.path.exists(mdata_path) else None

    def predict(self, chunk):
        self.interpreter.set_tensor(self._input_idx, chunk[np.newaxis, :].astype(np.float32))
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self._output_idx)[0]
        probs = 1.0 / (1.0 + np.exp(-self._sensitivity * logits))
        return sorted(zip(self.labels, probs), key=lambda x: x[1], reverse=True)

    def get_species_list(self, lat, lon, week):
        if self.mdata:
            return self.mdata.get_species_list(self.labels, lat, lon, week)
        return []


class PerchModel:
    """Google Perch V2 model wrapper (FP32 or INT8)."""

    name = "Perch_v2"
    sample_rate = 32000
    chunk_duration = 5

    def __init__(self, models_dir, sensitivity, sf_thresh, mdata_version, model_name=None):
        if model_name:
            self.name = model_name
        model_path = os.path.join(models_dir, f"{self.name}.tflite")
        self.interpreter = create_interpreter(model_path, num_threads=2)

        inp = self.interpreter.get_input_details()
        out = self.interpreter.get_output_details()
        self._input_idx = inp[0]["index"]
        # Perch output layer is index 3
        self._output_idx = out[3]["index"]

        self.labels = load_labels(self.name, models_dir)

        # Temperature from sensitivity
        self._temperature = max(0.25, 2.0 - float(sensitivity))
        log.info("Perch temperature=%.2f (sensitivity=%.2f)", self._temperature, sensitivity)

        # Bird-only filter — prefer variant-specific index, fallback to generic
        idx_path = os.path.join(models_dir, f"{self.name}_bird_indices.json")
        if not os.path.exists(idx_path):
            idx_path = os.path.join(models_dir, "Perch_v2_bird_indices.json")
        if os.path.exists(idx_path):
            with open(idx_path) as f:
                self._bird_indices = np.array(json.load(f), dtype=int)
            self._bird_labels = [self.labels[i] for i in self._bird_indices]
            log.info("Perch bird filter: %d / %d species", len(self._bird_indices), len(self.labels))
        else:
            self._bird_indices = None
            self._bird_labels = self.labels

        # MData geographic filter (reuses BirdNET labels)
        mdata_name = (
            "BirdNET_GLOBAL_6K_V2.4_MData_Model_FP16" if mdata_version == 1
            else "BirdNET_GLOBAL_6K_V2.4_MData_Model_V2_FP16"
        )
        mdata_path = os.path.join(models_dir, f"{mdata_name}.tflite")
        if os.path.exists(mdata_path):
            self.mdata = MDataModel(mdata_path, sf_thresh)
            self._birdnet_labels = load_labels("BirdNET_GLOBAL_6K_V2.4_Model_FP16", models_dir)
        else:
            self.mdata = None
            self._birdnet_labels = None

    def predict(self, chunk):
        self.interpreter.set_tensor(self._input_idx, chunk[np.newaxis, :].astype(np.float32))
        self.interpreter.invoke()
        logits = self.interpreter.get_tensor(self._output_idx)[0]

        # Filter to bird-only BEFORE softmax (avoids probability dilution
        # across insects, frogs, mammals etc.)
        if self._bird_indices is not None:
            bird_logits = logits[self._bird_indices]
            labels = self._bird_labels
        else:
            bird_logits = logits
            labels = self.labels

        # Temperature-scaled softmax on bird-only logits
        scaled = (bird_logits - np.max(bird_logits)) / self._temperature
        exp_x = np.exp(scaled)
        probs = exp_x / np.sum(exp_x)

        order = np.argsort(probs)[::-1]
        return [(labels[i], float(probs[i])) for i in order]

    def get_species_list(self, lat, lon, week):
        if self.mdata and self._birdnet_labels:
            return self.mdata.get_species_list(self._birdnet_labels, lat, lon, week)
        return []


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_model(model_name, models_dir, sensitivity=1.0, sf_thresh=0.03, mdata_version=2):
    """Factory: instantiate a model by name."""
    if model_name.startswith("perch_v2") or model_name in ("Perch_v2", "Perch_v2_int8"):
        return PerchModel(models_dir, sensitivity, sf_thresh, mdata_version,
                          model_name=model_name)
    elif model_name == "BirdNET_6K_GLOBAL_MODEL":
        return BirdNETv1Model(models_dir, sensitivity, sf_thresh, mdata_version)
    else:
        return BirdNETModel(models_dir, sensitivity, sf_thresh, mdata_version)
