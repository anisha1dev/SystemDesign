import { useState, useEffect, useRef } from "react";
import "./App.css";
import confetti from "canvas-confetti";
import { useParams, useNavigate } from "react-router-dom";

function Chat() {
  const { learningPathId } = useParams();
  const navigate = useNavigate();
  const backendURL = import.meta.env.VITE_BACKEND_URL;

  const inputRef = useRef(null);
  const ttsUtteranceRef = useRef(null);

  const [learningPath, setLearningPath] = useState(null);
  const [context, setContext] = useState({ conversation: [] });
  const [aiMessage, setAiMessage] = useState("");
  const [hint, setHint] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [logo, setLogo] = useState(null);

  const MAX_MESSAGES = 20;
  const TOTAL_QUESTIONS = 20;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (loading) return; // optionally ignore typing while loading

      if (e.key === "Enter") {
        handleSend(); // send message
      } else if (e.key === "Backspace") {
        setInput((prev) => prev.slice(0, -1));
      } else if (e.key.length === 1) {
        // only printable characters
        setInput((prev) => prev + e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [input, loading, context]);

  // ---------- TTS ----------
  function playTTS(text) {
    // Stop any previous speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices();
    const usFemaleVoice = voices.find(
      (v) => v.lang === "en-US" && v.name.toLowerCase().includes("female")
    );
    utterance.voice =
      usFemaleVoice || voices.find((v) => v.lang === "en-US") || voices[0];

    ttsUtteranceRef.current = utterance;
    speechSynthesis.speak(utterance);
  }

  // ---------- Stop TTS when leaving page ----------
  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
    };
  }, []);

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
                  placeholder="Type your response"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSend();
                  }}
                />

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
