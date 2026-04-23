"""BirdEngine — filesystem watcher for arecord chunked WAVs.

Originally used a "process-previous-on-next-create" trick because
on_created fires while arecord is still writing the file. That trick
added 45 s of latency on every WAV (we waited for the next rotation
to confirm the previous was complete) and stranded the very last
file at shutdown.

Modern fix: watchdog's on_closed fires when arecord actually fclose()s
the file (mapped from inotify IN_CLOSE_WRITE on Linux). We process
immediately on close — no latency, no _pending, no stranded file.

on_moved is kept for the legacy multi-Pi setup where another machine
rsyncs WAVs into incoming/ via atomic rename.

Belt-and-braces: BirdEngine._pickup_orphans() re-scans incoming/
every 5 min and re-feeds anything that slipped through (kernel
inotify buffer overflow under load, watchdog glitch, etc.). Runs
through the same process_file path, which is idempotent via the
processed_files set.
"""

import os

from watchdog.events import FileSystemEventHandler


class WavHandler(FileSystemEventHandler):
    """Process a WAV when arecord finishes writing it."""

    def __init__(self, process_fn):
        self.process_fn = process_fn
        # Kept for backwards compatibility with any caller that reads it
        # (notably _pickup_orphans, though it tolerates None).
        self._pending = None

    def _dispatch(self, path):
        if not path or not path.endswith(".wav"):
            return
        if not os.path.exists(path):
            return
        self.process_fn(path)

    def on_closed(self, event):
        """Primary path: fires on inotify IN_CLOSE_WRITE — arecord just
        finished writing this WAV. Process immediately."""
        if event.is_directory:
            return
        self._dispatch(event.src_path)

    def on_moved(self, event):
        """Legacy: another machine rsyncs WAVs in via atomic rename."""
        if event.is_directory:
            return
        self._dispatch(event.dest_path)
