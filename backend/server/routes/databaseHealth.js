// server/routes/health.js
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

async function safeDbPing(uri) {
  let conn;
  try {
    // Promise-based connection
    conn = await mongoose
      .createConnection(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      })
      .asPromise();

    // Ping the database
    await conn.db.admin().ping();
    return { status: 'connected' };
  } catch (err) {
    return { status: 'disconnected', error: err.message };
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

// This route checks the health of the Bahrain database connection

router.get('/', async (req, res) => {
  const startTime = Date.now();
  const result = await safeDbPing(process.env.DB_URL);

  const pingMs = Date.now() - startTime;
  const isOk = result.status === 'connected';
  const error = result.error || '';
  const timestamp = new Date().toISOString();
  const httpStatus = isOk ? 200 : 503;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DB Health Check</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Sora:wght@300;400;600;700&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --ok-glow:   #00ff9d;
      --ok-dim:    #00c97a;
      --ok-bg:     #0a1f15;
      --ok-card:   #0d2b1d;
      --ok-border: #1a4d32;

      --err-glow:   #ff4d6d;
      --err-dim:    #cc2244;
      --err-bg:     #1a0a0f;
      --err-card:   #2b0d16;
      --err-border: #4d1a26;

      --glow:   ${isOk ? 'var(--ok-glow)' : 'var(--err-glow)'};
      --dim:    ${isOk ? 'var(--ok-dim)' : 'var(--err-dim)'};
      --bg:     ${isOk ? 'var(--ok-bg)' : 'var(--err-bg)'};
      --card:   ${isOk ? 'var(--ok-card)' : 'var(--err-card)'};
      --border: ${isOk ? 'var(--ok-border)' : 'var(--err-border)'};
    }

    body {
      font-family: 'Sora', sans-serif;
      background: var(--bg);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background-image:
        radial-gradient(ellipse 60% 50% at 50% 0%, color-mix(in srgb, var(--glow) 8%, transparent), transparent),
        radial-gradient(ellipse 40% 30% at 80% 80%, color-mix(in srgb, var(--dim) 5%, transparent), transparent);
    }

    .card {
      width: 100%;
      max-width: 480px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 40px 36px;
      position: relative;
      overflow: hidden;
    }

    .card::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 20px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--glow) 6%, transparent) 0%, transparent 60%);
      pointer-events: none;
    }

    /* pulse ring */
    .status-wrap {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 28px;
    }

    .pulse-ring {
      position: relative;
      width: 48px;
      height: 48px;
      flex-shrink: 0;
    }

    .pulse-ring .dot {
      position: absolute;
      inset: 50%;
      transform: translate(-50%, -50%);
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--glow);
      box-shadow: 0 0 12px var(--glow);
    }

    .pulse-ring .ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid var(--glow);
      opacity: 0;
      animation: ${isOk ? 'ping 1.8s ease-out infinite' : 'none'};
    }

    .pulse-ring .ring:nth-child(2) { animation-delay: 0.6s; }

    @keyframes ping {
      0%   { transform: scale(0.5); opacity: 0.7; }
      100% { transform: scale(1.8); opacity: 0; }
    }

    .status-label {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--glow);
      line-height: 1;
    }

    .status-title {
      font-size: 26px;
      font-weight: 700;
      color: #f0f4f0;
      margin-top: 4px;
      line-height: 1.2;
    }

    /* divider */
    .divider {
      height: 1px;
      background: var(--border);
      margin: 24px 0;
    }

    /* stats grid */
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 24px;
    }

    .stat {
      background: color-mix(in srgb, var(--glow) 4%, transparent);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
    }

    .stat-key {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: color-mix(in srgb, var(--glow) 60%, #aaa);
      margin-bottom: 6px;
    }

    .stat-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 600;
      color: #e8f0e8;
      word-break: break-word;
    }

    .stat-val.accent { color: var(--glow); }

    /* error box */
    .error-box {
      background: color-mix(in srgb, var(--err-glow) 5%, transparent);
      border: 1px solid var(--err-border);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 24px;
    }

    .error-box .error-key {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--err-glow);
      margin-bottom: 6px;
    }

    .error-box .error-msg {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #ffb3c1;
      line-height: 1.5;
      word-break: break-word;
    }

    /* footer */
    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .db-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: color-mix(in srgb, var(--glow) 50%, #888);
      background: color-mix(in srgb, var(--glow) 6%, transparent);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
    }

    .http-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--glow) 15%, transparent);
      color: var(--glow);
      border: 1px solid color-mix(in srgb, var(--glow) 40%, transparent);
    }

    /* Add at the end of your style block */

    /* Responsive adjustments */
    @media (max-width: 600px) {
      .card {
        padding: 24px 20px;
      }

      .status-wrap {
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
      }

      .pulse-ring {
        width: 36px;
        height: 36px;
      }

      .pulse-ring .dot {
        width: 10px;
        height: 10px;
      }

      .status-title {
        font-size: 20px;
      }

      .stats {
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .stat {
        padding: 12px 14px;
      }

      .footer {
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }

      .db-name, .http-badge {
        padding: 4px 10px;
        font-size: 11px;
      }
    }
  </style>
</head>
<body>
  <div class="card">

    <div class="status-wrap">
      <div class="pulse-ring">
        <div class="ring"></div>
        <div class="ring"></div>
        <div class="dot"></div>
      </div>
      <div>
        <div class="status-label">${isOk ? 'Healthy' : 'Degraded'}</div>
        <div class="status-title">
          ${isOk ? 'MongoDB Connected' : 'Connection Failed'}
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="stats">
      <div class="stat">
        <div class="stat-key">Latency</div>
        <div class="stat-val accent">${pingMs} ms</div>
      </div>
      <div class="stat">
        <div class="stat-key">Status</div>
        <div class="stat-val accent">${isOk ? 'Online' : 'Offline'}</div>
      </div>
      <div class="stat" style="grid-column: 1 / -1;">
        <div class="stat-key">Timestamp</div>
        <div class="stat-val">${timestamp}</div>
      </div>
    </div>

    ${
      !isOk
        ? `
    <div class="error-box">
      <div class="error-key">Error</div>
      <div class="error-msg">${error}</div>
    </div>`
        : ''
    }

    <div class="footer">
      <span class="db-name">Bahrain_DB</span>
      <span class="http-badge">HTTP ${httpStatus}</span>
    </div>

  </div>
</body>
</html>`;

  res.status(httpStatus).send(html);
});

module.exports = router;
