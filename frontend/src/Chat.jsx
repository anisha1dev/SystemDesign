import { useState, useEffect, useRef } from "react";
import "./App.css";
import confetti from "canvas-confetti";
import { useParams, useNavigate } from "react-router-dom";

function Chat() {
  const { learningPathId } = useParams();
  const navigate = useNavigate();
  const backendURL = import.meta.env.VITE_BACKEND_URL;

  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  const [learningPath, setLearningPath] = useState(null);
  const [context, setContext] = useState({ conversation: [] });
  const [aiMessage, setAiMessage] = useState("");
  const [hint, setHint] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [logo, setLogo] = useState(null);
  const [recording, setRecording] = useState(false);

  const MAX_MESSAGES = 20;
  const TOTAL_QUESTIONS = 20;

  // ---------- TTS ----------
  function playTTS(text) {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const usFemaleVoice = voices.find(
      (v) => v.lang === "en-US" && v.name.toLowerCase().includes("female")
    );
    utterance.voice =
      usFemaleVoice || voices.find((v) => v.lang === "en-US") || voices[0];
    speechSynthesis.speak(utterance);
  }

  // ---------- STT (Browser Native) ----------
  const startRecording = () => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser.");
      return;
    }

    setRecording(true);
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      handleSend();
      setRecording(false);
    };

    recognition.onerror = (event) => {
      console.error("STT error:", event.error);
      setRecording(false);
    };

    recognition.start();
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setRecording(false);
  };

  // ---------- Fetch Learning Path ----------
  useEffect(() => {
    const fetchLearningPath = async () => {
      try {
        const res = await fetch(
          `${backendURL}/learning-paths/${learningPathId}`
        );
        const data = await res.json();
        setLearningPath(data);
        setAiMessage(`Welcome to ${data.title}!`);
        if (data.image) setLogo(data.image);

        // Load chat history
        const savedChat =
          JSON.parse(localStorage.getItem(`chat_${data._id}`)) || {};
        setContext(savedChat.context || { conversation: [] });
        setAiMessage(savedChat.aiMessage || `Welcome to ${data.title}!`);
        setHint(savedChat.hint || "");
        setCurrentIndex((savedChat.context?.conversation?.length || 1) - 1);
      } catch (err) {
        console.error(err);
      }
    };
    fetchLearningPath();
  }, [learningPathId, backendURL]);

  const handleNavigateHome = () => navigate("/");

  useEffect(() => {
    if (!learningPath) return;
    localStorage.setItem(
      `chat_${learningPath._id}`,
      JSON.stringify({ aiMessage, hint, context })
    );
  }, [aiMessage, hint, context, learningPath]);

  // ---------- Progress ----------
  const calculateProgress = (conversation) => {
    const userMessages = conversation.filter((msg) => msg.sender === "user");
    if (!userMessages.length) return 0;
    return Math.round((userMessages.length / TOTAL_QUESTIONS) * 100);
  };

  useEffect(() => {
    setProgressPercent(calculateProgress(context.conversation));
  }, [context]);

  // ---------- Keyboard Handling ----------
  const spaceHoldThreshold = 200;
  useEffect(() => {
    let spaceTimeout = null;

    const handleKeyDown = (e) => {
      if (progressPercent >= 100) return;

      if (e.code === "Space" && !recording && input.length === 0) {
        e.preventDefault();
        spaceTimeout = setTimeout(startRecording, spaceHoldThreshold);
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (!recording && input.trim() !== "") handleSend();
      }

      if (document.activeElement !== inputRef.current && e.key.length === 1) {
        setInput((prev) => prev + e.key);
      }
      if (
        document.activeElement !== inputRef.current &&
        e.key === "Backspace"
      ) {
        setInput((prev) => prev.slice(0, -1));
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === "Space") {
        clearTimeout(spaceTimeout);
        if (recording) stopRecording();
        else setInput((prev) => prev + " ");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      clearTimeout(spaceTimeout);
    };
  }, [recording, progressPercent, input]);

  // ---------- Send Message ----------
  const handleSend = async () => {
    if (!input.trim()) return;
    const userInput = input;
    setInput("");
    setLoading(true);

    try {
      const recentConversation = context.conversation.slice(-MAX_MESSAGES);
      const isFirstResponse =
        context.conversation.filter((msg) => msg.sender === "user").length ===
        0;

      const payload = {
        message: userInput,
        learning_path: learningPath.title,
        context: { ...context, conversation: recentConversation },
        is_first_response: isFirstResponse,
      };

      const res = await fetch(`${backendURL}/design_chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      const newConversation = [
        ...context.conversation,
        { sender: "user", text: userInput },
        { sender: "system", text: data.reply, hint: data.hint || "" },
      ];

      setContext({ conversation: newConversation });
      setAiMessage(data.reply);
      setHint(data.hint || "");
      setCurrentIndex(newConversation.length - 1);
    } catch (err) {
      console.error(err);
      setAiMessage("Error processing request.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // ---------- Navigation ----------
  const handleNext = () => {
    for (let i = currentIndex + 1; i < context.conversation.length; i++) {
      if (context.conversation[i].sender === "system") {
        const msg = context.conversation[i];
        setAiMessage(msg.text);
        setHint(msg.hint || "");
        setCurrentIndex(i);
        break;
      }
    }
  };

  const handlePrev = () => {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (context.conversation[i].sender === "system") {
        const msg = context.conversation[i];
        setAiMessage(msg.text);
        setHint(msg.hint || "");
        setCurrentIndex(i);
        break;
      }
    }
  };

  // ---------- Fireworks ----------
  useEffect(() => {
    if (progressPercent >= 100) {
      const duration = 5000;
      const animationEnd = Date.now() + duration;
      const defaults = {
        startVelocity: 30,
        spread: 360,
        ticks: 60,
        zIndex: 999,
      };

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return clearInterval(interval);
        const particleCount = 50 * (timeLeft / duration);
        confetti({
          ...defaults,
          particleCount,
          origin: { x: Math.random(), y: Math.random() - 0.2 },
        });
      }, 250);
    }
  }, [progressPercent]);

  // ---------- Auto TTS ----------
  useEffect(() => {
    if (aiMessage) playTTS(aiMessage);
  }, [aiMessage]);

  return (
    <>
      <div className="progress-container">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="chat-container">
        {progressPercent < 100 ||
        currentIndex < context.conversation.length - 1 ? (
          <>
            <div className="chat-panel">
              <div className="chat-box">
                {logo && (
                  <div className="chat-logo-container">
                    <img
                      src={logo}
                      alt="Logo"
                      className="chat-logo"
                      onClick={handleNavigateHome}
                      style={{ cursor: "pointer" }}
                      title="Go to home"
                    />
                  </div>
                )}
                <div className="message system">{aiMessage}</div>
                {loading && <div className="thinking">thinking...</div>}
                {!loading && (
                  <input
                    ref={inputRef}
                    type="text"
                    className="chat-input no-focus-border"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Hold spacebar to speak or type to respond"
                  />
                )}
                {!loading && input.length > 0 && (
                  <p className="placeholder-input">
                    {recording ? "🎤 Recording..." : "Press enter to send"}
                  </p>
                )}
              </div>
            </div>
            {hint && (
              <div className="code-panel">
                <div className="code-box">{hint}</div>
              </div>
            )}
          </>
        ) : (
          <h1 className="win-text">Congratulations! 🎉</h1>
        )}

        <div className="nav-buttons">
          {currentIndex > 0 ? (
            <button className="nav-button left" onClick={handlePrev}>
              ◀
            </button>
          ) : (
            <div className="nav-button-placeholder" />
          )}
          {progressPercent < 100 ||
          currentIndex < context.conversation.length - 1 ? (
            <button className="nav-button right" onClick={handleNext}>
              ▶
            </button>
          ) : (
            <div className="nav-button-placeholder" />
          )}
        </div>
      </div>
    </>
  );
}

export default Chat;