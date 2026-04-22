"""BirdEngine — filesystem watcher for arecord chunked WAVs.

Extracted from engine.py during the refactor; behavior unchanged.
"""

import os
import threading

from watchdog.events import FileSystemEventHandler


class WavHandler(FileSystemEventHandler):
    """Watchdog handler for arecord chunked WAVs.

    arecord (--use-strftime --max-file-time N) creates a new file every N
    seconds. The on_created event fires the moment the new file is opened —
    while it's still being written. Reading it immediately yields only the
    first ~2 s of audio (whatever arecord has flushed).

    Trick: when on_created fires for file N+1, file N is GUARANTEED
    complete (arecord just closed it before opening N+1). So we keep one
    "pending" path and process the *previous* file on every rotation.
    """

    def __init__(self, process_fn):
        self.process_fn = process_fn
        self._pending = None
        self._lock = threading.Lock()

    def _on_new_wav(self, path):
        with self._lock:
            to_process = self._pending
            self._pending = path
        if to_process and os.path.exists(to_process):
            self.process_fn(to_process)

    def on_created(self, event):
        if event.is_directory or not event.src_path.endswith(".wav"):
            return
        self._on_new_wav(event.src_path)

    def on_moved(self, event):
        if event.is_directory or not event.dest_path.endswith(".wav"):
            return
        self._on_new_wav(event.dest_path)
