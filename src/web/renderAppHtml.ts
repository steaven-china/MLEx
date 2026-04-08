import type { I18n } from "../i18n/index.js";
import { renderAppClientScript } from "./renderAppHtml.clientScript.js";

export function renderAppHtml(i18n: I18n): string {
  const escapedMessages = JSON.stringify(i18n.messages).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${i18n.locale}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${i18n.t("web.title.app")}</title>
  <style>
    :root {
      --bg: #f7f7f8;
      --panel: #ffffff;
      --ink: #111827;
      --muted: #6b7280;
      --line: #e5e7eb;
      --accent: #111827;
      --accent-2: #374151;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; height: 100%; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; background: var(--bg); color: var(--ink); }
    .shell { max-width: 1400px; margin: 0 auto; height: 100%; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .layout { flex: 1; min-height: 0; display: flex; gap: 12px; }
    .card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 8px 30px rgba(17, 24, 39, 0.04); animation: cardIn 220ms ease-out; }
    .header { padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
    .title { font-size: 15px; font-weight: 600; letter-spacing: 0.2px; }
    .status-wrap { display: flex; align-items: center; gap: 8px; min-height: 20px; }
    .status-tip {
      font-size: 11px;
      color: #4b5563;
      background: #f3f4f6;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 3px 8px;
      opacity: 0;
      transform: translateX(4px);
      transition: opacity 180ms ease, transform 180ms ease;
      white-space: nowrap;
      max-width: 340px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .status-tip.show { opacity: 1; transform: translateX(0); }
    .status { font-size: 12px; color: var(--muted); transition: color 160ms ease; }
    .status[data-live="1"]::before { content: "●"; color: #16a34a; margin-right: 6px; }
    .status[data-live="0"]::before { content: "●"; color: #ef4444; margin-right: 6px; animation: pulseDot 1s ease-in-out infinite; }
    .status[data-live="0"] { animation: statusPulse 1.1s ease-in-out infinite; }
    .chat-panel { display:flex; flex: 1; min-height:0; flex-direction:column; }
    .messages { flex: 1; min-height: 0; padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .bubble { max-width: 85%; white-space: pre-wrap; line-height: 1.55; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line); animation: bubbleIn 220ms cubic-bezier(.2,.8,.2,1); }
    .bubble.user { margin-left: auto; background: #111827; color: #fff; border-color: #111827; transform-origin: right bottom; }
    .bubble.assistant { margin-right: auto; background: #fff; color: #111827; transform-origin: left bottom; }
    .bubble.assistant.streaming { color: #4b5563; position: relative; overflow: hidden; }
    .bubble.assistant.streaming::after { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 25%, rgba(255,255,255,0.65) 45%, transparent 65%); animation: shimmer 1.3s linear infinite; }
    .composer { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-top: 1px solid var(--line); }
    textarea { width: 100%; resize: vertical; min-height: 78px; max-height: 220px; border: 1px solid var(--line); outline: none; border-radius: 10px; padding: 10px; font: inherit; background: #fff; transition: border-color 140ms ease, box-shadow 140ms ease; }
    textarea:focus { border-color: #9ca3af; box-shadow: 0 0 0 3px rgba(17,24,39,0.06); }
    .actions { display: flex; gap: 8px; justify-content: flex-end; }
    button { border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 10px; padding: 8px 12px; cursor: pointer; font: inherit; transition: transform 120ms ease, box-shadow 120ms ease, background-color 120ms ease, color 120ms ease; }
    button:hover { transform: translateY(-1px); box-shadow: 0 5px 14px rgba(17, 24, 39, 0.08); }
    button:active { transform: translateY(0); }
    button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    button.primary:disabled { background: var(--accent-2); border-color: var(--accent-2); cursor: not-allowed; box-shadow: none; transform: none; }
    .hint { padding: 0 14px 12px; color: var(--muted); font-size: 12px; }
    .raw-context { margin: 0 14px 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; overflow: hidden; transition: border-color 140ms ease; }
    .raw-context > summary { cursor: pointer; padding: 8px 10px; font-size: 12px; color: var(--muted); background: #f9fafb; }
    .raw-context[open] > summary { border-bottom: 1px solid var(--line); }
    .raw-context pre { margin: 0; padding: 10px; max-height: 220px; overflow: auto; font-size: 12px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; background: #fcfcfd; }
    .debug { width: 520px; max-width: 48%; display: flex; flex-direction: column; min-height: 0; }
    .debug-head { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .debug-scroll { overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .storage-line { font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #f3f4f6; word-break: break-all; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .metric { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #fff; }
    .metric-label { font-size: 11px; color: var(--muted); }
    .metric-value { font-size: 18px; font-weight: 600; margin-top: 2px; }
    .retention { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: #fff; }
    .retention-title { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
    .retention-bar { height: 10px; width: 100%; display: flex; overflow: hidden; border-radius: 999px; background: #f3f4f6; }
    .retention-bar > span { display: block; height: 100%; }
    .bar-raw { background: #16a34a; }
    .bar-compressed { background: #f59e0b; }
    .bar-conflict { background: #ef4444; }
    .retention-text { margin-top: 6px; font-size: 11px; color: var(--muted); }
    .section { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #fff; }
    .section-head { padding: 8px 10px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; }
    .table-wrap { max-height: 190px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--line); white-space: nowrap; }
    th { background: #f3f4f6; font-size: 11px; color: var(--muted); position: sticky; top: 0; z-index: 1; }
    tr[data-clickable="1"] { cursor: pointer; }
    tr[data-clickable="1"]:hover td { background: #fafafa; }
    .context-yes { color: #16a34a; font-weight: 600; }
    .empty { padding: 10px; font-size: 12px; color: var(--muted); }
    .modal { position: fixed; inset: 0; background: rgba(17, 24, 39, 0.45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 30; }
    .modal[hidden] { display: none !important; }
    .modal-card { width: min(960px, 95vw); max-height: 90vh; background: #fff; border-radius: 12px; border: 1px solid var(--line); overflow: hidden; display: flex; flex-direction: column; }
    .modal-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .modal-title { font-size: 14px; font-weight: 600; }
    .modal-content { margin: 0; padding: 12px; overflow: auto; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; flex: 1; background: #fcfcfd; }
    .session-modal-card { width: min(900px, 95vw); }
    .session-head-actions { display: flex; align-items: center; gap: 8px; }
    .session-meta { padding: 10px 12px; border-bottom: 1px solid var(--line); font-size: 12px; color: var(--muted); background: #f9fafb; }
    .session-table-wrap { max-height: 60vh; }
    .session-title-wrap { display: flex; flex-direction: column; gap: 3px; }
    .session-title { font-weight: 600; color: var(--ink); }
    .session-id { font-size: 11px; color: var(--muted); }
    .session-actions { display: flex; align-items: center; gap: 6px; }
    .session-actions button { padding: 6px 9px; border-radius: 8px; font-size: 12px; }
    .session-active-dot { color: #16a34a; font-weight: 700; }
    .session-inactive-dot { color: #9ca3af; }
    .session-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid #d1d5db;
      background: #f9fafb;
      color: #374151;
      font-size: 11px;
      line-height: 1;
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @keyframes cardIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes bubbleIn {
      from { opacity: 0; transform: translateY(8px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes pulseDot {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    @keyframes statusPulse {
      0%, 100% { color: var(--muted); }
      50% { color: #111827; }
    }
    @keyframes shimmer {
      from { transform: translateX(-100%); }
      to { transform: translateX(100%); }
    }
    @media (max-width: 960px) {
      .layout { flex-direction: column; }
      .debug { width: 100%; max-width: none; max-height: 50vh; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .status-tip { max-width: 60vw; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card header">
      <div class="title">${i18n.t("web.title.minimal")}</div>
      <div class="status-wrap">
        <div class="status-tip" id="statusTip"></div>
        <div class="status" id="status" data-live="1">${i18n.t("web.status.ready")}</div>
      </div>
    </section>
    <div class="layout">
      <section class="card chat-panel">
        <div class="messages" id="messages"></div>
        <form class="composer" id="composer">
          <textarea id="input" placeholder="${i18n.t("web.input.placeholder")}"></textarea>
          <div class="actions">
            <button type="button" id="sessionBtn">${i18n.t("web.button.session")}</button>
            <button type="button" id="debugBtn">${i18n.t("web.button.debug")}</button>
            <button type="button" id="sealBtn">${i18n.t("web.button.seal")}</button>
            <button type="button" id="stopBtn">${i18n.t("web.button.stop")}</button>
            <button type="submit" class="primary" id="sendBtn">${i18n.t("web.button.send")}</button>
          </div>
        </form>
        <div class="hint">${i18n.t("web.hint.main")}</div>
        <div class="hint">${i18n.t("web.hint.agent_files")}</div>
        <div class="hint" id="activeFileStatus">${i18n.t("web.hint.active_file_empty")}</div>
        <details class="raw-context">
          <summary>${i18n.t("web.raw_context.summary")}</summary>
          <pre id="rawContextView">${i18n.t("web.raw_context.empty")}</pre>
        </details>
      </section>
      <section class="card debug" id="debugPanel" hidden>
        <div class="debug-head">
          <span>${i18n.t("web.debug.title")}</span>
          <button type="button" id="refreshDebugBtn">${i18n.t("web.debug.refresh")}</button>
        </div>
        <div class="debug-scroll">
          <div class="storage-line" id="storageLine">${i18n.t("web.debug.storage_unloaded")}</div>
          <div class="metric-grid">
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.blocks")}</div><div class="metric-value" id="metricBlocks">0</div></div>
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.raw_buckets")}</div><div class="metric-value" id="metricRawBuckets">0</div></div>
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.raw_events")}</div><div class="metric-value" id="metricRawEvents">0</div></div>
            <div class="metric"><div class="metric-label">${i18n.t("web.metric.relations")}</div><div class="metric-value" id="metricRelations">0</div></div>
          </div>
          <div class="retention">
            <div class="retention-title">${i18n.t("web.debug.retention_distribution")}</div>
            <div class="retention-bar">
              <span class="bar-raw" id="barRaw" style="width:0%"></span>
              <span class="bar-compressed" id="barCompressed" style="width:0%"></span>
              <span class="bar-conflict" id="barConflict" style="width:0%"></span>
            </div>
            <div class="retention-text" id="retentionText">${i18n.t("web.retention.text", { raw: 0, compressed: 0, conflict: 0 })}</div>
          </div>
          <section class="section">
            <div class="section-head"><span>${i18n.t("web.debug.context_blocks")}</span><span id="contextMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>${i18n.t("web.table.index")}</th><th>${i18n.t("web.table.block")}</th><th>${i18n.t("web.table.score")}</th><th>${i18n.t("web.table.source")}</th><th>${i18n.t("web.table.time")}</th><th>${i18n.t("web.table.raw")}</th></tr></thead>
                <tbody id="contextRows"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head"><span>${i18n.t("web.debug.database_blocks")}</span><span id="blocksMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>${i18n.t("web.table.index")}</th><th>${i18n.t("web.table.block")}</th><th>${i18n.t("web.table.time")}</th><th>${i18n.t("web.table.tokens")}</th><th>${i18n.t("web.table.retention")}</th><th>${i18n.t("web.table.raw")}</th><th>${i18n.t("web.table.context_short")}</th></tr></thead>
                <tbody id="blockRows"></tbody>
              </table>
            </div>
          </section>
          <section class="section">
            <div class="section-head"><span>${i18n.t("web.debug.database_relations")}</span><span id="relationsMeta">0</span></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>${i18n.t("web.table.index")}</th><th>${i18n.t("web.table.type")}</th><th>${i18n.t("web.table.src")}</th><th>${i18n.t("web.table.dst")}</th><th>${i18n.t("web.table.time")}</th></tr></thead>
                <tbody id="relationRows"></tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </div>
  </main>
  <div class="modal" id="sessionModal" hidden>
    <div class="modal-card session-modal-card">
      <div class="modal-head">
        <span class="modal-title">${i18n.t("web.session.title")}</span>
        <div class="session-head-actions">
          <span class="session-badge" id="activeSessionBadge">${i18n.t("web.session.active_empty")}</span>
          <button type="button" id="newSessionBtn">${i18n.t("web.session.new")}</button>
          <button type="button" id="closeSessionModalBtn">${i18n.t("web.modal.close")}</button>
        </div>
      </div>
      <div class="session-meta" id="sessionMeta">${i18n.t("web.session.meta_empty")}</div>
      <div class="table-wrap session-table-wrap">
        <table>
          <thead>
            <tr>
              <th>${i18n.t("web.session.table.active")}</th>
              <th>${i18n.t("web.session.table.session")}</th>
              <th>${i18n.t("web.session.table.updated")}</th>
              <th>${i18n.t("web.session.table.messages")}</th>
              <th>${i18n.t("web.session.table.actions")}</th>
            </tr>
          </thead>
          <tbody id="sessionRows"></tbody>
        </table>
      </div>
    </div>
  </div>
  <div class="modal" id="detailModal" hidden>
    <div class="modal-card">
      <div class="modal-head">
        <span class="modal-title" id="modalTitle">${i18n.t("web.modal.detail")}</span>
        <button type="button" id="closeModalBtn">${i18n.t("web.modal.close")}</button>
      </div>
      <pre class="modal-content" id="modalContent"></pre>
    </div>
  </div>
  ${renderAppClientScript(escapedMessages)}
</body>
</html>`;
}
