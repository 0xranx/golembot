import type { ServerResponse } from 'node:http';
import type { GolemConfig, SkillInfo } from './workspace.js';
import { esc, formatUptime, FAVICON, DOCS_BASE, ENGINE_COLORS, BASE_CSS } from './ui-shared.js';

// ── Public types ─────────────────────────────────────────────────────────────

export interface ChannelStatus {
  type: string;
  status: 'connected' | 'failed' | 'not_configured';
  error?: string;
}

export interface RecentMessage {
  ts: string;
  source: string;
  sender: string;
  messagePreview: string;
  responsePreview: string;
  durationMs?: number;
  costUsd?: number;
  passed?: boolean;
}

export interface GatewayMetrics {
  totalMessages: number;
  totalCostUsd: number;
  totalDurationMs: number;
  messagesBySource: Record<string, number>;
  recentMessages: RecentMessage[];
  eventSubscribers: Set<ServerResponse>;
}

export interface DashboardContext {
  config: GolemConfig;
  skills: SkillInfo[];
  channelStatuses: ChannelStatus[];
  metrics: GatewayMetrics;
  startTime: number;
  version: string;
}

export function createMetrics(): GatewayMetrics {
  return {
    totalMessages: 0,
    totalCostUsd: 0,
    totalDurationMs: 0,
    messagesBySource: {},
    recentMessages: [],
    eventSubscribers: new Set(),
  };
}

const MAX_RECENT = 100;

export function recordMessage(metrics: GatewayMetrics, msg: RecentMessage): void {
  metrics.totalMessages++;
  if (msg.costUsd) metrics.totalCostUsd += msg.costUsd;
  if (msg.durationMs) metrics.totalDurationMs += msg.durationMs;
  metrics.messagesBySource[msg.source] = (metrics.messagesBySource[msg.source] ?? 0) + 1;

  metrics.recentMessages.push(msg);
  if (metrics.recentMessages.length > MAX_RECENT) metrics.recentMessages.shift();

  // Broadcast to SSE subscribers
  const payload = `data: ${JSON.stringify(msg)}\n\n`;
  for (const sub of metrics.eventSubscribers) {
    try { sub.write(payload); } catch { metrics.eventSubscribers.delete(sub); }
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

export const KNOWN_CHANNELS = ['feishu', 'dingtalk', 'wecom', 'slack', 'telegram', 'discord'];

const CHANNEL_LABELS: Record<string, string> = {
  feishu: 'Feishu (Lark)',
  dingtalk: 'DingTalk',
  wecom: 'WeCom',
  slack: 'Slack',
  telegram: 'Telegram',
  discord: 'Discord',
};


// ── Dashboard data ───────────────────────────────────────────────────────────

interface DashboardData {
  name: string;
  engine: string;
  model?: string;
  version: string;
  uptime: number;
  channels: ChannelStatus[];
  skills: { name: string; description: string }[];
  metrics: { totalMessages: number; totalCostUsd: number; avgDurationMs: number; messagesBySource: Record<string, number> };
  recentMessages: RecentMessage[];
  authEnabled: boolean;
  host: string;
  port: number;
}

export function buildDashboardData(ctx: DashboardContext): DashboardData {
  const avg = ctx.metrics.totalMessages > 0
    ? Math.round(ctx.metrics.totalDurationMs / ctx.metrics.totalMessages)
    : 0;
  return {
    name: ctx.config.name,
    engine: ctx.config.engine,
    model: ctx.config.model,
    version: ctx.version,
    uptime: Date.now() - ctx.startTime,
    channels: ctx.channelStatuses,
    skills: ctx.skills.map(s => ({ name: s.name, description: s.description })),
    metrics: {
      totalMessages: ctx.metrics.totalMessages,
      totalCostUsd: ctx.metrics.totalCostUsd,
      avgDurationMs: avg,
      messagesBySource: { ...ctx.metrics.messagesBySource },
    },
    recentMessages: [...ctx.metrics.recentMessages],
    authEnabled: !!(ctx.config.gateway?.token || process.env.GOLEM_TOKEN),
    host: ctx.config.gateway?.host ?? '127.0.0.1',
    port: ctx.config.gateway?.port ?? 3000,
  };
}

// ── HTML section renderers ───────────────────────────────────────────────────

function renderChannelRow(ch: ChannelStatus | undefined, type: string): string {
  const label = CHANNEL_LABELS[type] ?? esc(type);
  if (!ch || ch.status === 'not_configured') {
    return `<div class="ch-row ch-off"><span class="ch-dot dot-gray"></span><span class="ch-name">${label}</span><a href="${DOCS_BASE}/channels/${type}" target="_blank" class="ch-link">Setup Guide</a></div>`;
  }
  if (ch.status === 'failed') {
    return `<div class="ch-row ch-err"><span class="ch-dot dot-red"></span><span class="ch-name">${label}</span><span class="ch-err-msg">${esc(ch.error ?? 'failed')}</span></div>`;
  }
  return `<div class="ch-row ch-ok"><span class="ch-dot dot-green"></span><span class="ch-name">${label}</span><span class="ch-connected">Connected</span></div>`;
}

function renderHeader(data: DashboardData): string {
  const engineColor = ENGINE_COLORS[data.engine] ?? '#58a6ff';
  const connectedCount = data.channels.filter(c => c.status === 'connected').length;
  const modelBadge = data.model
    ? `<span class="badge" style="background:var(--border);color:var(--text)">${esc(data.model)}</span>`
    : '';

  return `
<div class="header">
  <h1><span class="product">GolemBot</span> Dashboard</h1>
  <span class="badge" style="background:${engineColor}">${esc(data.engine)}</span>
  ${modelBadge}
  <span><span class="status-dot"></span>Online</span>
  <span class="meta">v${esc(data.version)} &middot; uptime <span id="uptime">${formatUptime(data.uptime)}</span></span>
  <button class="shutdown-btn" onclick="shutdownGateway()" title="Shutdown this gateway">Shutdown</button>
</div>
<div class="subtitle">${esc(data.name)} &middot; ${connectedCount} channel${connectedCount !== 1 ? 's' : ''} connected &middot; ${data.skills.length} skill${data.skills.length !== 1 ? 's' : ''} loaded &middot; <a href="${DOCS_BASE}/" target="_blank">Documentation</a></div>`;
}

function renderAccessCards(data: DashboardData): string {
  const baseUrl = `http://${data.host}:${data.port}`;

  // Channel rows (known + custom)
  const knownRows = KNOWN_CHANNELS.map(type =>
    renderChannelRow(data.channels.find(c => c.type === type), type),
  ).join('\n');
  const customRows = data.channels
    .filter(c => !KNOWN_CHANNELS.includes(c.type))
    .map(c => renderChannelRow(c, c.type))
    .join('\n');

  // Code examples (highlighted + plain for copy)
  const curlToken = data.authEnabled ? `\n  -H &quot;Authorization: Bearer &lt;token&gt;&quot; \\` : '';
  const curlHtml = `<span class="hl-cmd">curl</span> -X POST ${esc(baseUrl)}/chat \\
  -H <span class="hl-str">&quot;Content-Type: application/json&quot;</span> \\${curlToken}
  -d <span class="hl-str">&#x27;{&quot;message&quot;: &quot;Hello!&quot;, &quot;sessionKey&quot;: &quot;my-session&quot;}&#x27;</span>`;

  const curlPlain = `curl -X POST ${baseUrl}/chat \\
  -H "Content-Type: application/json" \\${data.authEnabled ? '\n  -H "Authorization: Bearer <token>" \\' : ''}
  -d '{"message": "Hello!", "sessionKey": "my-session"}'`;

  const embedHtml = `<span class="hl-kw">import</span> { createAssistant } <span class="hl-kw">from</span> <span class="hl-str">&#x27;golembot&#x27;</span>;
<span class="hl-kw">const</span> bot = <span class="hl-fn">createAssistant</span>({ dir: <span class="hl-str">&#x27;./my-bot&#x27;</span> });

<span class="hl-kw">for await</span> (<span class="hl-kw">const</span> event <span class="hl-kw">of</span> bot.<span class="hl-fn">chat</span>(<span class="hl-str">&#x27;Hello!&#x27;</span>)) {
  <span class="hl-kw">if</span> (event.type === <span class="hl-str">&#x27;text&#x27;</span>) process.stdout.<span class="hl-fn">write</span>(event.content);
}`;

  const embedPlain = `import { createAssistant } from 'golembot';
const bot = createAssistant({ dir: './my-bot' });

for await (const event of bot.chat('Hello!')) {
  if (event.type === 'text') process.stdout.write(event.content);
}`;

  return `
<div class="section-label">Connect Your Agent</div>
<div class="grid">
  <div class="card">
    <h2><span class="step">1</span> IM Channels</h2>
    <p class="card-desc">Connect to messaging platforms — your team can @ the bot in group chats.</p>
    ${knownRows}
    ${customRows}
  </div>
  <div class="card">
    <h2><span class="step">2</span> HTTP API</h2>
    <p class="card-desc">Send messages programmatically via <code>POST /chat</code>. <a href="${DOCS_BASE}/api/http-api" target="_blank">API Docs</a></p>
    <pre data-copy="${esc(curlPlain)}"><button class="copy-btn" onclick="copyCode(this)">Copy</button>${curlHtml}</pre>
  </div>
  <div class="card">
    <h2><span class="step">3</span> Embed in Your Product</h2>
    <p class="card-desc">Use <code>createAssistant()</code> in Node.js to embed in your app. <a href="${DOCS_BASE}/guide/embed" target="_blank">Embed Guide</a></p>
    <pre data-copy="${esc(embedPlain)}"><button class="copy-btn" onclick="copyCode(this)">Copy</button>${embedHtml}</pre>
  </div>
</div>`;
}

function renderQuickTest(data: DashboardData): string {
  const tokenRow = data.authEnabled
    ? '<div class="test-form" style="margin-bottom:8px"><input class="test-input" id="test-token" type="password" placeholder="Enter gateway token to unlock..."><button class="test-btn" id="test-unlock" onclick="unlockTest()" style="background:var(--border)">Unlock</button></div>'
    : '';
  const disabled = data.authEnabled ? ' disabled' : '';

  return `
<div class="card" style="margin-bottom:24px">
  <h2><span class="icon">🧪</span> Quick Test</h2>
  <p class="card-desc">Try the HTTP API right here — type a message and see the response in real time.</p>
  ${tokenRow}
  <div class="test-form">
    <input class="test-input" id="test-msg" placeholder="Type a message..."${disabled}>
    <button class="test-btn" id="test-btn" onclick="sendTest()"${disabled}>Send</button>
  </div>
  <div class="test-output" id="test-output"></div>
</div>`;
}

function renderMonitoring(data: DashboardData): string {
  const { totalMessages, totalCostUsd, avgDurationMs, messagesBySource } = data.metrics;
  const avgDisplay = avgDurationMs > 0 ? (avgDurationMs / 1000).toFixed(1) + 's' : '-';

  const totalBySource = Object.entries(messagesBySource);
  const maxCount = Math.max(1, ...totalBySource.map(([, n]) => n));
  const statBars = totalBySource.length > 0
    ? totalBySource.map(([src, n]) => {
        const pct = Math.round((n / maxCount) * 100);
        return `<div class="bar-row"><span class="bar-label">${esc(src)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-val">${n}</span></div>`;
      }).join('\n')
    : '<div class="empty">No messages yet</div>';

  const skillRows = data.skills.length > 0
    ? data.skills.map(s => `<div class="skill-row"><span class="skill-name">${esc(s.name)}</span><span class="skill-desc">${esc(s.description)}</span></div>`).join('\n')
    : '<div class="empty">No skills installed</div>';

  return `
<div class="section-label">Monitoring</div>
<div class="grid">
  <div class="card">
    <h2><span class="icon">📊</span> Statistics</h2>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-val" id="stat-msgs">${totalMessages}</div><div class="stat-label">Messages</div></div>
      <div class="stat-box"><div class="stat-val" id="stat-cost">$${totalCostUsd.toFixed(4)}</div><div class="stat-label">Total Cost</div></div>
      <div class="stat-box"><div class="stat-val" id="stat-avg">${avgDisplay}</div><div class="stat-label">Avg Response</div></div>
    </div>
    <div id="stat-bars">${statBars}</div>
  </div>
  <div class="card">
    <h2><span class="icon">⚡</span> Skills</h2>
    ${skillRows}
    <p style="font-size:12px;color:var(--dim);margin-top:8px"><a href="${DOCS_BASE}/skills/overview" target="_blank">Browse 13,000+ skills on ClawHub</a></p>
  </div>
</div>`;
}

function renderActivityFeed(data: DashboardData): string {
  const tokenInput = data.authEnabled
    ? '<div class="token-input" id="token-input"><input type="password" id="token-val" placeholder="Enter gateway token to connect live feed..."><button onclick="connectSSE()">Connect</button></div>'
    : '';

  return `
<div class="card" style="margin-bottom:24px">
  <h2><span class="icon">📡</span> Live Activity</h2>
  ${tokenInput}
  <div class="feed" id="feed">
    <div class="feed-row header-row">
      <span>Time</span><span>Source</span><span>Message</span><span>Response</span><span>Duration</span><span>Cost</span>
    </div>
    <div class="empty" id="feed-empty">No activity yet — send a message to get started</div>
  </div>
</div>`;
}

function renderFooter(): string {
  return `<p style="text-align:center;font-size:12px;color:var(--dim)">Powered by <a href="${DOCS_BASE}/" target="_blank">GolemBot</a> &middot; <a href="https://github.com/0xranx/golembot" target="_blank">GitHub</a> &middot; <a href="https://discord.gg/tgU5FXChgM" target="_blank">Discord</a></p>`;
}

// ── Client-side JavaScript ───────────────────────────────────────────────────

function renderClientScript(data: DashboardData): string {
  const { metrics, recentMessages, authEnabled } = data;
  return `<script>
(function(){
  // Uptime ticker
  var startTime = ${data.uptime};
  var startTs = Date.now();
  var uptimeEl = document.getElementById('uptime');
  setInterval(function(){
    var ms = startTime + (Date.now() - startTs);
    var s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60), d = Math.floor(h/24);
    uptimeEl.textContent = (d>0?d+'d ':'')+(h%24)+'h '+(m%60)+'m '+(s%60)+'s';
  }, 1000);

  // State
  var feedEl = document.getElementById('feed');
  var emptyEl = document.getElementById('feed-empty');
  var authEnabled = ${authEnabled};
  var runningCost = ${metrics.totalCostUsd};
  var runningDurTotal = ${metrics.avgDurationMs * metrics.totalMessages};
  var runningMsgCount = ${metrics.totalMessages};
  var sourceCounters = ${JSON.stringify(metrics.messagesBySource)};

  // Stats
  function renderBars(){
    var barsEl = document.getElementById('stat-bars');
    if(!barsEl) return;
    var entries = Object.entries(sourceCounters);
    if(entries.length === 0){ barsEl.innerHTML = '<div class="empty">No messages yet</div>'; return; }
    var max = Math.max(1, ...entries.map(function(e){return e[1];}));
    barsEl.innerHTML = entries.map(function(e){
      var pct = Math.round(e[1]/max*100);
      return '<div class="bar-row"><span class="bar-label">'+esc(e[0])+'</span><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div><span class="bar-val">'+e[1]+'</span></div>';
    }).join('');
  }

  function updateStats(msg){
    runningMsgCount++;
    if(msg.costUsd) runningCost += msg.costUsd;
    if(msg.durationMs) runningDurTotal += msg.durationMs;
    sourceCounters[msg.source] = (sourceCounters[msg.source]||0) + 1;
    var me = document.getElementById('stat-msgs'); if(me) me.textContent = runningMsgCount;
    var ce = document.getElementById('stat-cost'); if(ce) ce.textContent = '$'+runningCost.toFixed(4);
    var ae = document.getElementById('stat-avg');  if(ae) ae.textContent = runningMsgCount > 0 ? (runningDurTotal/runningMsgCount/1000).toFixed(1)+'s' : '-';
    renderBars();
  }

  // Activity feed
  function renderFeedRow(msg){
    if(emptyEl){emptyEl.remove();emptyEl=null;}
    var row = document.createElement('div');
    row.className = 'feed-row';
    var t = new Date(msg.ts);
    var time = t.toLocaleTimeString()+'.'+String(t.getMilliseconds()).padStart(3,'0');
    var resp = msg.passed ? '<span class="feed-pass">[PASS]</span>' : esc(msg.responsePreview||'');
    var dur = msg.durationMs ? (msg.durationMs/1000).toFixed(1)+'s' : '-';
    var cost = msg.costUsd ? '$'+msg.costUsd.toFixed(4) : '-';
    row.innerHTML = '<span>'+time+'</span><span class="feed-src" style="background:var(--border)">'+esc(msg.source)+'</span><span class="feed-msg" title="'+esc(msg.messagePreview)+'">'+esc(msg.sender)+': '+esc(msg.messagePreview)+'</span><span class="feed-msg">'+resp+'</span><span>'+dur+'</span><span>'+cost+'</span>';
    feedEl.appendChild(row);
    feedEl.scrollTop = feedEl.scrollHeight;
  }

  // SSE
  function connectSSE(){
    var tokenParam = '';
    if(authEnabled){
      var inp = document.getElementById('token-val');
      if(inp && inp.value) tokenParam = '?token='+encodeURIComponent(inp.value);
      var ti = document.getElementById('token-input');
      if(ti) ti.style.display='none';
    }
    var es = new EventSource('/api/events'+tokenParam);
    es.onmessage = function(e){
      try{ var msg = JSON.parse(e.data); renderFeedRow(msg); updateStats(msg); }catch(err){}
    };
    es.onerror = function(){ es.close(); setTimeout(connectSSE, 3000); };
  }

  // Render history (UI only — stats already correct from server)
  ${JSON.stringify(recentMessages)}.forEach(renderFeedRow);
  if(!authEnabled) connectSSE();

  // Quick Test
  var testInput = document.getElementById('test-msg');
  var testBtn = document.getElementById('test-btn');
  var testOutput = document.getElementById('test-output');
  var testToken = '';

  if(testInput) testInput.addEventListener('keydown', function(e){ if(e.key==='Enter' && !testBtn.disabled) sendTest(); });

  window.unlockTest = function(){
    var inp = document.getElementById('test-token');
    if(!inp || !inp.value.trim()) return;
    testToken = inp.value.trim();
    testInput.disabled = false;
    testBtn.disabled = false;
    inp.parentElement.style.display = 'none';
  };

  window.sendTest = function(){
    var msg = testInput.value.trim();
    if(!msg) return;
    testBtn.disabled = true;
    testBtn.textContent = 'Sending...';
    testOutput.style.display = 'block';
    testOutput.textContent = '';
    var headers = { 'Content-Type': 'application/json' };
    if(testToken) headers['Authorization'] = 'Bearer ' + testToken;
    fetch('/chat', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ message: msg, sessionKey: 'dashboard-test' })
    }).then(function(res){
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      function read(){
        reader.read().then(function(result){
          if(result.done){ testBtn.disabled=false; testBtn.textContent='Send'; return; }
          var text = decoder.decode(result.value, {stream:true});
          var lines = text.split('\\n');
          for(var i=0;i<lines.length;i++){
            var line = lines[i].trim();
            if(line.startsWith('data: ')){
              try{
                var evt = JSON.parse(line.slice(6));
                if(evt.type==='text') testOutput.textContent += evt.content;
                if(evt.type==='error') testOutput.textContent += '\\n[Error: '+evt.message+']';
              }catch(e){}
            }
          }
          testOutput.scrollTop = testOutput.scrollHeight;
          read();
        });
      }
      read();
    }).catch(function(e){
      testOutput.textContent = 'Request failed: '+e.message;
      testBtn.disabled=false; testBtn.textContent='Send';
    });
  };

  window.shutdownGateway = function(){
    if(!confirm('Shutdown this gateway? The bot will stop serving requests.')) return;
    var btn = document.querySelector('.shutdown-btn');
    if(btn){btn.disabled=true;btn.textContent='Shutting down...';}
    var headers = { 'Content-Type': 'application/json' };
    if(testToken) headers['Authorization'] = 'Bearer ' + testToken;
    fetch('/shutdown', { method: 'POST', headers: headers }).then(function(res){
      return res.json();
    }).then(function(data){
      if(data.ok) document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#888"><div style="text-align:center"><h2>Gateway Stopped</h2><p>This gateway has been shut down.</p></div></div>';
      else { alert(data.error || 'Shutdown failed'); if(btn){btn.disabled=false;btn.textContent='Shutdown';} }
    }).catch(function(e){ alert('Request failed: '+e.message); if(btn){btn.disabled=false;btn.textContent='Shutdown';} });
  };

  window.copyCode = function(btn){
    var pre = btn.parentElement;
    var text = pre.getAttribute('data-copy') || pre.textContent.replace('Copy','').trim();
    navigator.clipboard.writeText(text).then(function(){btn.textContent='Copied!';setTimeout(function(){btn.textContent='Copy';},1500);});
  };

  function esc(s){if(!s)return'';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
})();
</script>`;
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const DASHBOARD_CSS = `
${BASE_CSS}

/* Channel list */
.ch-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px}
.ch-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-green{background:var(--green)} .dot-red{background:var(--red)} .dot-gray{background:var(--dim)}
.ch-name{flex:1} .ch-link{font-size:12px;color:var(--dim)} .ch-link:hover{color:var(--accent)}
.ch-connected{font-size:11px;color:var(--green)}
.ch-err-msg{font-size:11px;color:var(--red)}

/* Code blocks */
pre{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;padding-right:60px;font-size:12px;font-family:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;overflow-x:auto;position:relative;white-space:pre;line-height:1.6}
.copy-btn{position:absolute;top:6px;right:6px;background:var(--border);border:none;color:var(--text);padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer}
.copy-btn:hover{background:var(--accent);color:#fff}
.hl-kw{color:var(--kw)} .hl-str{color:var(--str)} .hl-fn{color:var(--fn)} .hl-cmd{color:var(--cmd);font-weight:600}

/* Quick test */
.test-form{display:flex;gap:8px}
.test-input{flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;font-family:inherit}
.test-input:focus{outline:none;border-color:var(--accent)}
.test-btn{background:var(--accent);color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}
.test-btn:hover{opacity:0.9} .test-btn:disabled{opacity:0.5;cursor:not-allowed}
.test-output{margin-top:10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 12px;font-size:12px;font-family:"SFMono-Regular",Consolas,monospace;white-space:pre-wrap;max-height:200px;overflow-y:auto;display:none;line-height:1.5}

/* Stats */
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}
.stat-box{text-align:center} .stat-val{font-size:22px;font-weight:700;color:var(--accent)} .stat-label{font-size:11px;color:var(--dim)}
.bar-row{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px}
.bar-label{width:80px;text-align:right;color:var(--dim);flex-shrink:0}
.bar-track{flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden}
.bar-fill{height:100%;background:var(--accent);border-radius:4px;transition:width .3s}
.bar-val{width:32px;font-size:11px;color:var(--dim)}

/* Activity feed */
.feed{max-height:400px;overflow-y:auto}
.feed-row{display:grid;grid-template-columns:140px 80px 1fr 1fr 60px 60px;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;align-items:center}
.feed-row.header-row{font-weight:600;color:var(--dim);border-bottom:2px solid var(--border)}
.feed-src{padding:1px 6px;border-radius:4px;font-size:11px;text-align:center}
.feed-pass{color:var(--orange);font-style:italic}
.feed-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Skills */
.skill-row{display:flex;gap:8px;padding:4px 0;font-size:13px}
.skill-name{font-weight:600;min-width:100px} .skill-desc{color:var(--dim)}

/* Token input */
.token-input{display:flex;gap:8px;margin-bottom:12px;align-items:center}
.token-input input{flex:1;background:var(--bg);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:12px;font-family:monospace}
.token-input button{background:var(--accent);color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:12px;cursor:pointer}

/* Shutdown button */
.shutdown-btn{background:#ef4444;color:#fff;border:none;padding:4px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;margin-left:auto;transition:opacity .15s}
.shutdown-btn:hover{opacity:.85}
.shutdown-btn:disabled{opacity:.5;cursor:not-allowed}

/* Responsive (dashboard-specific) */
@media(max-width:768px){
  .feed-row{grid-template-columns:1fr;gap:2px}
  .feed-row.header-row{display:none}
  .stat-grid{grid-template-columns:1fr}
}`.trim();

// ── Main renderer (assembler) ────────────────────────────────────────────────

export function renderDashboard(data: DashboardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.name)} — GolemBot Dashboard</title>
<link rel="icon" href="${FAVICON}">
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<div class="container">
${renderHeader(data)}
${renderAccessCards(data)}
${renderQuickTest(data)}
${renderMonitoring(data)}
${renderActivityFeed(data)}
${renderFooter()}
</div>
${renderClientScript(data)}
</body>
</html>`;
}
