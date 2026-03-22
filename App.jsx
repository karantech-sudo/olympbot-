import { useState, useRef, useEffect, useCallback } from "react";

const SYSTEM_PROMPT = `You are an expert Olymp Trade Fixed Time trading signal bot analyzing LIVE screen captures.

Analyze the Olymp Trade chart and respond ONLY in this exact format — nothing else:

🎯 SIGNAL: [UP / DOWN / WAIT]
💪 CONFIDENCE: [number]%
📊 REASON: [1-2 lines in Hinglish — candle pattern + trend reason]
⚡ ACTION: [exact step — kya press karo, amount, duration suggestion]
⚠️ RISK: [1 line warning]

Strict rules:
- 5 lines ONLY
- Hinglish (Hindi+English mix)
- If Olymp Trade chart not visible → "Chart nahi dikh raha — Olymp Trade tab share karo"
- Choppy/sideways market → WAIT
- Be direct and instant like a professional trading desk`;

export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("ot_apikey") || "");
  const [apiSaved, setApiSaved] = useState(() => !!localStorage.getItem("ot_apikey"));
  const [status, setStatus] = useState("idle");
  const [signals, setSignals] = useState([]);
  const [currentSignal, setCurrentSignal] = useState(null);
  const [interval, setIntervalVal] = useState(10);
  const [autoMode, setAutoMode] = useState(true);
  const [stats, setStats] = useState({ up: 0, down: 0, wait: 0, total: 0 });
  const [countdown, setCountdown] = useState(0);
  const [lastCapture, setLastCapture] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const countRef = useRef(null);
  const analyzingRef = useRef(false);
  const historyRef = useRef([]);
  const intervalRef = useRef(interval);
  intervalRef.current = interval;

  const saveApiKey = () => {
    if (!apiKeyInput.trim()) return;
    localStorage.setItem("ot_apikey", apiKeyInput.trim());
    setApiKey(apiKeyInput.trim());
    setApiSaved(true);
    setApiKeyInput("");
  };

  const stopSharing = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    clearInterval(timerRef.current);
    clearInterval(countRef.current);
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("idle");
    setCountdown(0);
    analyzingRef.current = false;
  }, []);

  const captureAndAnalyze = useCallback(async () => {
    if (analyzingRef.current) return;
    if (!videoRef.current || !canvasRef.current || !apiKey) return;
    analyzingRef.current = true;
    setStatus("analyzing");

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    const b64 = dataUrl.split(",")[1];
    setLastCapture(dataUrl);

    try {
      historyRef.current.push({
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: "Ye live Olymp Trade screen hai. Chart analyze karo aur trading signal do." }
        ]
      });
      if (historyRef.current.length > 8) historyRef.current = historyRef.current.slice(-8);

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: historyRef.current.slice(-6)
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.content?.[0]?.text || "Analysis failed.";
      historyRef.current.push({ role: "assistant", content: text });

      const sigMatch = text.match(/SIGNAL:\s*(UP|DOWN|WAIT)/i);
      const confMatch = text.match(/CONFIDENCE:\s*(\d+)/i);
      const sig = sigMatch?.[1]?.toUpperCase() || "WAIT";
      const conf = confMatch?.[1] || "?";

      const entry = { sig, conf, text, time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), id: Date.now() };
      setCurrentSignal(entry);
      setSignals(prev => [entry, ...prev].slice(0, 30));
      setStats(prev => ({
        up: prev.up + (sig === "UP" ? 1 : 0),
        down: prev.down + (sig === "DOWN" ? 1 : 0),
        wait: prev.wait + (sig === "WAIT" ? 1 : 0),
        total: prev.total + 1
      }));
    } catch (e) {
      const errText = e.message?.includes("API") || e.message?.includes("auth") ? "❌ API Key galat hai. Settings mein check karo." : "⚠️ Network error. Retry ho raha hai...";
      setCurrentSignal({ sig: "ERROR", conf: "0", text: errText, time: new Date().toLocaleTimeString(), id: Date.now() });
    }

    analyzingRef.current = false;
    setStatus("sharing");
  }, [apiKey]);

  const startSharing = async () => {
    if (!apiKey) { alert("Pehle API key save karo!"); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      stream.getVideoTracks()[0].addEventListener("ended", stopSharing);
      setStatus("sharing");
      setSignals([]);
      setCurrentSignal(null);
      historyRef.current = [];
      setTimeout(() => captureAndAnalyze(), 1500);
    } catch (e) {
      if (e.name !== "NotAllowedError") setStatus("error");
    }
  };

  useEffect(() => {
    if (status === "sharing" && autoMode) {
      clearInterval(timerRef.current);
      clearInterval(countRef.current);
      timerRef.current = setInterval(() => captureAndAnalyze(), interval * 1000);
      setCountdown(interval);
      countRef.current = setInterval(() => setCountdown(p => p <= 1 ? interval : p - 1), 1000);
    }
    return () => { clearInterval(timerRef.current); clearInterval(countRef.current); };
  }, [interval, autoMode, status, captureAndAnalyze]);

  useEffect(() => () => stopSharing(), []);

  const ss = (s) => ({
    UP:    { bg: "#071a0e", border: "#145c28", text: "#4ade80", label: "⬆ UP" },
    DOWN:  { bg: "#1a0707", border: "#5c1414", text: "#f87171", label: "⬇ DOWN" },
    WAIT:  { bg: "#1a1200", border: "#5c4400", text: "#fbbf24", label: "⏸ WAIT" },
    ERROR: { bg: "#111", border: "#333", text: "#888", label: "⚠ ERROR" }
  }[s] || { bg: "#111", border: "#333", text: "#888", label: s });

  return (
    <div style={{ fontFamily: "'Segoe UI',sans-serif", background: "#060810", color: "#c9d1d9", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#1e2a3a;border-radius:4px}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .btn{border:none;font-family:'Segoe UI',sans-serif;font-weight:700;cursor:pointer;border-radius:8px;transition:all 0.18s;letter-spacing:1px}
        .btn:hover{filter:brightness(1.12)}
        .btn:active{transform:scale(0.97)}
        .btn:disabled{opacity:0.4;cursor:not-allowed;filter:none}
        .card{background:#0d1520;border:1px solid #1a2030;border-radius:10px}
        input[type=range]{-webkit-appearance:none;width:100%;height:4px;border-radius:2px;background:#1e2a3a;outline:none}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#1D9E75;cursor:pointer}
        input[type=text],input[type=password]{background:#0d1520;border:1px solid #1e2a3a;border-radius:7px;color:#c9d1d9;padding:10px 14px;font-size:14px;font-family:'Segoe UI',sans-serif;outline:none;transition:border 0.2s}
        input[type=text]:focus,input[type=password]:focus{border-color:#1D9E75}
        .sig-item{animation:fadeUp 0.3s ease}
      `}</style>

      <canvas ref={canvasRef} style={{ display: "none" }} />
      <video ref={videoRef} muted playsInline style={{ display: "none" }} />

      {/* TOP BAR */}
      <div style={{ background: "#08090f", borderBottom: "1px solid #1a2030", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 9, height: 9, borderRadius: "50%", background: status === "sharing" ? "#1D9E75" : status === "analyzing" ? "#fbbf24" : "#3d4a5c", animation: status !== "idle" ? "pulse 1.5s infinite" : "none" }} />
          <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: 2, color: "#fff" }}>OLYMP<span style={{ color: "#1D9E75" }}>BOT</span></span>
          <span style={{ fontSize: 10, color: "#2d3a4a", letterSpacing: 1, marginLeft: 4 }}>
            {status === "idle" ? "READY" : status === "sharing" ? "● LIVE" : status === "analyzing" ? "◌ ANALYZING..." : "ERROR"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          {[["UP", stats.up, "#4ade80"], ["DOWN", stats.down, "#f87171"], ["WAIT", stats.wait, "#fbbf24"], ["Total", stats.total, "#c9d1d9"]].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#2d3a4a", letterSpacing: 1 }}>{l.toUpperCase()}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div>
            </div>
          ))}
          {apiSaved && (
            <button className="btn" onClick={() => { localStorage.removeItem("ot_apikey"); setApiKey(""); setApiSaved(false); }} style={{ background: "#1a1a2a", border: "1px solid #2d3a4a", color: "#6b7785", padding: "5px 12px", fontSize: 11 }}>
              API Key ✎
            </button>
          )}
        </div>
      </div>

      {/* API KEY SETUP */}
      {!apiSaved && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div className="card" style={{ padding: 28, maxWidth: 440, width: "100%" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 6 }}>API Key Setup</div>
            <div style={{ fontSize: 13, color: "#4a5568", marginBottom: 20, lineHeight: 1.7 }}>
              OlympBot ko Anthropic API key chahiye chart analyze karne ke liye.<br />
              <span style={{ color: "#1D9E75" }}>Free mein milti hai → console.anthropic.com</span>
            </div>
            <div style={{ fontSize: 11, color: "#3d4a5c", letterSpacing: 1, marginBottom: 8 }}>ANTHROPIC API KEY</div>
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveApiKey()}
              placeholder="sk-ant-api03-..."
              style={{ width: "100%", marginBottom: 12 }}
            />
            <button className="btn" onClick={saveApiKey} disabled={!apiKeyInput.trim()} style={{ background: "#0F6E56", color: "#fff", padding: "12px 0", width: "100%", fontSize: 15 }}>
              Save & Start ✓
            </button>
            <div style={{ marginTop: 14, fontSize: 12, color: "#2d3a4a", lineHeight: 1.8 }}>
              1. <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: "#1D9E75" }}>console.anthropic.com</a> pe jao<br />
              2. Account banao (free hai)<br />
              3. API Keys → Create Key<br />
              4. Key copy karke yahan paste karo
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTENT */}
      {apiSaved && (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: status === "idle" ? "1fr" : "1fr 300px", minHeight: 0 }}>

          {/* LEFT */}
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            {status === "idle" ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 20 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 60, marginBottom: 10 }}>🖥️</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#fff", letterSpacing: 1, marginBottom: 8 }}>Live Screen Trading Bot</div>
                  <div style={{ fontSize: 14, color: "#4a5568", lineHeight: 1.8, maxWidth: 380 }}>
                    Screen share karo → Bot <strong style={{ color: "#c9d1d9" }}>har {interval} seconds</strong> mein<br />
                    Olymp Trade chart dekh ke automatic signal dega
                  </div>
                </div>

                <div className="card" style={{ padding: "16px 20px", width: "100%", maxWidth: 400 }}>
                  <div style={{ fontSize: 11, color: "#3d4a5c", letterSpacing: 1.5, marginBottom: 12 }}>SETTINGS</div>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: "#6b7785" }}>Analysis interval</span>
                      <span style={{ fontWeight: 700, color: "#1D9E75", fontFamily: "monospace" }}>{interval}s</span>
                    </div>
                    <input type="range" min={5} max={30} step={1} value={interval} onChange={e => setIntervalVal(Number(e.target.value))} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#3d4a5c", marginTop: 3 }}><span>5s fast</span><span>30s slow</span></div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <div onClick={() => setAutoMode(p => !p)} style={{ width: 38, height: 21, borderRadius: 11, background: autoMode ? "#0F6E56" : "#1e2a3a", position: "relative", transition: "background 0.2s", cursor: "pointer", flexShrink: 0 }}>
                      <div style={{ width: 15, height: 15, borderRadius: "50%", background: autoMode ? "#4ade80" : "#4a5568", position: "absolute", top: 3, left: autoMode ? 20 : 3, transition: "left 0.2s" }} />
                    </div>
                    <span style={{ fontSize: 13, color: "#8892a4" }}>Auto mode — har {interval}s mein analyze</span>
                  </label>
                </div>

                <button className="btn" onClick={startSharing} style={{ background: "#0F6E56", color: "#fff", padding: "15px 44px", fontSize: 16, letterSpacing: 2 }}>
                  🖥️ &nbsp; SCREEN SHARE SHURU KARO
                </button>

                <div style={{ fontSize: 12, color: "#2d3a4a", textAlign: "center", lineHeight: 1.9 }}>
                  <strong style={{ color: "#4a5568" }}>Step 1:</strong> Button dabao<br />
                  <strong style={{ color: "#4a5568" }}>Step 2:</strong> Chrome popup → Olymp Trade wali tab select karo → Share<br />
                  <strong style={{ color: "#1D9E75" }}>Step 3:</strong> Bot apne aap signal deta rahega!
                </div>
              </div>
            ) : (
              <>
                <div className="card" style={{ padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#3d4a5c", letterSpacing: 1.5 }}>LIVE PREVIEW</span>
                      {autoMode && status === "sharing" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <div style={{ width: 20, height: 20, borderRadius: "50%", background: `conic-gradient(#1D9E75 ${(1 - countdown / interval) * 360}deg, #1e2a3a 0deg)`, position: "relative" }}>
                            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#0d1520", position: "absolute", top: 4, left: 4 }} />
                          </div>
                          <span style={{ fontSize: 11, color: "#1D9E75", fontFamily: "monospace" }}>{countdown}s</span>
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn" onClick={captureAndAnalyze} disabled={status === "analyzing"} style={{ background: "#1e2a3a", border: "1px solid #2d3a4a", color: "#c9d1d9", padding: "6px 14px", fontSize: 12 }}>
                        {status === "analyzing" ? "⏳ Analyzing..." : "📸 Capture Now"}
                      </button>
                      <button className="btn" onClick={stopSharing} style={{ background: "#1a0808", border: "1px solid #5c1414", color: "#f87171", padding: "6px 14px", fontSize: 12 }}>
                        ■ Stop
                      </button>
                    </div>
                  </div>
                  {lastCapture
                    ? <img src={lastCapture} alt="screen" style={{ width: "100%", borderRadius: 6, border: "1px solid #1a2030", display: "block" }} />
                    : <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "#3d4a5c", fontSize: 13, gap: 8 }}>
                        <div style={{ width: 16, height: 16, border: "2px solid #1D9E75", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                        Pehla capture aa raha hai...
                      </div>
                  }
                </div>

                <div className="card" style={{ padding: "12px 14px" }}>
                  <div style={{ fontSize: 11, color: "#3d4a5c", letterSpacing: 1.5, marginBottom: 8 }}>SIGNAL HISTORY</div>
                  {signals.length === 0
                    ? <div style={{ textAlign: "center", color: "#3d4a5c", fontSize: 13, padding: 12 }}>Signals aane wale hain...</div>
                    : signals.slice(0, 10).map((s, i) => (
                        <div key={s.id} className="sig-item" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", background: i === 0 ? ss(s.sig).bg : "transparent", border: `1px solid ${i === 0 ? ss(s.sig).border : "#1a2030"}`, borderRadius: 6, marginBottom: 5 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: ss(s.sig).text, minWidth: 65, fontFamily: "monospace" }}>{ss(s.sig).label}</span>
                          <span style={{ fontSize: 12, color: "#4a5568", flex: 1 }}>{s.conf}% confidence</span>
                          <span style={{ fontSize: 10, color: "#2d3a4a", fontFamily: "monospace" }}>{s.time}</span>
                        </div>
                    ))
                  }
                </div>
              </>
            )}
          </div>

          {/* RIGHT PANEL */}
          {status !== "idle" && (
            <div style={{ borderLeft: "1px solid #1a2030", padding: 14, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", background: "#08090f" }}>
              <div style={{ fontSize: 11, color: "#3d4a5c", letterSpacing: 1.5 }}>CURRENT SIGNAL</div>

              {!currentSignal
                ? <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
                    <div style={{ width: 28, height: 28, border: "3px solid #1D9E75", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                    <span style={{ fontSize: 12, color: "#3d4a5c" }}>Chart analyze ho raha hai...</span>
                  </div>
                : <div style={{ background: ss(currentSignal.sig).bg, border: `2px solid ${ss(currentSignal.sig).border}`, borderRadius: 12, padding: "16px 14px" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: ss(currentSignal.sig).text, marginBottom: 10, fontFamily: "monospace", letterSpacing: 1 }}>
                      {ss(currentSignal.sig).label}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
                      <div style={{ flex: 1, height: 5, background: "#1e2a3a", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ width: `${currentSignal.conf}%`, height: "100%", background: ss(currentSignal.sig).text, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: ss(currentSignal.sig).text, fontFamily: "monospace" }}>{currentSignal.conf}%</span>
                    </div>
                    {currentSignal.text.split("\n").filter(Boolean).map((line, i) => (
                      <div key={i} style={{ fontSize: i === 0 ? 13 : 12, color: i === 0 ? ss(currentSignal.sig).text : "#8892a4", marginBottom: 6, lineHeight: 1.6, fontFamily: "monospace" }}>{line}</div>
                    ))}
                    <div style={{ fontSize: 10, color: "#3d4a5c", marginTop: 8 }}>{currentSignal.time}</div>
                  </div>
              }

              <div className="card" style={{ padding: "12px 14px" }}>
                <div style={{ fontSize: 11, color: "#3d4a5c", marginBottom: 6 }}>INTERVAL: {interval}s</div>
                <input type="range" min={5} max={30} step={1} value={interval} onChange={e => setIntervalVal(Number(e.target.value))} />
              </div>

              <div style={{ background: "#071a0e", border: "1px solid #1a3a20", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#4ade8080", lineHeight: 1.8 }}>
                Signal aate hi <strong style={{ color: "#4ade80" }}>turant</strong> Olymp Trade mein UP/DOWN press karo — 10 sec ke andar entry lo.
              </div>

              <div style={{ fontSize: 11, color: "#2d3a4a", textAlign: "center", lineHeight: 1.7 }}>
                ⚠️ Demo account pe practice karo.<br />Real money = real risk.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
