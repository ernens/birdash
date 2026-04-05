'use strict';
/**
 * Backup routes — /api/backup-*
 * Extracted from server.js for modularity.
 */
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

let _activeBackupProc = null;
let _backupSizeCache = 0, _backupSizeRefreshing = false;

async function updateBackupCron(config) {
  const cronTag = '# BIRDASH_BACKUP';
  const oldBackupPattern = /backup-biloute\.sh/;
  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'backup.sh');
  const cfgPath = path.join(PROJECT_ROOT, 'config', 'backup.json');
  try {
    // Read current crontab
    let crontab = '';
    try { crontab = await execCmd('crontab', ['-l']); } catch(e) {}
    const lines = crontab.split('\n');
    const result = [];
    for (const line of lines) {
      // Remove old BIRDASH_BACKUP lines
      if (line.includes(cronTag)) continue;
      // Comment out old backup-biloute.sh if new schedule is active
      if (config.schedule && config.schedule !== 'manual' && oldBackupPattern.test(line) && !line.trim().startsWith('#')) {
        result.push('# [disabled by birdash] ' + line);
        continue;
      }
      result.push(line);
    }
    if (config.schedule && config.schedule !== 'manual') {
      const [hour, min] = (config.scheduleTime || '02:00').split(':').map(Number);
      let cronExpr;
      if (config.schedule === 'daily') cronExpr = `${min} ${hour} * * *`;
      else if (config.schedule === 'weekly') cronExpr = `${min} ${hour} * * 0`;
      else return;
      const logPath = path.join(process.env.HOME || '/home/bjorn', '.local', 'share', 'birdash-backup.log');
      result.push(`${cronExpr} BACKUP_CONFIG=${cfgPath} bash ${scriptPath} >> ${logPath} 2>&1 ${cronTag}`);
    }
    const tmpCron = '/tmp/birdash-crontab.tmp';
    await fsp.writeFile(tmpCron, result.filter(l => l.trim() !== '').join('\n') + '\n');
    await execCmd('crontab', [tmpCron]);
    await fsp.unlink(tmpCron).catch(() => {});
  } catch(e) {
    console.warn('[BIRDASH] Failed to update backup cron:', e.message);
  }
}


/**
 * Handle backup-related routes.
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 * @param {string} pathname - parsed URL pathname
 * @param {object} ctx - shared context { requireAuth, execCmd, readJsonFile, writeJsonFileAtomic, JSON_CT }
 * @returns {boolean} true if route was handled
 */
function handle(req, res, pathname, ctx) {
  const { requireAuth, execCmd, readJsonFile, writeJsonFileAtomic, JSON_CT, db, parseBirdnetConf } = ctx;

  // ── Route : GET /api/backup-config ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-config') {
    (async () => {
      try {
        const cfgPath = path.join(PROJECT_ROOT, 'config', 'backup.json');
        let config = { destination: 'local', content: ['all'], schedule: 'manual', scheduleTime: '02:00', retention: 30, local: { path: '/mnt/backup' }, smb: { host: '', share: '', user: '', pass: '', remotePath: '/birdash-backup' }, nfs: { host: '', exportPath: '', mountPoint: '/mnt/nfs-backup', remotePath: '/birdash-backup' }, sftp: { host: '', port: 22, user: '', pass: '', remotePath: '/birdash-backup' }, s3: { bucket: '', region: 'eu-west-1', accessKey: '', secretKey: '', remotePath: 'birdash-backup' }, gdrive: { folderId: '' }, webdav: { url: '', user: '', pass: '', remotePath: '/birdash-backup' }, lastRun: null, lastStatus: null };
        try {
          const raw = await fsp.readFile(cfgPath, 'utf8');
          config = { ...config, ...JSON.parse(raw) };
        } catch(e) {}
        // Redact passwords for frontend
        const safe = JSON.parse(JSON.stringify(config));
        if (safe.smb && safe.smb.pass) safe.smb.pass = safe.smb.pass ? '••••••' : '';
        if (safe.sftp && safe.sftp.pass) safe.sftp.pass = safe.sftp.pass ? '••••••' : '';
        if (safe.s3 && safe.s3.secretKey) safe.s3.secretKey = safe.s3.secretKey ? '••••••' : '';
        if (safe.webdav && safe.webdav.pass) safe.webdav.pass = safe.webdav.pass ? '••••••' : '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(safe));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/backup-config ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-config') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const updates = JSON.parse(body);
        const cfgPath = path.join(PROJECT_ROOT, 'config', 'backup.json');
        const cfgDir = path.dirname(cfgPath);
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });

        // Load existing config to preserve secrets when redacted
        let existing = {};
        try { existing = JSON.parse(await fsp.readFile(cfgPath, 'utf8')); } catch(e) {}

        // Validate destination type
        const validDest = ['local', 'smb', 'nfs', 'sftp', 's3', 'gdrive', 'webdav'];
        if (updates.destination && !validDest.includes(updates.destination)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid destination type' }));
          return;
        }

        // Validate content array
        const validContent = ['all', 'db', 'audio', 'config'];
        if (updates.content && (!Array.isArray(updates.content) || !updates.content.every(c => validContent.includes(c)))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid content selection' }));
          return;
        }

        // Validate schedule
        const validSched = ['manual', 'daily', 'weekly'];
        if (updates.schedule && !validSched.includes(updates.schedule)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid schedule' }));
          return;
        }

        // Preserve passwords if sent as redacted
        for (const section of ['smb', 'sftp', 'webdav']) {
          if (updates[section] && updates[section].pass === '••••••' && existing[section]) {
            updates[section].pass = existing[section].pass;
          }
        }
        if (updates.s3 && updates.s3.secretKey === '••••••' && existing.s3) {
          updates.s3.secretKey = existing.s3.secretKey;
        }

        // Merge and save
        const merged = { ...existing, ...updates };
        await fsp.writeFile(cfgPath, JSON.stringify(merged, null, 2));

        // Update cron if schedule changed
        await updateBackupCron(merged);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // ── Route : POST /api/backup-run ────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-run') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        const cfgPath = path.join(PROJECT_ROOT, 'config', 'backup.json');
        let config;
        try { config = JSON.parse(await fsp.readFile(cfgPath, 'utf8')); }
        catch(e) { throw new Error('No backup configuration found'); }

        const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'backup.sh');
        if (!fs.existsSync(scriptPath)) {
          throw new Error('Backup script not found: scripts/backup.sh');
        }

        // Run backup script asynchronously
        const statusPath = path.join(PROJECT_ROOT, 'config', 'backup-status.json');
        const proc = spawn('bash', [scriptPath], { env: { ...process.env, BACKUP_CONFIG: cfgPath, BACKUP_STATUS: statusPath } });
        _activeBackupProc = proc; // Track for graceful shutdown
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', async (code) => {
          const status = code === 0 ? 'success' : 'failed';
          const now = new Date().toISOString();
          try {
            const cfg = JSON.parse(await fsp.readFile(cfgPath, 'utf8'));
            cfg.lastRun = now;
            cfg.lastStatus = status;
            cfg.lastMessage = code === 0 ? '' : (stderr || stdout).slice(0, 500);
            // Measure backup size after success (async, non-blocking)
            if (code === 0) {
              try {
                const dest = cfg.destination || 'local';
                const bkpDir = dest === 'local' ? (cfg.local && cfg.local.path || '/mnt/backup')
                  : (dest === 'nfs' && cfg.nfs) ? path.join(cfg.nfs.mountPoint || '/mnt/backup', cfg.nfs.remotePath || 'birdash-backup')
                  : null;
                if (bkpDir) {
                  const sizeOut = await execCmd('du', ['-sb', bkpDir]);
                  cfg.lastBackupSize = parseInt(sizeOut.split(/\s/)[0]);
                }
              } catch {}
            }
            await fsp.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
          } catch(e) {}
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Backup started' }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/backup-progress ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-progress') {
    (async () => {
      try {
        const statusPath = path.join(PROJECT_ROOT, 'config', 'backup-status.json');
        let status = { state: 'idle', percent: 0, step: '', detail: '', startedAt: null, updatedAt: null };
        try {
          const raw = await fsp.readFile(statusPath, 'utf8');
          status = JSON.parse(raw);
          // If last update was more than 5 minutes ago and state is "running", mark as stale
          if (status.state === 'running' && status.updatedAt) {
            const elapsed = Date.now() - new Date(status.updatedAt).getTime();
            if (elapsed > 5 * 60 * 1000) {
              status.state = 'stale';
              status.detail = 'No update for ' + Math.round(elapsed / 60000) + ' min';
            }
          }
        } catch(e) {}

        // If no new-style backup is running, detect legacy backup-biloute.sh
        if (status.state === 'idle' || status.state === 'completed' || status.state === 'failed' || status.state === 'stopped') {
          try {
            const psOut = await execCmd('pgrep', ['-af', 'backup-biloute\\.sh']);
            if (psOut.trim()) {
              // Legacy backup has 4 steps: db(0-5%), config(5-10%), projects(10-25%), audio(25-100%)
              let step = 'init', detail = 'backup-biloute.sh (legacy)', percent = 2;

              // Detect current step from log file
              // Use grep to find last step marker (log can be huge with rsync output)
              try {
                // Find the last "Étape N" line in the log
                let lastStep = '';
                try {
                  lastStep = await execCmd('bash', ['-c', "grep -n 'tape [1-4]' /var/log/backup-biloute.log | tail -1"]);
                } catch(eG) {}
                // Also check completion markers
                let completionLines = '';
                try {
                  completionLines = await execCmd('tail', ['-5', '/var/log/backup-biloute.log']);
                } catch(eT) {}

                if (/tape 4/i.test(lastStep) || /BirdSongs/i.test(lastStep)) {
                  step = 'audio'; detail = 'BirdSongs rsync (legacy)'; percent = 25;
                  // Parse rsync progress from the last lines of the log
                  // Multiple rsync instances may interleave — take the max percentage
                  try {
                    const logTail = await execCmd('tail', ['-50', '/var/log/backup-biloute.log']);
                    const pctMatches = logTail.match(/\b(\d{1,3})%/g);
                    if (pctMatches && pctMatches.length) {
                      const allPcts = pctMatches.map(m => parseInt(m)).filter(n => !isNaN(n) && n >= 0 && n <= 100);
                      if (allPcts.length) {
                        const maxPct = Math.max(...allPcts);
                        percent = 25 + Math.round(maxPct * 73 / 100); // Scale 0-100% into 25-98%
                        // Extract last synced filename from log lines (lines without %)
                        const fileLines = logTail.split('\n').filter(l => l.trim() && !/\d+%/.test(l) && !l.startsWith('['));
                        const lastFile = fileLines.length ? fileLines[fileLines.length - 1].trim() : '';
                        if (lastFile) {
                          // Show just the filename, not the full path
                          const shortName = lastFile.split('/').pop();
                          detail = shortName;
                        } else {
                          detail = 'Synchronisation BirdSongs…';
                        }
                      }
                    }
                  } catch(eR) {}
                  // If finished
                  if (/BirdSongs OK/i.test(completionLines)) { percent = 98; detail = 'Finalisation...'; }
                } else if (/tape 3/i.test(lastStep)) {
                  step = 'projects'; detail = 'Sync projets (legacy)'; percent = 15;
                  // Extract current file from log
                  try {
                    const logTail3 = await execCmd('tail', ['-20', '/var/log/backup-biloute.log']);
                    const fileLines3 = logTail3.split('\n').filter(l => l.trim() && !/\d+%/.test(l) && !l.startsWith('[') && !/rsync error/i.test(l));
                    if (fileLines3.length) {
                      const shortName = fileLines3[fileLines3.length - 1].trim().split('/').pop();
                      if (shortName) detail = shortName;
                    }
                  } catch(eF) {}
                  if (/Projets OK/i.test(completionLines)) { percent = 24; }
                } else if (/tape 2/i.test(lastStep)) {
                  step = 'config'; detail = 'Configuration (legacy)'; percent = 8;
                  if (/Configurations OK/i.test(completionLines)) { percent = 10; }
                } else if (/tape 1/i.test(lastStep)) {
                  step = 'db'; detail = 'Bases de données (legacy)'; percent = 3;
                  if (/Bases de donn.*OK/i.test(completionLines)) { percent = 5; }
                }
              } catch(eLog) {
                // Fallback: detect step from running processes
                try {
                  const rsyncPs = await execCmd('pgrep', ['-af', 'rsync.*BirdSongs']);
                  if (rsyncPs.trim()) { step = 'audio'; detail = 'BirdSongs rsync (legacy)'; percent = 50; }
                } catch(e2) {
                  try {
                    const rsyncPs2 = await execCmd('pgrep', ['-af', 'rsync.*/mnt/backup']);
                    if (rsyncPs2.trim()) { step = 'projects'; detail = 'Sync projets (legacy)'; percent = 15; }
                  } catch(e3) {}
                }
              }

              let startedAt = null;
              try {
                const pid = psOut.trim().split('\n')[0].trim().split(/\s+/)[0];
                const elapsed = await execCmd('ps', ['-o', 'etimes=', '-p', pid]);
                const secs = parseInt(elapsed.trim());
                if (!isNaN(secs)) startedAt = new Date(Date.now() - secs * 1000).toISOString();
              } catch(e4) {}
              // Check if paused (SIGSTOP → T state)
              let paused = false;
              try {
                const statOut = await execCmd('bash', ['-c', "ps -eo pid,state,args | grep 'backup-biloute' | grep -v grep | head -1"]);
                if (/\bT\b/.test(statOut)) paused = true;
              } catch(e5) {}
              status = { state: paused ? 'paused' : 'running', percent, step, detail, startedAt, updatedAt: new Date().toISOString(), legacy: true };
            }
          } catch(e) { /* pgrep returns 1 when no match */ }
        }

        // Enrich with disk info for any running/paused backup
        if (status.state === 'running' || status.state === 'paused') {
          const nfsPath = (_localConfig && _localConfig.nfsMountPath) || '/mnt/backup';
          // df is instant — always include
          try {
            const dfOut = await execCmd('df', ['-B1', '--output=size,used,avail', nfsPath]);
            const dfLines = dfOut.trim().split('\n');
            if (dfLines.length >= 2) {
              const parts = dfLines[1].trim().split(/\s+/);
              status.diskTotal = parseInt(parts[0]) || 0;
              status.diskUsed = parseInt(parts[1]) || 0;
              status.diskFree = parseInt(parts[2]) || 0;
            }
          } catch(e) {}
          // Backup size: use diskUsed from df (already represents total usage on the NFS mount)
          // This avoids the very slow du -sb on large backup dirs
          status.backupSize = status.diskUsed || 0;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/backup-history ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-history') {
    (async () => {
      const histPath = path.join(PROJECT_ROOT, 'config', 'backup-history.json');
      try {
        const raw = await fsp.readFile(histPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw);
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
    })();
    return true;
  }

  // ── Route : GET /api/backup-schedule ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-schedule') {
    (async () => {
      try {
        const cronOut = await execCmd('crontab', ['-l']);
        const line = cronOut.split('\n').find(l => l.includes('BIRDASH_BACKUP') && !l.startsWith('#'));
        let schedule = null;
        if (line) {
          const parts = line.trim().split(/\s+/);
          const min = parts[0], hour = parts[1], dow = parts[4];
          const time = (hour.length === 1 ? '0' : '') + hour + ':' + (min.length === 1 ? '0' : '') + min;
          const type = dow === '*' ? 'daily' : 'weekly';
          const now = new Date();
          const next = new Date(now);
          next.setHours(parseInt(hour), parseInt(min), 0, 0);
          if (type === 'weekly') {
            const targetDay = parseInt(dow);
            let daysUntil = (targetDay - now.getDay() + 7) % 7;
            if (daysUntil === 0 && next <= now) daysUntil = 7;
            next.setDate(now.getDate() + daysUntil);
          } else {
            if (next <= now) next.setDate(next.getDate() + 1);
          }
          schedule = { type, time, nextRun: next.toISOString(), cronLine: line.trim() };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ schedule }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ schedule: null }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/backup-pause ────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-pause') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        // Find backup process (new or legacy)
        let pids = [];
        for (const pattern of ['backup-biloute\\.sh', 'scripts/backup\\.sh']) {
          try {
            const out = await execCmd('pgrep', ['-f', pattern]);
            pids.push(...out.trim().split('\n').filter(Boolean));
          } catch(e) {}
        }
        // Also find child rsync processes
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*/mnt/backup']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*BirdSongs']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}

        if (pids.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No backup process found' }));
          return;
        }

        const unique = [...new Set(pids)];
        // Check current state — if stopped (T), resume with SIGCONT; else pause with SIGSTOP
        let action = 'pause';
        try {
          const statOut = await execCmd('bash', ['-c', `cat /proc/${unique[0]}/status 2>/dev/null | grep State`]);
          if (/stopped|tracing/.test(statOut)) action = 'resume';
        } catch(e) {}

        const signal = action === 'pause' ? 'STOP' : 'CONT';
        for (const pid of unique) {
          try { await execCmd('kill', [`-${signal}`, pid]); } catch(e) {}
        }

        // Update status file
        const statusPath = path.join(PROJECT_ROOT, 'config', 'backup-status.json');
        try {
          const raw = await fsp.readFile(statusPath, 'utf8');
          const s = JSON.parse(raw);
          if (action === 'pause') { s.state = 'paused'; s.detail = 'Mis en pause'; }
          else { s.state = 'running'; s.detail = 'Reprise...'; }
          s.updatedAt = new Date().toISOString();
          await fsp.writeFile(statusPath, JSON.stringify(s));
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/backup-stop ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-stop') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        let pids = [];
        for (const pattern of ['backup-biloute\\.sh', 'scripts/backup\\.sh']) {
          try {
            const out = await execCmd('pgrep', ['-f', pattern]);
            pids.push(...out.trim().split('\n').filter(Boolean));
          } catch(e) {}
        }
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*/mnt/backup']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*BirdSongs']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}

        if (pids.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No backup process found' }));
          return;
        }

        const unique = [...new Set(pids)];
        // First SIGCONT (in case paused), then SIGTERM
        for (const pid of unique) {
          try { await execCmd('kill', ['-CONT', pid]); } catch(e) {}
        }
        for (const pid of unique) {
          try { await execCmd('kill', ['-TERM', pid]); } catch(e) {}
        }

        // Update status file
        const statusPath = path.join(PROJECT_ROOT, 'config', 'backup-status.json');
        try {
          const s = { state: 'stopped', percent: 0, step: '', detail: 'Arrêté par l\'utilisateur', startedAt: null, updatedAt: new Date().toISOString() };
          // Try to preserve percent from existing status
          try {
            const raw = await fsp.readFile(statusPath, 'utf8');
            const prev = JSON.parse(raw);
            s.percent = prev.percent || 0;
            s.step = prev.step || '';
            s.startedAt = prev.startedAt;
          } catch(e) {}
          await fsp.writeFile(statusPath, JSON.stringify(s));
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, killed: unique.length }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // Route : GET /api/export/ebird
  if (req.method === 'GET' && pathname === '/api/export/ebird') {
    (async () => {
    try {
      const qp   = new URL(req.url, 'http://localhost').searchParams;
      const from = qp.get('from') || '2000-01-01';
      const to   = qp.get('to')   || '2099-12-31';
      const conf = parseFloat(qp.get('conf') || '0');

      const rows = db.prepare(
        'SELECT Com_Name, Sci_Name, Date, COUNT(*) as cnt FROM detections WHERE Date BETWEEN ? AND ? AND Confidence >= ? GROUP BY Date, Com_Name ORDER BY Date, Com_Name'
      ).all(from, to, conf);

      const bConf = await parseBirdnetConf();
      const lat = bConf.LATITUDE  || '';
      const lon = bConf.LONGITUDE || '';

      const csvHeaders = 'Common Name,Genus,Species,Number,Date,Start Time,State/Province,Country,Location,Latitude,Longitude,Protocol,Duration,All Obs Reported';
      const csvLines = [csvHeaders];
      for (const r of rows) {
        const parts = (r.Sci_Name || '').split(' ');
        const genus   = parts[0] || '';
        const species = parts.slice(1).join(' ') || '';
        // Convert YYYY-MM-DD to MM/DD/YYYY
        const dp = (r.Date || '').split('-');
        const dateFmt = dp.length === 3 ? dp[1] + '/' + dp[2] + '/' + dp[0] : r.Date;
        csvLines.push([
          '"' + (r.Com_Name || '').replace(/"/g, '""') + '"',
          '"' + genus.replace(/"/g, '""') + '"',
          '"' + species.replace(/"/g, '""') + '"',
          r.cnt,
          dateFmt,
          '',
          '',
          '',
          '',
          lat,
          lon,
          'Stationary',
          '',
          'N',
        ].join(','));
      }

      const csv = csvLines.join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="birdash-ebird-' + from + '-to-' + to + '.csv"',
      });
      res.end(csv);
    } catch (err) {
      console.error('[ebird-export]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    })();
    return true;
  }


  return false; // not handled
}

function shutdown() {
  if (_activeBackupProc) try { _activeBackupProc.kill(); } catch{}
}

module.exports = { handle, shutdown };
