export function renderAppClientScript(escapedMessages: string): string {
  return `  <script>
    const MESSAGES = ${escapedMessages};
    function t(key, params = {}) {
      const template = Object.prototype.hasOwnProperty.call(MESSAGES, key) ? MESSAGES[key] : key;
      return String(template).replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_, token) => {
        const value = params[token];
        return value == null ? "" : String(value);
      });
    }

    const messagesEl = document.getElementById("messages");
    const inputEl = document.getElementById("input");
    const composerEl = document.getElementById("composer");
    const sessionBtn = document.getElementById("sessionBtn");
    const sessionModal = document.getElementById("sessionModal");
    const sessionRows = document.getElementById("sessionRows");
    const sessionMeta = document.getElementById("sessionMeta");
    const activeSessionBadge = document.getElementById("activeSessionBadge");
    const newSessionBtn = document.getElementById("newSessionBtn");
    const closeSessionModalBtn = document.getElementById("closeSessionModalBtn");
    const debugBtn = document.getElementById("debugBtn");
    const debugPanel = document.getElementById("debugPanel");
    const refreshDebugBtn = document.getElementById("refreshDebugBtn");
    const sendBtn = document.getElementById("sendBtn");
    const stopBtn = document.getElementById("stopBtn");
    const sealBtn = document.getElementById("sealBtn");
    const statusEl = document.getElementById("status");
    const statusTipEl = document.getElementById("statusTip");
    const storageLine = document.getElementById("storageLine");
    const metricBlocks = document.getElementById("metricBlocks");
    const metricRawBuckets = document.getElementById("metricRawBuckets");
    const metricRawEvents = document.getElementById("metricRawEvents");
    const metricRelations = document.getElementById("metricRelations");
    const barRaw = document.getElementById("barRaw");
    const barCompressed = document.getElementById("barCompressed");
    const barConflict = document.getElementById("barConflict");
    const retentionText = document.getElementById("retentionText");
    const contextRows = document.getElementById("contextRows");
    const blockRows = document.getElementById("blockRows");
    const relationRows = document.getElementById("relationRows");
    const contextMeta = document.getElementById("contextMeta");
    const blocksMeta = document.getElementById("blocksMeta");
    const relationsMeta = document.getElementById("relationsMeta");
    const rawContextView = document.getElementById("rawContextView");
    const activeFileStatus = document.getElementById("activeFileStatus");
    const detailModal = document.getElementById("detailModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalContent = document.getElementById("modalContent");
    const closeModalBtn = document.getElementById("closeModalBtn");
    let debugVisible = false;
    let latestDebug = null;
    let debugApiEnabled = false;
    let debugAdminTokenRequired = false;
    let debugAdminToken = loadPersistedAdminToken();
    let debugCapabilitiesLoaded = false;
    const SESSION_STORAGE_KEY = "mlex.web.sessionId";
    const SESSION_CATALOG_KEY = "mlex.web.sessionCatalog.v1";
    const SESSION_MAX_ITEMS = 200;
    let activeSessionId = loadPersistedSessionId();
    const TRANSCRIPT_STORAGE_PREFIX = "mlex.web.transcript.";
    const TRANSCRIPT_MAX_ITEMS = 240;
    const TRANSCRIPT_MAX_ITEM_CHARS = 12000;
    let sessionCatalog = loadPersistedSessionCatalog();
    sessionCatalog = ensureSessionCatalogEntry(sessionCatalog, activeSessionId);
    persistSessionCatalog();
    let transcriptItems = loadPersistedTranscript(activeSessionId);
    let transcriptPersistTimer = null;
    let inflightRequestId = "";
    let activeAbortController = null;
    let proactiveEventSource = null;
    let pendingInterruptedContext = null;
    let statusTipTimer = null;
    const INTERRUPT_RETAIN_SENTENCE_LIMIT = 3;
    const INTERRUPT_RETAIN_FALLBACK_CHARS = 180;
    const INTERRUPT_RETAIN_MAX_CHARS = 400;

    renderDebugButtonState();
    renderSessionBadge();
    stopBtn.disabled = true;
    if (!restoreTranscript(transcriptItems)) {
      addBubble("assistant", t("web.greeting"));
    }
    void initializeCapabilities();
    initProactiveStream();

    composerEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = "";
      const commandHandled = await handleLocalCommand(text);
      if (commandHandled) return;
      await sendMessage(text);
    });

    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        composerEl.requestSubmit();
      }
    });

    sealBtn.addEventListener("click", async () => {
      setBusy(true, t("web.status.sealing"));
      try {
        const response = await fetch("/api/seal?sessionId=" + encodeURIComponent(activeSessionId), { method: "POST" });
        if (!response.ok) throw new Error(t("web.error.seal_failed"));
        addBubble("assistant", t("web.message.sealed"));
        if (debugVisible) {
          await refreshDebug();
        }
      } catch (error) {
        addBubble("assistant", t("web.error.seal_failed"));
      } finally {
        setBusy(false, t("web.status.ready"));
      }
    });

    sessionBtn.addEventListener("click", () => {
      openSessionModal();
    });

    closeSessionModalBtn.addEventListener("click", () => {
      closeSessionModal();
    });

    newSessionBtn.addEventListener("click", () => {
      void createSessionAndSwitch();
    });

    sessionRows.addEventListener("click", (event) => {
      void onSessionRowsClick(event);
    });

    stopBtn.addEventListener("click", () => {
      if (!activeAbortController) return;
      activeAbortController.abort();
    });

    debugBtn.addEventListener("click", async () => {
      if (!debugApiEnabled) {
        storageLine.textContent = t("web.error.debug_api_disabled");
        return;
      }
      if (debugAdminTokenRequired && !debugAdminToken) {
        const entered = promptAdminToken();
        if (!entered) {
          storageLine.textContent = t("web.error.debug_token_required");
          return;
        }
      }
      debugVisible = !debugVisible;
      debugPanel.hidden = !debugVisible;
      renderDebugButtonState();
      if (debugVisible) {
        await refreshDebug();
      }
    });

    refreshDebugBtn.addEventListener("click", async () => {
      await refreshDebug();
    });

    contextRows.addEventListener("click", onContextRowClick);
    blockRows.addEventListener("click", onBlockRowClick);
    relationRows.addEventListener("click", onRelationRowClick);

    closeModalBtn.addEventListener("click", closeModal);
    detailModal.addEventListener("click", (event) => {
      if (event.target === detailModal) {
        closeModal();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !sessionModal.hidden) {
        closeSessionModal();
        return;
      }
      if (event.key === "Escape" && !detailModal.hidden) {
        closeModal();
      }
    });
    window.addEventListener("beforeunload", () => {
      persistTranscript();
      if (!proactiveEventSource) return;
      proactiveEventSource.close();
      proactiveEventSource = null;
    });

    async function handleLocalCommand(text) {
      if (text === "/trace-clear") {
        addBubble("user", text);
        await handleTraceClearCommand();
        return true;
      }
      if (text === "/trace" || text.startsWith("/trace ")) {
        addBubble("user", text);
        await handleTraceCommand(text);
        return true;
      }
      return false;
    }

    async function handleTraceCommand(commandText, allowAuthRetry = true) {
      const limit = parseTraceLimit(commandText);
      setBusy(true, t("web.status.trace"));
      try {
        const response = await fetch("/api/debug/traces?limit=" + String(limit), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          addBubble("assistant", t("web.error.trace_api_disabled"));
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await handleTraceCommand(commandText, false);
              return;
            }
          }
          addBubble("assistant", t("web.error.trace_auth_failed"));
          return;
        }
        if (!response.ok) throw new Error(t("web.error.trace_fetch_failed"));
        const payload = await response.json();
        addBubble("assistant", JSON.stringify(payload, null, 2));
      } catch {
        addBubble("assistant", t("web.error.trace_fetch_failed"));
      } finally {
        setBusy(false, t("web.status.ready"));
      }
    }

    async function handleTraceClearCommand(allowAuthRetry = true) {
      setBusy(true, t("web.status.trace"));
      try {
        const response = await fetch("/api/debug/traces/clear", {
          method: "POST",
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          addBubble("assistant", t("web.error.trace_api_disabled"));
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await handleTraceClearCommand(false);
              return;
            }
          }
          addBubble("assistant", t("web.error.trace_auth_failed"));
          return;
        }
        if (!response.ok) throw new Error(t("web.error.trace_clear_failed"));
        addBubble("assistant", t("web.message.trace_cleared"));
        if (debugVisible) {
          await refreshDebug();
        }
      } catch {
        addBubble("assistant", t("web.error.trace_clear_failed"));
      } finally {
        setBusy(false, t("web.status.ready"));
      }
    }

    function parseTraceLimit(commandText) {
      const argument = commandText.slice("/trace".length).trim();
      const parsed = Number.parseInt(argument, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return 200;
      }
      return Math.min(parsed, 5000);
    }

    function initProactiveStream() {
      if (typeof EventSource !== "function") {
        return;
      }
      if (proactiveEventSource) {
        proactiveEventSource.close();
      }

      const streamUrl = "/api/proactive/stream?sessionId=" + encodeURIComponent(activeSessionId);
      const source = new EventSource(streamUrl);
      proactiveEventSource = source;

      source.addEventListener("proactive", (event) => {
        const payload = parseProactiveEventPayload(event.data);
        if (!payload || payload.sessionId !== activeSessionId) {
          return;
        }
        const proactiveReply =
          typeof payload.proactiveReply === "string" ? payload.proactiveReply.trim() : "";
        if (!proactiveReply) {
          return;
        }
        addBubble("assistant", proactiveReply);
        showStatusTip(buildProactiveStatusTip(proactiveReply));
        void updateDebug();
      });
    }

    async function sendMessage(text) {
      const sessionPending =
        pendingInterruptedContext && pendingInterruptedContext.sessionId === activeSessionId
          ? pendingInterruptedContext
          : null;
      const requestText = sessionPending
        ? composeInterruptResumePrompt(sessionPending.originalQuestion, sessionPending.partialText, text)
        : text;
      if (sessionPending) {
        pendingInterruptedContext = null;
      }

      addBubble("user", text);
      const assistantBubble = addBubble("assistant", "");
      assistantBubble.classList.add("streaming");
      setBusy(true, t("web.status.thinking"));
      const requestId = createRequestId();
      inflightRequestId = requestId;
      const abortController = new AbortController();
      activeAbortController = abortController;
      let textSoFar = "";

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: requestText, sessionId: activeSessionId, requestId }),
          signal: abortController.signal
        });

        if (!response.ok || !response.body) {
          const fallback = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: requestText, sessionId: activeSessionId, requestId }),
            signal: abortController.signal
          });
          if (!fallback.ok) {
            throw new Error(t("web.error.chat_fallback_failed"));
          }
          const data = await fallback.json();
          if (!isCurrentMessageFrame(data, requestId)) {
            return;
          }
          const replyText = typeof data.reply === "string" ? data.reply : t("web.error.request_failed");
          const proactiveText = typeof data.proactiveReply === "string" ? data.proactiveReply : "";
          assistantBubble.textContent = proactiveText
            ? replyText + "\\n\\n" + proactiveText
            : replyText;
          updateTranscriptBubble(assistantBubble, assistantBubble.textContent ?? "");
          if (proactiveText.trim().length > 0) {
            showStatusTip(buildProactiveStatusTip(proactiveText));
          }
          assistantBubble.classList.remove("streaming");
          renderActiveFileStatus(data.latestReadFilePath);
          renderRawContext(data.rawContext ?? {
            formatted: data.context ?? "",
            blocks: Array.isArray(data.blocks) ? data.blocks : [],
            prediction: data.prediction ?? null
          });
          await updateDebug();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\\n\\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseSseFrame(frame);
            if (!isCurrentMessageFrame(parsed.data, requestId)) {
              boundary = buffer.indexOf("\\n\\n");
              continue;
            }
            if (parsed.event === "token") {
              const token = parsed.data?.token ?? "";
              textSoFar += token;
              assistantBubble.textContent = textSoFar;
              updateTranscriptBubble(assistantBubble, textSoFar);
            } else if (parsed.event === "done") {
              if (!textSoFar && typeof parsed.data?.reply === "string") {
                textSoFar = parsed.data.reply;
              }
              const proactive = typeof parsed.data?.proactiveReply === "string" ? parsed.data.proactiveReply : "";
              assistantBubble.textContent = proactive ? textSoFar + "\\n\\n" + proactive : textSoFar;
              updateTranscriptBubble(assistantBubble, assistantBubble.textContent ?? "");
              if (proactive.trim().length > 0) {
                showStatusTip(buildProactiveStatusTip(proactive));
              }
              assistantBubble.classList.remove("streaming");
              renderActiveFileStatus(parsed.data?.latestReadFilePath);
              renderRawContext(parsed.data?.rawContext ?? {
                formatted: parsed.data?.context ?? "",
                blocks: Array.isArray(parsed.data?.blocks) ? parsed.data.blocks : [],
                prediction: parsed.data?.prediction ?? null
              });
              await updateDebug();
            } else if (parsed.event === "error") {
              assistantBubble.textContent = "[" + t("web.error.stream_unknown") + "] " + (parsed.data?.error ?? t("web.error.stream_unknown"));
              updateTranscriptBubble(assistantBubble, assistantBubble.textContent ?? "");
              assistantBubble.classList.remove("streaming");
            }
            messagesEl.scrollTop = messagesEl.scrollHeight;
            boundary = buffer.indexOf("\\n\\n");
          }
        }
      } catch (error) {
        const interrupted = abortController.signal.aborted;
        if (interrupted) {
          const interruptedText = formatInterruptedAssistantText(textSoFar);
          assistantBubble.textContent = interruptedText;
          updateTranscriptBubble(assistantBubble, interruptedText);
          assistantBubble.classList.remove("streaming");
          pendingInterruptedContext = {
            sessionId: activeSessionId,
            originalQuestion: text,
            partialText: textSoFar,
            at: Date.now()
          };
        } else {
          assistantBubble.textContent = t("web.error.stream_failed");
          updateTranscriptBubble(assistantBubble, assistantBubble.textContent ?? "");
          assistantBubble.classList.remove("streaming");
        }
      } finally {
        if (inflightRequestId === requestId) {
          inflightRequestId = "";
        }
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
        setBusy(false, t("web.status.ready"));
      }
    }

    function parseProactiveEventPayload(rawPayload) {
      if (typeof rawPayload !== "string" || rawPayload.trim().length === 0) {
        return null;
      }
      try {
        const parsed = JSON.parse(rawPayload);
        if (!parsed || typeof parsed !== "object") {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    }

    function addBubble(role, text) {
      const normalizedRole = normalizeTranscriptRole(role);
      const normalizedText = clipTranscriptText(String(text ?? ""));
      const index = appendTranscriptItem(normalizedRole, normalizedText);
      const bubble = appendBubbleElement(normalizedRole, normalizedText, index);
      return bubble;
    }

    function appendBubbleElement(role, text, index) {
      const bubble = document.createElement("div");
      bubble.className = "bubble " + role;
      bubble.textContent = text;
      bubble.dataset.transcriptIndex = String(index);
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return bubble;
    }

    function restoreTranscript(items) {
      if (!Array.isArray(items) || items.length === 0) return false;
      messagesEl.innerHTML = "";
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!item) continue;
        appendBubbleElement(item.role, item.text, index);
      }
      return true;
    }

    function appendTranscriptItem(role, text) {
      transcriptItems.push({ role, text });
      touchSession(activeSessionId);
      schedulePersistTranscript();
      return transcriptItems.length - 1;
    }

    function updateTranscriptBubble(bubble, text) {
      if (!bubble) return;
      const index = Number.parseInt(bubble.dataset.transcriptIndex ?? "-1", 10);
      if (!Number.isFinite(index) || index < 0) return;
      if (!transcriptItems[index]) return;
      transcriptItems[index].text = clipTranscriptText(String(text ?? ""));
      schedulePersistTranscript();
    }

    function schedulePersistTranscript() {
      if (transcriptPersistTimer) {
        clearTimeout(transcriptPersistTimer);
      }
      transcriptPersistTimer = setTimeout(() => {
        persistTranscript();
      }, 120);
    }

    async function onSessionRowsClick(event) {
      const button = event.target.closest("button[data-action][data-session-id]");
      if (!button) return;
      const action = String(button.dataset.action ?? "");
      const sessionId = String(button.dataset.sessionId ?? "").trim();
      if (!sessionId) return;

      if (action === "switch") {
        await switchSession(sessionId, true);
        return;
      }
      if (action === "rename") {
        renameSession(sessionId);
        return;
      }
      if (action === "delete") {
        await deleteSession(sessionId);
      }
    }

    function openSessionModal() {
      renderSessionModal();
      sessionModal.hidden = false;
    }

    function closeSessionModal() {
      sessionModal.hidden = true;
    }

    async function createSessionAndSwitch() {
      if (activeAbortController) {
        showStatusTip(t("web.session.switch_busy"));
        return;
      }
      const createdId = createRequestId();
      const suggestedName = t("web.session.default_name", { id: shortId(createdId) });
      const entered = window.prompt(t("web.session.prompt_new"), suggestedName);
      const title = normalizeSessionTitle(entered) || suggestedName;
      sessionCatalog = ensureSessionCatalogEntry(sessionCatalog, createdId, { title, updatedAt: Date.now() });
      persistSessionCatalog();
      await switchSession(createdId, false);
      openSessionModal();
    }

    async function switchSession(nextSessionId, closeModalAfterSwitch) {
      const targetId = String(nextSessionId ?? "").trim();
      if (!targetId || targetId === activeSessionId) {
        if (closeModalAfterSwitch) {
          closeSessionModal();
        }
        return true;
      }
      if (activeAbortController) {
        showStatusTip(t("web.session.switch_busy"));
        return false;
      }

      persistTranscript();
      touchSession(activeSessionId);
      activeSessionId = targetId;
      persistActiveSessionId(activeSessionId);
      sessionCatalog = ensureSessionCatalogEntry(sessionCatalog, activeSessionId, { updatedAt: Date.now() });
      persistSessionCatalog();
      transcriptItems = loadPersistedTranscript(activeSessionId);
      pendingInterruptedContext = null;
      inflightRequestId = "";
      if (activeAbortController) {
        activeAbortController.abort();
      }
      messagesEl.innerHTML = "";
      if (!restoreTranscript(transcriptItems)) {
        addBubble("assistant", t("web.greeting"));
      }
      renderSessionBadge();
      initProactiveStream();
      renderActiveFileStatus(null);
      renderRawContext({
        sessionId: activeSessionId,
        summary: t("web.session.switched", { id: shortId(activeSessionId) })
      });
      if (debugVisible) {
        await refreshDebug();
      }
      if (closeModalAfterSwitch) {
        closeSessionModal();
      }
      showStatusTip(t("web.session.switched", { id: shortId(activeSessionId) }));
      return true;
    }

    async function deleteSession(sessionId) {
      const normalizedId = String(sessionId ?? "").trim();
      if (!normalizedId) return;
      if (activeAbortController) {
        showStatusTip(t("web.session.switch_busy"));
        return;
      }
      const session = getSessionById(normalizedId);
      if (!session) return;
      const confirmed = window.confirm(
        t("web.session.confirm_delete", {
          name: session.title || shortId(session.id)
        })
      );
      if (!confirmed) return;

      if (normalizedId !== activeSessionId) {
        sessionCatalog = sessionCatalog.filter((item) => item.id !== normalizedId);
        persistSessionCatalog();
        try {
          window.sessionStorage.removeItem(TRANSCRIPT_STORAGE_PREFIX + normalizedId);
        } catch {}
        renderSessionModal();
        showStatusTip(t("web.session.deleted", { id: shortId(normalizedId) }));
        return;
      }

      let fallbackId = "";
      for (const item of sessionCatalog) {
        if (item.id === normalizedId) continue;
        fallbackId = item.id;
        break;
      }
      if (!fallbackId) {
        fallbackId = createRequestId();
        sessionCatalog = ensureSessionCatalogEntry(sessionCatalog, fallbackId);
      }
      sessionCatalog = sessionCatalog.filter((item) => item.id !== normalizedId);
      persistSessionCatalog();
      try {
        window.sessionStorage.removeItem(TRANSCRIPT_STORAGE_PREFIX + normalizedId);
      } catch {}
      await switchSession(fallbackId, false);
      renderSessionModal();
      showStatusTip(t("web.session.deleted", { id: shortId(normalizedId) }));
    }

    function renameSession(sessionId) {
      const normalizedId = String(sessionId ?? "").trim();
      if (!normalizedId) return;
      const session = getSessionById(normalizedId);
      if (!session) return;
      const entered = window.prompt(t("web.session.prompt_rename"), session.title);
      const nextTitle = normalizeSessionTitle(entered);
      if (!nextTitle) return;
      session.title = nextTitle;
      session.updatedAt = Date.now();
      persistSessionCatalog();
      renderSessionBadge();
      renderSessionModal();
    }

    function renderSessionModal() {
      if (!sessionRows || !sessionMeta) return;
      const rows = [...sessionCatalog].sort((left, right) => right.updatedAt - left.updatedAt);
      sessionMeta.textContent = t("web.session.meta", {
        count: rows.length,
        active: shortId(activeSessionId)
      });
      sessionRows.innerHTML = "";
      if (rows.length === 0) {
        sessionRows.appendChild(buildEmptyRow(5, t("web.session.empty")));
        return;
      }

      for (const item of rows) {
        const row = document.createElement("tr");

        const activeCell = buildCell(item.id === activeSessionId ? "●" : "○");
        activeCell.className = item.id === activeSessionId ? "session-active-dot" : "session-inactive-dot";
        row.appendChild(activeCell);

        const sessionCell = document.createElement("td");
        const sessionWrap = document.createElement("div");
        sessionWrap.className = "session-title-wrap";
        const titleEl = document.createElement("span");
        titleEl.className = "session-title";
        titleEl.textContent = item.title;
        const idEl = document.createElement("span");
        idEl.className = "session-id";
        idEl.textContent = item.id;
        sessionWrap.appendChild(titleEl);
        sessionWrap.appendChild(idEl);
        sessionCell.appendChild(sessionWrap);
        row.appendChild(sessionCell);

        row.appendChild(buildCell(fmtTime(item.updatedAt)));
        row.appendChild(buildCell(String(loadPersistedTranscript(item.id).length)));

        const actionsCell = document.createElement("td");
        const actionsWrap = document.createElement("div");
        actionsWrap.className = "session-actions";

        const switchBtn = document.createElement("button");
        switchBtn.type = "button";
        switchBtn.textContent = t("web.session.action_switch");
        switchBtn.dataset.action = "switch";
        switchBtn.dataset.sessionId = item.id;
        switchBtn.disabled = item.id === activeSessionId;
        actionsWrap.appendChild(switchBtn);

        const renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.textContent = t("web.session.action_rename");
        renameBtn.dataset.action = "rename";
        renameBtn.dataset.sessionId = item.id;
        actionsWrap.appendChild(renameBtn);

        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = t("web.session.action_delete");
        deleteBtn.dataset.action = "delete";
        deleteBtn.dataset.sessionId = item.id;
        actionsWrap.appendChild(deleteBtn);

        actionsCell.appendChild(actionsWrap);
        row.appendChild(actionsCell);
        sessionRows.appendChild(row);
      }
    }

    function renderSessionBadge() {
      const active = getSessionById(activeSessionId);
      const text = active
        ? t("web.session.badge", { name: active.title, id: shortId(active.id) })
        : t("web.session.active_empty");
      sessionBtn.textContent = t("web.button.session");
      activeSessionBadge.textContent = text;
    }

    function getSessionById(sessionId) {
      return sessionCatalog.find((item) => item.id === sessionId) ?? null;
    }

    function touchSession(sessionId) {
      sessionCatalog = ensureSessionCatalogEntry(sessionCatalog, sessionId, { updatedAt: Date.now() });
      persistSessionCatalog();
      renderSessionBadge();
      if (!sessionModal.hidden) {
        renderSessionModal();
      }
    }

    function ensureSessionCatalogEntry(catalog, sessionId, patch = {}) {
      const id = String(sessionId ?? "").trim();
      if (!id) return catalog;
      let entry = catalog.find((item) => item.id === id);
      if (!entry) {
        entry = {
          id,
          title: t("web.session.default_name", { id: shortId(id) }),
          updatedAt: Date.now()
        };
        catalog.push(entry);
      }
      if (typeof patch.title === "string" && patch.title.trim().length > 0) {
        entry.title = patch.title.trim().slice(0, 80);
      }
      if (typeof patch.updatedAt === "number" && Number.isFinite(patch.updatedAt)) {
        entry.updatedAt = patch.updatedAt;
      }
      if (!Number.isFinite(entry.updatedAt) || entry.updatedAt <= 0) {
        entry.updatedAt = Date.now();
      }
      trimSessionCatalog(catalog);
      return catalog;
    }

    function trimSessionCatalog(catalog) {
      if (!Array.isArray(catalog) || catalog.length <= SESSION_MAX_ITEMS) return;
      while (catalog.length > SESSION_MAX_ITEMS) {
        let oldestIndex = -1;
        let oldestTime = Number.POSITIVE_INFINITY;
        for (let index = 0; index < catalog.length; index += 1) {
          const item = catalog[index];
          if (!item || item.id === activeSessionId) continue;
          if (item.updatedAt < oldestTime) {
            oldestTime = item.updatedAt;
            oldestIndex = index;
          }
        }
        if (oldestIndex < 0) break;
        catalog.splice(oldestIndex, 1);
      }
    }

    function loadPersistedSessionCatalog() {
      try {
        const raw = window.sessionStorage.getItem(SESSION_CATALOG_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const normalized = [];
        const seen = new Set();
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const id = typeof item.id === "string" ? item.id.trim() : "";
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const title =
            normalizeSessionTitle(item.title) || t("web.session.default_name", { id: shortId(id) });
          const updatedAt =
            typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) && item.updatedAt > 0
              ? item.updatedAt
              : Date.now();
          normalized.push({ id, title, updatedAt });
        }
        return normalized;
      } catch {
        return [];
      }
    }

    function persistSessionCatalog() {
      try {
        window.sessionStorage.setItem(SESSION_CATALOG_KEY, JSON.stringify(sessionCatalog));
      } catch {}
    }

    function persistActiveSessionId(sessionId) {
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      } catch {}
    }

    function normalizeSessionTitle(value) {
      if (typeof value !== "string") return "";
      return value.trim().slice(0, 80);
    }

    function setBusy(isBusy, label) {
      sendBtn.disabled = isBusy;
      stopBtn.disabled = !isBusy;
      statusEl.textContent = label;
      statusEl.dataset.live = isBusy ? "0" : "1";
    }

    function showStatusTip(text, durationMs = 6000) {
      if (!statusTipEl || typeof text !== "string" || text.trim().length === 0) return;
      statusTipEl.textContent = text.trim();
      statusTipEl.classList.add("show");
      if (statusTipTimer) {
        clearTimeout(statusTipTimer);
      }
      statusTipTimer = setTimeout(() => {
        if (!statusTipEl) return;
        statusTipEl.classList.remove("show");
      }, Math.max(1200, durationMs));
    }

    function buildProactiveStatusTip(proactiveText) {
      const normalized = String(proactiveText ?? "").toLowerCase();
      if (
        normalized.includes("low_entropy") ||
        normalized.includes("relation") ||
        normalized.includes("因果") ||
        normalized.includes("实体") ||
        normalized.includes("关系") ||
        normalized.includes("依赖")
      ) {
        return t("web.status_tip.low_entropy");
      }
      if (
        normalized.includes("topic") ||
        normalized.includes("话题") ||
        normalized.includes("新目标") ||
        normalized.includes("切换")
      ) {
        return t("web.status_tip.topic_shift");
      }
      return t("web.status_tip.generic");
    }

    function parseSseFrame(frame) {
      let event = "message";
      const dataLines = [];
      for (const line of frame.split("\\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
      const raw = dataLines.join("\\n");
      let data = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = { raw };
        }
      }
      return { event, data };
    }

    function composeInterruptResumePrompt(previousQuestion, partialAssistantText, newQuestion) {
      const retainedPrefix = retainLeadingSentences(partialAssistantText);
      return [
        "你正在继续一次被打断的对话。",
        "[打断前用户问题]",
        (previousQuestion || "").trim() || "(空)",
        "",
        "[已输出但被打断的前文（节选）]",
        retainedPrefix || "(无)",
        "",
        "[用户打断后新输入]",
        (newQuestion || "").trim() || "(空)",
        "",
        "请遵循：优先延续原回答；若新输入要求转向，先衔接一句再转答；避免重复已输出内容。"
      ].join("\\n");
    }

    function retainLeadingSentences(content) {
      const normalized = String(content ?? "").replace(/\\r\\n/g, "\\n").trim();
      if (!normalized) return "";
      const compact = normalized.replace(/\\n{2,}/g, "\\n");
      const sentenceMatches = compact.match(/[^。！？!?\\n]+(?:[。！？!?]|\\n|$)/g) ?? [];
      const sentences = sentenceMatches
        .map((chunk) => chunk.trim())
        .filter((chunk) => chunk.length > 0)
        .slice(0, INTERRUPT_RETAIN_SENTENCE_LIMIT);
      const fromSentences = sentences.join(" ").trim();
      const fallback = compact.slice(0, INTERRUPT_RETAIN_FALLBACK_CHARS).trim();
      const hasDelimiter = /[。！？!?\\n]/.test(compact);
      const selected = !hasDelimiter && fromSentences.length > INTERRUPT_RETAIN_FALLBACK_CHARS
        ? fallback
        : fromSentences || fallback;
      if (!selected) return "";
      return selected.slice(0, INTERRUPT_RETAIN_MAX_CHARS).trim();
    }

    function formatInterruptedAssistantText(content) {
      const trimmed = String(content ?? "").trim();
      if (!trimmed) {
        return t("web.placeholder.interrupted");
      }
      return trimmed + "\\n\\n" + t("web.placeholder.interrupted");
    }

    function isCurrentMessageFrame(data, requestId) {
      if (!data || typeof data !== "object") return false;
      if (inflightRequestId !== requestId) return false;
      if (typeof data.requestId !== "string") return false;
      if (data.requestId !== requestId) return false;
      if (typeof data.sessionId !== "string") return false;
      return data.sessionId === activeSessionId;
    }

    async function updateDebug() {
      if (!debugVisible) return;
      await refreshDebug();
    }

    async function refreshDebug(allowAuthRetry = true) {
      if (!debugApiEnabled) {
        storageLine.textContent = t("web.error.debug_api_disabled_short");
        return;
      }
      try {
        const response = await fetch("/api/debug/database?sessionId=" + encodeURIComponent(activeSessionId), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          disableDebugApi();
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await refreshDebug(false);
              return;
            }
          }
          storageLine.textContent = t("web.error.debug_auth_failed");
          return;
        }
        if (!response.ok) throw new Error(t("web.error.debug_fetch_failed"));
        const snapshot = await response.json();
        latestDebug = snapshot;
        renderDebug(snapshot);
      } catch {
        storageLine.textContent = t("web.error.debug_fetch_failed");
      }
    }

    function renderDebug(snapshot) {
      const storage = snapshot.storage ?? {};
      const counts = snapshot.counts ?? {};
      const retention = snapshot.retention ?? {};
      const context = snapshot.lastContext ?? null;

      storageLine.textContent = formatStorage(storage);
      const sharedBlocks = Number(snapshot?.shared?.counts?.blocks ?? -1);
      const sharedRelations = Number(snapshot?.shared?.counts?.relations ?? -1);
      if (sharedBlocks >= 0) {
        const sharedText =
          sharedRelations >= 0
            ? "shared blocks=" + String(sharedBlocks) + ", shared relations=" + String(sharedRelations)
            : "shared blocks=" + String(sharedBlocks);
        storageLine.textContent += " | " + sharedText;
      }
      metricBlocks.textContent = String(counts.blocks ?? 0);
      metricRawBuckets.textContent = String(counts.rawBuckets ?? 0);
      metricRawEvents.textContent = String(counts.rawEvents ?? 0);
      metricRelations.textContent = String(counts.relations ?? 0);

      const totalBlocks = Math.max(1, Number(counts.blocks ?? 0));
      const rawCount = Number(retention.raw ?? 0);
      const compressedCount = Number(retention.compressed ?? 0);
      const conflictCount = Number(retention.conflict ?? 0);
      barRaw.style.width = ((rawCount / totalBlocks) * 100).toFixed(2) + "%";
      barCompressed.style.width = ((compressedCount / totalBlocks) * 100).toFixed(2) + "%";
      barConflict.style.width = ((conflictCount / totalBlocks) * 100).toFixed(2) + "%";
      retentionText.textContent =
        t("web.retention.text", { raw: rawCount, compressed: compressedCount, conflict: conflictCount });

      const contextBlocks = Array.isArray(context?.blocks) ? context.blocks : [];
      const blocks = Array.isArray(snapshot.blocks) ? snapshot.blocks : [];
      const relations = Array.isArray(snapshot.relations) ? snapshot.relations : [];

      contextMeta.textContent = context
        ? t("web.context.meta", { query: context.query ?? t("web.common.dash"), count: contextBlocks.length })
        : t("web.context.meta_empty");
      blocksMeta.textContent = String(blocks.length);
      relationsMeta.textContent = String(relations.length);

      renderContextRows(contextBlocks);
      renderBlockRows(blocks);
      renderRelationRows(relations);
    }

    function renderContextRows(items) {
      contextRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        contextRows.appendChild(buildEmptyRow(6, t("web.error.no_context_blocks")));
        return;
      }
      for (const item of items) {
        const row = document.createElement("tr");
        row.dataset.clickable = "1";
        row.dataset.id = String(item.id ?? "");
        row.appendChild(buildCell(String(item.order ?? "-")));
        row.appendChild(buildCell(shortId(item.id)));
        row.appendChild(buildCell(fmtNum(item.score, 3)));
        row.appendChild(buildCell(String(item.source ?? "-")));
        row.appendChild(buildCell(fmtTimeRange(item.startTime, item.endTime)));
        row.appendChild(buildCell(String(item.rawEventCount ?? 0)));
        contextRows.appendChild(row);
      }
    }

    function renderBlockRows(items) {
      blockRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        blockRows.appendChild(buildEmptyRow(7, t("web.error.no_database_blocks")));
        return;
      }
      for (const item of items) {
        const row = document.createElement("tr");
        row.dataset.clickable = "1";
        row.dataset.id = String(item.id ?? "");
        row.appendChild(buildCell(String(item.order ?? "-")));
        row.appendChild(buildCell(shortId(item.id)));
        row.appendChild(buildCell(fmtTimeRange(item.startTime, item.endTime)));
        row.appendChild(buildCell(String(item.tokenCount ?? 0)));
        row.appendChild(buildCell(String(item.retentionMode ?? "-")));
        row.appendChild(buildCell(String(item.persistedRawEvents ?? 0)));
        const inCtxCell = buildCell(item.inContext ? t("web.table.in_context_yes") : t("web.common.dash"));
        if (item.inContext) inCtxCell.className = "context-yes";
        row.appendChild(inCtxCell);
        blockRows.appendChild(row);
      }
    }

    function renderRelationRows(items) {
      relationRows.innerHTML = "";
      if (!Array.isArray(items) || items.length === 0) {
        relationRows.appendChild(buildEmptyRow(5, t("web.error.no_relations")));
        return;
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const row = document.createElement("tr");
        row.dataset.clickable = "1";
        row.dataset.index = String(index);
        row.appendChild(buildCell(String(item.order ?? index + 1)));
        row.appendChild(buildCell(String(item.type ?? "-")));
        row.appendChild(buildCell(shortId(item.src)));
        row.appendChild(buildCell(shortId(item.dst)));
        row.appendChild(buildCell(fmtTime(item.timestamp)));
        relationRows.appendChild(row);
      }
    }

    async function onBlockRowClick(event) {
      const row = event.target.closest("tr[data-id]");
      if (!row) return;
      const blockId = row.dataset.id;
      if (!blockId) return;
      await loadBlockDetail(blockId, true);
    }

    async function loadBlockDetail(blockId, allowAuthRetry) {
      try {
        const response = await fetch("/api/debug/block?id=" + encodeURIComponent(blockId) + "&sessionId=" + encodeURIComponent(activeSessionId), {
          headers: buildAdminHeaders()
        });
        if (response.status === 404) {
          openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.debug_api_disabled_short") });
          return;
        }
        if (response.status === 401) {
          if (allowAuthRetry) {
            const entered = promptAdminToken();
            if (entered) {
              await loadBlockDetail(blockId, false);
              return;
            }
          } else {
            openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.unauthorized") });
            return;
          }
          openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.unauthorized") });
          return;
        }
        if (!response.ok) throw new Error(t("web.error.load_failed"));
        const detail = await response.json();
        openModal(t("web.modal.block_detail_with_id", { id: shortId(blockId) }), detail);
      } catch {
        openModal(t("web.modal.block_detail"), { id: blockId, error: t("web.error.load_failed") });
      }
    }

    function onContextRowClick(event) {
      const row = event.target.closest("tr[data-id]");
      if (!row || !latestDebug || !latestDebug.lastContext) return;
      const blockId = row.dataset.id;
      const item = (latestDebug.lastContext.blocks ?? []).find((candidate) => candidate.id === blockId);
      if (!item) return;
      openModal(t("web.modal.context_block_with_id", { id: shortId(blockId) }), item);
    }

    function onRelationRowClick(event) {
      const row = event.target.closest("tr[data-index]");
      if (!row || !latestDebug) return;
      const index = Number.parseInt(row.dataset.index ?? "-1", 10);
      if (!Number.isFinite(index) || index < 0) return;
      const item = (latestDebug.relations ?? [])[index];
      if (!item) return;
      openModal(t("web.modal.relation_detail"), item);
    }

    function openModal(title, payload) {
      modalTitle.textContent = title;
      modalContent.textContent = JSON.stringify(payload, null, 2);
      detailModal.hidden = false;
    }

    function closeModal() {
      detailModal.hidden = true;
    }

    function buildCell(text) {
      const cell = document.createElement("td");
      cell.textContent = text;
      return cell;
    }

    function buildEmptyRow(colspan, text) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = colspan;
      cell.className = "empty";
      cell.textContent = text;
      row.appendChild(cell);
      return row;
    }

    function shortId(value) {
      const text = String(value ?? "");
      if (text.length <= 12) return text;
      return t("web.id.ellipsis", { head: text.slice(0, 8), tail: text.slice(-4) });
    }

    function fmtNum(value, digits) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number)) return t("web.number.zero");
      return number.toFixed(digits);
    }

    function fmtTime(value) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number <= 0) return t("web.common.dash");
      try {
        return new Date(number).toLocaleString();
      } catch {
        return String(number);
      }
    }

    function fmtTimeRange(start, end) {
      const left = fmtTime(start);
      const right = fmtTime(end);
      if (left === t("web.common.dash") && right === t("web.common.dash")) return t("web.common.dash");
      if (left === right) return left;
      return t("web.list.arrow", { left, right });
    }

    function formatStorage(storage) {
      const parts = [];
      parts.push(t("web.storage.backend", { value: String(storage.storageBackend ?? t("web.common.dash")) }));
      parts.push(t("web.storage.raw", { value: String(storage.rawStoreBackend ?? t("web.common.dash")) }));
      parts.push(
        t("web.storage.relation", { value: String(storage.relationStoreBackend ?? t("web.common.dash")) })
      );
      if (storage.sqliteFilePath) parts.push(t("web.storage.sqlite", { value: storage.sqliteFilePath }));
      if (storage.sqliteFileSizeBytes != null) {
        parts.push(t("web.storage.sqlite_size", { value: formatBytes(storage.sqliteFileSizeBytes) }));
      }
      if (storage.lanceDbPath) parts.push(t("web.storage.lance_db", { value: storage.lanceDbPath }));
      if (storage.lanceDbSizeBytes != null) {
        parts.push(t("web.storage.lance_db_size", { value: formatBytes(storage.lanceDbSizeBytes) }));
      }
      if (storage.lanceFilePath) parts.push(t("web.storage.lance", { value: storage.lanceFilePath }));
      if (storage.rawStoreFilePath) parts.push(t("web.storage.raw_file", { value: storage.rawStoreFilePath }));
      if (storage.relationStoreFilePath) {
        parts.push(t("web.storage.relation_file", { value: storage.relationStoreFilePath }));
      }
      return parts.join(" | ");
    }

    function formatBytes(value) {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number) || number < 0) return t("web.common.dash");
      if (number < 1024) return t("web.byte.b", { value: number });
      if (number < 1024 * 1024) return t("web.byte.kb", { value: (number / 1024).toFixed(1) });
      return t("web.byte.mb", { value: (number / (1024 * 1024)).toFixed(2) });
    }

    function renderRawContext(rawContext) {
      if (!rawContextView) return;
      rawContextView.textContent = JSON.stringify(rawContext ?? { empty: true }, null, 2);
    }

    function renderActiveFileStatus(filePath) {
      if (!activeFileStatus) return;
      if (typeof filePath === "string" && filePath.trim().length > 0) {
        activeFileStatus.textContent = t("web.hint.active_file", { path: filePath });
        activeFileStatus.title = filePath;
        return;
      }
      activeFileStatus.textContent = t("web.hint.active_file_empty");
      activeFileStatus.removeAttribute("title");
    }

    async function initializeCapabilities() {
      try {
        const response = await fetch("/api/capabilities");
        if (!response.ok) throw new Error(t("web.error.load_failed"));
        const payload = await response.json();
        debugApiEnabled = Boolean(payload.debugApiEnabled);
        debugAdminTokenRequired = Boolean(payload.adminTokenRequired);
      } catch {
        debugApiEnabled = false;
        debugAdminTokenRequired = false;
      } finally {
        debugCapabilitiesLoaded = true;
        renderDebugButtonState();
      }
    }

    function renderDebugButtonState() {
      if (!debugCapabilitiesLoaded) {
        debugBtn.textContent = t("web.button.debug_loading");
        debugBtn.disabled = true;
        return;
      }
      if (!debugApiEnabled) {
        debugBtn.textContent = t("web.button.debug_off");
        debugBtn.disabled = true;
        return;
      }
      debugBtn.disabled = false;
      debugBtn.textContent = debugVisible ? t("web.button.debug_on") : t("web.button.debug");
    }

    function disableDebugApi() {
      debugApiEnabled = false;
      debugVisible = false;
      debugPanel.hidden = true;
      renderDebugButtonState();
      storageLine.textContent = t("web.error.debug_api_disabled_404");
    }

    function buildAdminHeaders() {
      if (!debugAdminToken) return {};
      return {
        "x-mlex-admin-token": debugAdminToken
      };
    }

    function loadPersistedAdminToken() {
      try {
        const token = window.localStorage.getItem("mlex.debugAdminToken") ?? "";
        const normalized = token.trim();
        return normalized.length > 0 ? normalized : "";
      } catch {
        return "";
      }
    }

    function promptAdminToken() {
      const current = debugAdminToken || "";
      const entered = window.prompt(t("web.prompt.debug_token"), current);
      if (typeof entered !== "string") return "";
      const normalized = entered.trim();
      if (normalized.length === 0) return "";
      debugAdminToken = normalized;
      try {
        window.localStorage.setItem("mlex.debugAdminToken", normalized);
      } catch {}
      return normalized;
    }

    function loadPersistedSessionId() {
      try {
        const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY) ?? "";
        const normalized = existing.trim();
        if (normalized.length > 0) {
          return normalized;
        }
        const created = createRequestId();
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
        // Cleanup legacy cross-tab scope session id.
        try {
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {}
        return created;
      } catch {
        return createRequestId();
      }
    }

    function loadPersistedTranscript(sessionId) {
      try {
        const raw = window.sessionStorage.getItem(TRANSCRIPT_STORAGE_PREFIX + sessionId);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const normalized = [];
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const role = normalizeTranscriptRole(item.role);
          const text = clipTranscriptText(typeof item.text === "string" ? item.text : "");
          if (!text) continue;
          normalized.push({ role, text });
        }
        if (normalized.length > TRANSCRIPT_MAX_ITEMS) {
          return normalized.slice(-TRANSCRIPT_MAX_ITEMS);
        }
        return normalized;
      } catch {
        return [];
      }
    }

    function persistTranscript() {
      try {
        const key = TRANSCRIPT_STORAGE_PREFIX + activeSessionId;
        const compact = transcriptItems
          .slice(-TRANSCRIPT_MAX_ITEMS)
          .map((item) => ({
            role: normalizeTranscriptRole(item.role),
            text: clipTranscriptText(item.text)
          }))
          .filter((item) => item.text.length > 0);
        window.sessionStorage.setItem(key, JSON.stringify(compact));
      } catch {}
    }

    function normalizeTranscriptRole(role) {
      return role === "user" ? "user" : "assistant";
    }

    function clipTranscriptText(text) {
      const normalized = String(text ?? "");
      if (normalized.length <= TRANSCRIPT_MAX_ITEM_CHARS) {
        return normalized;
      }
      return normalized.slice(0, TRANSCRIPT_MAX_ITEM_CHARS);
    }

    function createRequestId() {
      const globalCrypto = window.crypto;
      if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
        return globalCrypto.randomUUID();
      }
      return "req-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  </script>`;
}
