const voiceBar = document.getElementById("voice-bar");
const toggleButton = document.getElementById("voice-toggle");
const statusLabel = document.getElementById("voice-status");

if (voiceBar && toggleButton) {
    let conversation = null;
    let connecting = false;
    let Conversation = null;
    let clientPromise = null;
    let outputVolume = 1;

    const CLIENT_URLS = [
        "https://esm.sh/@elevenlabs/client@0.12.2?bundle",
        "https://cdn.skypack.dev/@elevenlabs/client@0.12.2"
    ];

    const COLLECTION_ALIASES = {
        elegance: ["elegance", "eleganza", "elegante", "elegant", "bonton", "bonton 200"],
        minimal: ["minimal", "minimale", "dolores", "dolores 274x"],
        luxury: ["luxury", "lusso", "lussuoso", "lussuosa", "eclipse"]
    };

    const COMMAND_TRIGGERS = [
        "collezione",
        "collection",
        "mostra",
        "show",
        "vedi",
        "vedere",
        "apri",
        "vai",
        "visita",
        "visit",
        "portami",
        "fammi"
    ];

    let lastCommandAt = 0;
    let lastCommandCollection = null;

    const normalizeText = (text) => {
        let normalized = String(text || "").toLowerCase();
        if (normalized.normalize) {
            normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        }
        return normalized
            .replace(/[^a-z0-9\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    };

    const detectCollection = (text) => {
        const normalized = normalizeText(text);
        if (!normalized) return null;

        const hasCommand = COMMAND_TRIGGERS.some((word) => normalized.includes(word));
        const wordCount = normalized.split(" ").length;

        for (const [collection, aliases] of Object.entries(COLLECTION_ALIASES)) {
            if (aliases.some((alias) => normalized.includes(alias))) {
                if (hasCommand || wordCount <= 3) {
                    return collection;
                }
            }
        }

        return null;
    };

    const dispatchCollection = (collection) => {
        if (!collection) return;
        const now = Date.now();
        if (collection === lastCommandCollection && now - lastCommandAt < 2500) return;
        lastCommandCollection = collection;
        lastCommandAt = now;
        window.dispatchEvent(new CustomEvent("aria:collectionSelect", {
            detail: { collection, source: "voice" }
        }));
    };

    const applyVolume = () => {
        if (conversation && typeof conversation.setVolume === "function") {
            conversation.setVolume({ volume: outputVolume });
        }
    };

    const setState = (state) => {
        voiceBar.dataset.state = state;
        if (statusLabel) {
            if (state === "offline") {
                statusLabel.textContent = "";
            } else if (state === "connecting") {
                statusLabel.textContent = "connecting";
            } else if (state === "error") {
                statusLabel.textContent = "error";
            } else {
                statusLabel.textContent = state;
            }
        }
        toggleButton.disabled = state === "connecting";
        toggleButton.setAttribute("aria-pressed", state === "listening" || state === "speaking" ? "true" : "false");
    };

    async function loadClient() {
        if (Conversation) return Conversation;
        if (!clientPromise) {
            clientPromise = (async () => {
                let lastError = null;
                for (const url of CLIENT_URLS) {
                    try {
                        const mod = await import(url);
                        if (mod && mod.Conversation) {
                            Conversation = mod.Conversation;
                            return Conversation;
                        }
                    } catch (error) {
                        lastError = error;
                    }
                }
                throw lastError || new Error("Unable to load ElevenLabs client");
            })()
                .catch((error) => {
                    clientPromise = null;
                    throw error;
                });
        }
        return clientPromise;
    }

    async function tryStart(transport) {
        connecting = true;
        setState("connecting");
        const Client = await loadClient();
        if (transport === "webrtc") {
            await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        }
        return Client.startSession({
            agentId: "agent_6201kdg19b9beae89z3ywcp3r9p8",
            connectionType: transport,
            onConnect: () => {
                connecting = false;
                setState("listening");
                applyVolume();
            },
            onDisconnect: () => {
                conversation = null;
                connecting = false;
                setState("offline");
            },
            onModeChange: (mode) => {
                const state = mode.mode === "speaking" ? "speaking" : "listening";
                setState(state);
            },
            onMessage: (message) => {
                if (!message || typeof message.message !== "string") return;
                if (message.source !== "user" && message.role !== "user") return;
                const collection = detectCollection(message.message);
                if (collection) dispatchCollection(collection);
            },
            onError: (err) => {
                console.error("ElevenLabs error:", err);
                setState("error");
            }
        });
    }

    async function startConversation() {
        if (conversation || connecting) return;
        try {
            try {
                conversation = await tryStart("webrtc");
            } catch (error) {
                console.warn("WebRTC failed, fallback websocket:", error);
                conversation = await tryStart("websocket");
            }
        } catch (error) {
            console.error("Unable to start conversation:", error);
            setState("error");
        }
    }

    async function stopConversation() {
        if (!conversation) return;
        try {
            await conversation.endSession();
        } catch {
            // ignore
        }
        conversation = null;
        connecting = false;
        setState("offline");
    }

    toggleButton.addEventListener("click", () => {
        if (conversation) {
            stopConversation();
        } else {
            startConversation();
        }
    });

    window.addEventListener("aria:voiceMute", () => {
        outputVolume = 0;
        applyVolume();
    });

    window.addEventListener("aria:voiceUnmute", () => {
        outputVolume = 1;
        applyVolume();
    });

    setState("offline");
}
