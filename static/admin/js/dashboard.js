const state = {
  metrics: null,
  players: [],
  logs: [],
  recording: null,
  ws: null,
  delta: {
    selectedPlayerId: '',
    log: [],
    maxLogEntries: 60,
  },
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  wsIndicator: $('#ws-indicator'),
  wsLabel: $('#ws-indicator-label'),
  serverStatus: $('#server-status'),
  infoBanner: $('#info-banner'),
  metricsUpdated: $('#metrics-updated'),
  metricUptime: $('#metric-uptime'),
  metricPlayers: $('#metric-players'),
  metricCpu: $('#metric-cpu'),
  metricMemory: $('#metric-memory'),
  metricWs: $('#metric-ws'),
  metricBroadcast: $('#metric-broadcast'),
  playersUpdated: $('#players-updated'),
  playersTable: $('#players-table'),
  logsList: $('#logs-list'),
  recordingId: $('#recording-id'),
  recordingEntries: $('#recording-entries'),
  recordingState: $('#recording-state'),
  recordingSkip: $('#recording-skip'),
  recordingInterval: $('#recording-interval'),
  recordingDuration: $('#recording-duration'),
  recordingTarget: $('#recording-target'),
  recordingSampling: $('#recording-sampling'),
  recordingRoundRobin: $('#recording-roundrobin'),
  recordingPriority: $('#recording-priority'),
  recordingStartBtn: $('#recording-start-btn'),
  recordingStopBtn: $('#recording-stop-btn'),
  recordingRefreshBtn: $('#recording-refresh-btn'),
  recordingExportBtn: $('#recording-export-btn'),
  recordingExportFormat: $('#recording-export-format'),
  recordingExportCompress: $('#recording-export-compress'),
  recordingCanvas: $('#recording-canvas'),
  recordingCanvasEmpty: $('#recording-empty'),
  recordingEntriesCount: $('#recording-entries-count'),
  recordingSlider: $('#recording-slider'),
  recordingSliderLabel: $('#recording-slider-label'),
  refreshBtn: $('#refresh-btn'),
  clearLogsBtn: $('#clear-logs-btn'),
  deltaUpdated: $('#delta-updated'),
  deltaPlayerSelect: $('#delta-player-select'),
  deltaClient: $('#delta-client'),
  deltaClientMeta: $('#delta-client-meta'),
  deltaServer: $('#delta-server'),
  deltaServerMeta: $('#delta-server-meta'),
  deltaRatio: $('#delta-ratio'),
  deltaRatioHint: $('#delta-ratio-hint'),
  deltaLog: $('#delta-log'),
};

const formatNumber = (value, digits = 2) => {
  if (value === undefined || value === null) return '--';
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toFixed(digits);
};

const upsertDeltaLogEntry = (entry) => {
  state.delta.log.push(entry);
  if (state.delta.log.length > state.delta.maxLogEntries) {
    state.delta.log.splice(0, state.delta.log.length - state.delta.maxLogEntries);
  }
};

const renderDeltaLog = () => {
  const container = elements.deltaLog;
  if (!container) return;
  if (!state.delta.log.length) {
    container.innerHTML = '<div class="text-slate-500">No samples yet.</div>';
    return;
  }
  container.innerHTML = state.delta.log
    .slice(-state.delta.maxLogEntries)
    .map((row) => {
      const ratioBadge = row.ratio !== null && row.ratio !== undefined
        ? `<span class="text-slate-300">ratio ${formatNumber(row.ratio, 2)}</span>`
        : '<span class="text-slate-500">ratio --</span>';
      return `
        <div class="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2">
          <div class="flex items-center justify-between">
            <span class="text-slate-400">${row.time}</span>
            ${ratioBadge}
          </div>
          <div class="mt-1 text-slate-200">
            client ${formatNumber(row.client, 2)}/s · server ${formatNumber(row.server, 2)}/s
          </div>
        </div>
      `;
    })
    .join('');
};

const setSelectedDeltaPlayer = (playerId) => {
  state.delta.selectedPlayerId = playerId || '';
  if (elements.deltaPlayerSelect) {
    elements.deltaPlayerSelect.value = state.delta.selectedPlayerId;
  }
  state.delta.log = [];
  renderDeltaInspector();
};

const renderDeltaInspector = () => {
  const playerId = state.delta.selectedPlayerId;
  const player = playerId ? state.players.find((p) => p.id === playerId) : null;

  if (elements.deltaUpdated) {
    elements.deltaUpdated.textContent = new Date().toLocaleTimeString();
  }

  if (!player) {
    elements.deltaClient.textContent = '--';
    elements.deltaServer.textContent = '--';
    elements.deltaRatio.textContent = '--';
    elements.deltaClientMeta.textContent = '--';
    elements.deltaServerMeta.textContent = '--';
    elements.deltaRatioHint.textContent = '--';
    renderDeltaLog();
    return;
  }

  const client = typeof player.client_delta_per_sec === 'number' ? player.client_delta_per_sec : null;
  const server = typeof player.server_delta_per_sec === 'number' ? player.server_delta_per_sec : null;
  const ratio = client !== null && server !== null && server > 0 ? client / server : null;

  elements.deltaClient.textContent = client !== null ? `${formatNumber(client, 2)}` : '--';
  elements.deltaServer.textContent = server !== null ? `${formatNumber(server, 2)}` : '--';
  elements.deltaRatio.textContent = ratio !== null ? `${formatNumber(ratio, 2)}` : '--';

  elements.deltaClientMeta.textContent = player.client_delta_dt_ms
    ? `dt ${player.client_delta_dt_ms} ms · ts ${player.client_telemetry_ts_ms || '--'}`
    : '--';
  elements.deltaServerMeta.textContent = player.server_delta_dt_ms
    ? `dt ${player.server_delta_dt_ms} ms`
    : '--';

  if (ratio === null) {
    elements.deltaRatioHint.textContent = 'Awaiting both client and server samples';
  } else if (ratio > 1.5) {
    elements.deltaRatioHint.textContent = 'Client is moving faster than server (likely rubber-banding)';
  } else if (ratio < 0.7) {
    elements.deltaRatioHint.textContent = 'Client is moving slower than server (input gating or prediction off)';
  } else {
    elements.deltaRatioHint.textContent = 'Client/server deltas roughly aligned';
  }

  upsertDeltaLogEntry({
    time: new Date().toLocaleTimeString(),
    client,
    server,
    ratio,
  });
  renderDeltaLog();
};

const formatUptime = (seconds) => {
  if (seconds === undefined || seconds === null) return '--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${hrs}h ${mins}m ${secs}s`;
};

const formatTimestamp = (timestampSeconds) => {
  if (!timestampSeconds) return '--';
  return new Date(timestampSeconds * 1000).toLocaleTimeString();
};

const setServerStatus = (status) => {
  const el = elements.serverStatus;
  if (!el) return;
  el.classList.remove('status-pill--ok', 'status-pill--warning', 'status-pill--error');
  if (status === 'healthy') {
    el.textContent = 'Healthy';
    el.classList.add('status-pill--ok');
  } else if (status === 'degraded') {
    el.textContent = 'Degraded';
    el.classList.add('status-pill--warning');
  } else {
    el.textContent = 'Unknown';
    el.classList.add('status-pill--warning');
  }
};

const setWsState = (connected) => {
  elements.wsIndicator?.classList.toggle('bg-emerald-400', connected);
  elements.wsIndicator?.classList.toggle('bg-rose-500', !connected);
  if (elements.wsLabel) {
    elements.wsLabel.textContent = connected ? 'WebSocket: online' : 'WebSocket: offline';
  }
};

const updateInfoBanner = (message, variant = 'info') => {
  const banner = elements.infoBanner;
  if (!banner) return;
  if (!message) {
    banner.classList.add('hidden');
    banner.textContent = '';
    return;
  }
  banner.textContent = message;
  banner.classList.remove('hidden');
};

const renderMetrics = () => {
  if (!state.metrics) return;
  elements.metricUptime.textContent = formatUptime(state.metrics.uptime_seconds);
  elements.metricPlayers.textContent = state.metrics.players_count ?? '--';
  elements.metricCpu.textContent = state.metrics.cpu_percent ? `${state.metrics.cpu_percent.toFixed(1)}%` : '--';
  elements.metricMemory.textContent = state.metrics.memory_usage_mb ? `${state.metrics.memory_usage_mb} MB` : '--';
  elements.metricWs.textContent = state.metrics.websocket_connections ?? '--';
  elements.metricBroadcast.textContent = state.metrics.broadcast_time_average
    ? `${(state.metrics.broadcast_time_average * 1000).toFixed(2)} ms`
    : '--';
  elements.metricsUpdated.textContent = new Date().toLocaleTimeString();
  setServerStatus(state.metrics.status);
};

const formatCoords = (position = {}) => {
  const x = typeof position.x === 'number' ? position.x.toFixed(2) : '--';
  const y = typeof position.y === 'number' ? position.y.toFixed(2) : '--';
  const z = typeof position.z === 'number' ? position.z.toFixed(2) : '--';
  return `x:${x} y:${y} z:${z}`;
};

const renderPlayers = () => {
  const table = elements.playersTable;
  if (!table) return;
  table.innerHTML = '';

  if (elements.deltaPlayerSelect) {
    const previous = state.delta.selectedPlayerId;
    elements.deltaPlayerSelect.innerHTML = '<option value="">Select a player</option>';
    state.players.forEach((player) => {
      const opt = document.createElement('option');
      opt.value = player.id;
      opt.textContent = `${player.name || 'Unnamed'} (${player.id.slice(0, 8)})`;
      elements.deltaPlayerSelect.appendChild(opt);
    });
    if (previous && state.players.some((p) => p.id === previous)) {
      elements.deltaPlayerSelect.value = previous;
      state.delta.selectedPlayerId = previous;
    } else if (previous) {
      state.delta.selectedPlayerId = '';
    }
  }
  if (!state.players.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="5" class="py-4 text-center text-slate-500">No players online</td>';
    table.appendChild(row);
    return;
  }
  state.players.forEach((player) => {
    const row = document.createElement('tr');
    row.className = 'table-row';
    row.dataset.playerId = player.id;
    row.innerHTML = `
      <td class="py-3">
        <div class="font-semibold">${player.name || 'Unnamed'}</div>
        <div class="text-xs text-slate-500">${player.id}</div>
      </td>
      <td class="py-3 text-sm text-slate-300">${formatCoords(player.position)}</td>
      <td class="py-3 text-sm">${player.last_rtt_ms ? `${player.last_rtt_ms.toFixed(1)} ms` : '--'}</td>
      <td class="py-3 text-sm">${formatTimestamp(player.last_activity)}</td>
      <td class="py-3 text-right">
        <button class="btn-tertiary" data-action="kick" data-id="${player.id}">Kick</button>
      </td>
    `;
    table.appendChild(row);
  });
  elements.playersUpdated.textContent = new Date().toLocaleTimeString();
  renderDeltaInspector();
};

const renderRecording = () => {
  if (!state.recording) return;
  elements.recordingId.textContent = `ID: ${state.recording.recording_id || '--'}`;
  elements.recordingEntries.textContent = `Entries: ${state.recording.total_entries || 0}`;
  elements.recordingState.textContent = state.recording.active ? 'active' : 'idle';
  elements.recordingSkip.textContent = state.recording.last_skip_reason || '--';
};

const prepareRecordingPayload = () => {
  const payload = {
    interval_ms: Number(elements.recordingInterval?.value) || 100,
    duration_sec: Number(elements.recordingDuration?.value) || 120,
    target: elements.recordingTarget?.value || 'all',
    sampling_mode: elements.recordingSampling?.value || 'all',
  };
  const roundRobin = Number(elements.recordingRoundRobin?.value);
  if (!Number.isNaN(roundRobin) && roundRobin > 0) {
    payload.round_robin_sample_size = roundRobin;
  }
  const priorityRaw = elements.recordingPriority?.value || '';
  const ids = priorityRaw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length) {
    payload.priority_player_ids = ids;
  }
  return payload;
};

const postJson = async (url, body = {}) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'fetch',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
};

const handleRecordingStart = async () => {
  try {
    const payload = prepareRecordingPayload();
    await postJson('/admin/api/recording/start', payload);
    updateInfoBanner('Recording started.', 'success');
    await loadRecording();
    await fetchRecordingEntries();
  } catch (error) {
    console.error('start recording failed', error);
    updateInfoBanner('Failed to start recording.');
  }
};

const handleRecordingStop = async () => {
  try {
    await postJson('/admin/api/recording/stop');
    updateInfoBanner('Recording stopped.', 'info');
    await loadRecording();
  } catch (error) {
    console.error('stop recording failed', error);
    updateInfoBanner('Failed to stop recording.');
  }
};

const handleRecordingExport = () => {
  const format = elements.recordingExportFormat?.value || 'json';
  const compress = elements.recordingExportCompress?.checked;
  const url = new URL('/admin/api/recording/export', window.location.origin);
  url.searchParams.set('fmt', format);
  url.searchParams.set('compress', compress ? '1' : '0');
  window.open(url.toString(), '_blank');
};

const recordingState = {
  entries: [],
  minX: 0,
  maxX: 0,
  minZ: 0,
  maxZ: 0,
};

const updateRecordingBounds = () => {
  if (!recordingState.entries.length) {
    recordingState.minX = recordingState.maxX = 0;
    recordingState.minZ = recordingState.maxZ = 0;
    return;
  }
  recordingState.minX = Math.min(...recordingState.entries.map((e) => e.position?.x ?? 0));
  recordingState.maxX = Math.max(...recordingState.entries.map((e) => e.position?.x ?? 0));
  recordingState.minZ = Math.min(...recordingState.entries.map((e) => e.position?.z ?? 0));
  recordingState.maxZ = Math.max(...recordingState.entries.map((e) => e.position?.z ?? 0));
};

const drawRecordingSamples = (upToIndex) => {
  const canvas = elements.recordingCanvas;
  const emptyState = elements.recordingCanvasEmpty;
  if (!canvas || !canvas.getContext) {
    return;
  }
  const ctx = canvas.getContext('2d');
  const entries = recordingState.entries;
  if (!entries.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    emptyState?.classList.remove('hidden');
    return;
  }
  emptyState?.classList.add('hidden');

  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  const minX = recordingState.minX;
  const maxX = recordingState.maxX;
  const minZ = recordingState.minZ;
  const maxZ = recordingState.maxZ;
  const pad = 20;
  const scaleX = maxX !== minX ? (width - pad * 2) / (maxX - minX) : 1;
  const scaleZ = maxZ !== minZ ? (height - pad * 2) / (maxZ - minZ) : 1;

  const slice = entries.slice(0, Math.max(1, upToIndex));
  const grouped = slice.reduce((acc, entry) => {
    if (!entry.player_id) return acc;
    if (!acc[entry.player_id]) acc[entry.player_id] = [];
    acc[entry.player_id].push(entry);
    return acc;
  }, {});

  Object.values(grouped).forEach((trail, idx) => {
    if (trail.length < 2) return;
    ctx.beginPath();
    const hue = (idx * 57) % 360;
    ctx.strokeStyle = `hsl(${hue} 70% 60% / 0.9)`;
    trail.forEach((entry, entryIndex) => {
      const x = pad + (entry.position?.x - minX) * scaleX;
      const z = pad + (entry.position?.z - minZ) * scaleZ;
      if (entryIndex === 0) {
        ctx.moveTo(x, height - z);
      } else {
        ctx.lineTo(x, height - z);
      }
    });
    ctx.stroke();
  });
};

const updateRecordingSlider = () => {
  const slider = elements.recordingSlider;
  const label = elements.recordingSliderLabel;
  const total = recordingState.entries.length;
  elements.recordingEntriesCount.textContent = `${total} samples`;
  slider.max = Math.max(0, total - 1);
  slider.value = total ? slider.max : 0;
  label.textContent = total
    ? new Date(recordingState.entries[slider.value].timestamp).toLocaleTimeString()
    : '--';
};

const fetchRecordingEntries = async () => {
  try {
    const res = await jsonGet('/admin/api/recording/entries?limit=2000');
    recordingState.entries = res.entries || [];
    updateRecordingBounds();
    updateRecordingSlider();
    drawRecordingSamples(recordingState.entries.length);
  } catch (error) {
    console.error('Failed to load recording entries', error);
  }
};

const attachRecordingEvents = () => {
  elements.recordingStartBtn?.addEventListener('click', handleRecordingStart);
  elements.recordingStopBtn?.addEventListener('click', handleRecordingStop);
  elements.recordingRefreshBtn?.addEventListener('click', fetchRecordingEntries);
  elements.recordingExportBtn?.addEventListener('click', handleRecordingExport);
  elements.recordingSlider?.addEventListener('input', (evt) => {
    const idx = Number(evt.target.value);
    if (Number.isNaN(idx)) return;
    const entry = recordingState.entries[idx];
    elements.recordingSliderLabel.textContent = entry
      ? new Date(entry.timestamp).toLocaleTimeString()
      : '--';
    drawRecordingSamples(idx + 1);
  });
};

const renderLogs = () => {
  const container = elements.logsList;
  if (!container) return;
  const logs = state.logs.slice(-200);
  container.innerHTML = logs
    .map(
      (log) => {
        const meta = log.metadata || {};
        const metaParts = [];
        if (meta.name) metaParts.push(`Name: ${meta.name}`);
        if (meta.color) metaParts.push(`Color: ${meta.color}`);
        if (meta.ip) metaParts.push(`IP: ${meta.ip}`);
        const metaLine = metaParts.length
          ? `<div class="text-xs text-slate-400">${metaParts.join(' · ')}</div>`
          : '';
        return `
        <div class="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>${log.level}</span>
            <span>${new Date(log.timestamp * 1000).toLocaleTimeString()}</span>
          </div>
          <div class="text-sm text-slate-100">${log.message}</div>
          ${metaLine}
        </div>
      `;
      },
    )
    .join('');
};

const jsonGet = async (url) => {
  const res = await fetch(url, { headers: { 'X-Requested-With': 'fetch' } });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

const loadMetrics = async () => {
  state.metrics = await jsonGet('/admin/api/metrics');
  renderMetrics();
};

const loadPlayers = async () => {
  const data = await jsonGet('/admin/api/players');
  state.players = data.players || [];
  renderPlayers();
};

const loadRecording = async () => {
  state.recording = await jsonGet('/admin/api/recording/status');
  renderRecording();
};

const loadLogs = async () => {
  const data = await jsonGet('/admin/api/logs?limit=100');
  state.logs = data.logs || [];
  renderLogs();
};

const refreshAll = async () => {
  updateInfoBanner('Refreshing data...');
  try {
    await Promise.all([loadMetrics(), loadPlayers(), loadRecording(), loadLogs()]);
    updateInfoBanner(null);
  } catch (error) {
    console.error('Refresh failed', error);
    updateInfoBanner('Failed to refresh data. Check connection or session.');
  }
};

const handleKick = async (playerId) => {
  if (!playerId || !window.confirm('Kick this player?')) return;
  try {
    await fetch(`/admin/api/players/${playerId}/kick`, { method: 'POST' });
    await loadPlayers();
    updateInfoBanner(`Player ${playerId} kicked.`);
  } catch (error) {
    console.error('Kick failed', error);
    updateInfoBanner('Failed to kick player.');
  }
};

const attachTableEvents = () => {
  elements.playersTable?.addEventListener('click', (evt) => {
    const target = evt.target;
    if (target.matches('[data-action="kick"]')) {
      handleKick(target.getAttribute('data-id'));
      return;
    }

    const row = target.closest('tr[data-player-id]');
    if (row) {
      setSelectedDeltaPlayer(row.getAttribute('data-player-id'));
    }
  });
};

const attachDeltaEvents = () => {
  elements.deltaPlayerSelect?.addEventListener('change', (evt) => {
    setSelectedDeltaPlayer(evt.target.value);
  });
};

const pushLog = (entry) => {
  state.logs.push(entry);
  renderLogs();
};

const initWebSocket = () => {
  if (state.ws) {
    state.ws.close();
  }
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${protocol}://${window.location.host}/admin/ws`);
  ws.onopen = () => {
    state.ws = ws;
    setWsState(true);
    ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
  };
  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'metrics') {
        state.metrics = message.data;
        renderMetrics();
      } else if (message.type === 'players') {
        state.players = message.data;
        renderPlayers();
      } else if (message.type === 'log') {
        pushLog(message.data);
      } else if (message.type === 'logs') {
        state.logs = message.data;
        renderLogs();
      }
    } catch (error) {
      console.error('WebSocket message parse error', error);
    }
  };
  ws.onclose = () => {
    setWsState(false);
    state.ws = null;
    setTimeout(initWebSocket, 3000);
  };
  ws.onerror = (err) => {
    console.error('WebSocket error', err);
    ws.close();
  };
};

const init = async () => {
  attachTableEvents();
  attachDeltaEvents();
  attachRecordingEvents();
  elements.refreshBtn?.addEventListener('click', refreshAll);
  elements.clearLogsBtn?.addEventListener('click', () => {
    state.logs = [];
    renderLogs();
  });
  await refreshAll();
  await fetchRecordingEntries();
  initWebSocket();
};

document.addEventListener('DOMContentLoaded', init);
