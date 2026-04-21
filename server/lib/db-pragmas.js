'use strict';
/**
 * db-pragmas — centralized PRAGMA tuning for all SQLite connections.
 *
 * Applies a consistent set of performance settings to every connection
 * birdash opens (read, write, birdash.db, taxonomy.db, worker thread).
 * Tuning adapts to the host's RAM so we don't over-commit on Pi 3.
 *
 * Why each setting:
 *
 *   journal_mode = WAL
 *     Enables concurrent readers + a writer. Persisted in the file, set
 *     once on the writer connection. Read-only connections inherit it.
 *
 *   busy_timeout = 30000 (30 s)
 *     The Python engine uses 30 s too; aligning prevents a Node read
 *     from raising "database is locked" while a long Python write is in
 *     flight. Ordinary requests never wait — only real contention does.
 *
 *   synchronous = NORMAL
 *     The SQLite docs explicitly recommend NORMAL when in WAL mode:
 *     no risk of corruption, gives 2-5× faster writes than FULL. Worst
 *     case after a power cut: the last few committed transactions are
 *     lost — for birdash that's at most a few detections from the last
 *     ~second, which the engine re-creates within 45 s.
 *
 *   cache_size — adapts to RAM
 *     Pi 3 (≤2 GB): 16 MB    (-16000)  default better-sqlite3 value
 *     Pi 4/5 (≥4 GB): 64 MB  (-65536)
 *     Bigger cache means hot pages stay in memory across queries — huge
 *     win for repeated aggregates over the same date window.
 *
 *   mmap_size — adapts to RAM
 *     Pi 3 (≤2 GB): 0 (off)   — RAM too tight, mmap competes with arecord
 *     Pi 4/5 (≥4 GB): 256 MB  — covers most of birds.db (currently ~750 MB
 *     on bird.local; OS pages the rest as needed). Sequential reads + the
 *     cold-cache first-query are dramatically faster.
 *
 *   temp_store = MEMORY
 *     ORDER BY / GROUP BY / DISTINCT temp B-trees stay in RAM instead
 *     of spilling to disk. Common case in our analytics queries.
 *
 *   wal_autocheckpoint
 *     Left at default (1000 pages = 4 MB): a good balance for our write
 *     volume. Lower = more frequent checkpoints (more I/O); higher = WAL
 *     can grow unbounded between checkpoints.
 *
 * Returns the snapshot of values applied so callers can log them at
 * startup for visibility.
 */

const os = require('os');

// Decide whether the host has enough RAM to use the bigger cache + mmap.
// Threshold: 3 GB total (covers Pi 4 with 4 GB, Pi 5 with 4-16 GB) —
// Pi 3 with 1 GB stays on conservative defaults.
function isHighMemHost() {
  const totalGb = os.totalmem() / (1024 ** 3);
  return totalGb >= 3;
}

const HIGH_MEM = isHighMemHost();

const PROFILE = HIGH_MEM
  ? {
      cache_size:   -65536,        // 64 MB
      mmap_size:    268435456,     // 256 MB
      temp_store:   'MEMORY',
      busy_timeout: 30000,
    }
  : {
      cache_size:   -16000,        // 16 MB (better-sqlite3 default)
      mmap_size:    0,             // disabled — RAM too tight on Pi 3
      temp_store:   'MEMORY',
      busy_timeout: 30000,
    };

/**
 * Apply read-tuned PRAGMAs to a connection. Use for read-only connections.
 * @param {Database} db - better-sqlite3 instance
 * @returns {object} effective values (for logging)
 */
function applyReadPragmas(db) {
  db.pragma(`busy_timeout = ${PROFILE.busy_timeout}`);
  db.pragma(`cache_size = ${PROFILE.cache_size}`);
  db.pragma(`mmap_size = ${PROFILE.mmap_size}`);
  db.pragma(`temp_store = ${PROFILE.temp_store}`);
  return snapshot(db);
}

/**
 * Apply write-tuned PRAGMAs. Adds journal_mode=WAL and synchronous=NORMAL
 * (only meaningful on the writer; persisted in the file). Safe to call
 * on read-only connections too — the WAL mode set is a no-op there.
 * @param {Database} db - better-sqlite3 instance
 * @returns {object} effective values (for logging)
 */
function applyWritePragmas(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  return applyReadPragmas(db);
}

function snapshot(db) {
  return {
    journal_mode: db.pragma('journal_mode',  { simple: true }),
    synchronous:  db.pragma('synchronous',   { simple: true }),
    cache_size:   db.pragma('cache_size',    { simple: true }),
    mmap_size:    db.pragma('mmap_size',     { simple: true }),
    temp_store:   db.pragma('temp_store',    { simple: true }),
    busy_timeout: db.pragma('busy_timeout',  { simple: true }),
  };
}

module.exports = {
  applyReadPragmas,
  applyWritePragmas,
  snapshot,
  isHighMemHost: () => HIGH_MEM,
};
