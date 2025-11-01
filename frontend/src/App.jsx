import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import "./App.css";
import BitlyLogo from "./assets/Bitly_Logo.png";
import confetti from "canvas-confetti";

function App() {
  const backendURL = import.meta.env.VITE_BACKEND_URL;
  const inputRef = useRef(null);
  const inputStateRef = useRef(""); // Ref to prevent duplicates

  const savedChat = JSON.parse(localStorage.getItem("chat")) || {};
  const lastSystemMsg =
    savedChat.context?.conversation?.slice().reverse().find(msg => msg.sender === "system")?.text || "";
  const lastCodeSnippet =
    savedChat.context?.conversation?.slice().reverse().find(msg => msg.sender === "system")?.code || "";
  const lastHint =
    savedChat.context?.conversation?.slice().reverse().find(msg => msg.sender === "system")?.hint || "";

  const [aiMessage, setAiMessage] = useState(lastSystemMsg || "Welcome to system design!");
  const [codeSnippet, setCodeSnippet] = useState(lastCodeSnippet);
  const [hint, setHint] = useState(lastHint);
  const [context, setContext] = useState(savedChat.context || { conversation: [] });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(context.conversation?.length - 1 || 0);

  const MAX_MESSAGES = 20;
  const TOTAL_QUESTIONS = 20;

  inputStateRef.current = input;

  // Initialize 20 system design questions if context empty
  useEffect(() => {
    if (!context.conversation || context.conversation.length === 0) {
      const questions = Array.from({ length: TOTAL_QUESTIONS }, (_, i) => ({
        sender: "system",
        text: `System Design Question ${i + 1}: Describe the architecture for ...`,
        code: "",
        hint: `Hint for question ${i + 1}`,
      }));
      setContext({ conversation: questions });
    }
  }, []);

  // Calculate dynamic performance progress
const calculatePerformanceProgress = (conversation) => {
  // Only include real system questions
  const systemMessages = conversation.filter(msg => msg.sender === "system" && !msg.simulated);
  if (systemMessages.length === 0) return 0;

  let totalScore = 0;
  systemMessages.forEach((msg, idx) => {
    const userMsg = conversation[idx + 1];
    if (userMsg && userMsg.sender === "user" && userMsg.score != null) {
      totalScore += userMsg.score;
    }
  });

  return Math.round((totalScore / systemMessages.length) * 100);
};

  useEffect(() => {
    localStorage.setItem("chat", JSON.stringify({ aiMessage, codeSnippet, hint, context }));
    if (context.conversation) {
      setProgressPercent(calculatePerformanceProgress(context.conversation));
    }
  }, [aiMessage, codeSnippet, hint, context]);

  // Global key listener for typing
  useEffect(() => {
    const handleGlobalTyping = (e) => {
      if (progressPercent >= 100) return;

      if (e.key.length === 1) {
        setInput(prev => prev + e.key);
        inputRef.current?.focus();
      } else if (e.key === "Backspace") {
        setInput(prev => prev.slice(0, -1));
        inputRef.current?.focus();
      } else if (e.key === "Enter") {
        handleSend();
      } 
    };

  window.addEventListener("keydown", handleGlobalTyping);
  return () => window.removeEventListener("keydown", handleGlobalTyping);
}, [progressPercent, input, currentIndex, context]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userInput = input;
    setInput("");
    setLoading(true);

    try {
      const recentConversation = context.conversation.slice(-MAX_MESSAGES);
      const payload = { message: userInput, context: { ...context, conversation: recentConversation } };
      const res = await axios.post(`${backendURL}/design_chat`, payload);

      // Only assign score if user input is meaningful
      const score = (userInput.toLowerCase() === "ok") ? 0 : (res.data.score ?? 1);

      const newConversation = [
        ...context.conversation,
        { sender: "user", text: userInput, score },
        { sender: "system", text: res.data.reply || "Next question...", code: res.data.code || "", hint: res.data.hint || "" },
      ];

      setContext({ conversation: newConversation });
      setAiMessage(res.data.reply || "Next question...");
      setCodeSnippet(res.data.code || "");
      setHint(res.data.hint || "");
      setCurrentIndex(newConversation.length - 1);
    } catch (err) {
      console.error(err);
      setAiMessage("Sorry, there was an error.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };



const handleNext = async () => {
  if (currentIndex + 1 >= context.conversation.length) {
    // Simulate next AI question
    const payload = { message: "ok", context };
    setLoading(true);
    try {
      const res = await axios.post(`${backendURL}/design_chat`, payload);

      const newConversation = [
        ...context.conversation,
        { 
          sender: "system", 
          text: res.data.reply || "Next question...", 
          code: res.data.code || "", 
          hint: res.data.hint || "", 
          simulated: true  // mark as simulated
        },
      ];


      setContext({ conversation: newConversation });
      setAiMessage(res.data.reply || "Next question...");
      setCodeSnippet(res.data.code || "");
      setHint(res.data.hint || "");
      setCurrentIndex(newConversation.length - 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  } else {
    const nextMsg = context.conversation[currentIndex + 1];
    if (nextMsg.sender === "system") {
      setAiMessage(nextMsg.text);
      setCodeSnippet(nextMsg.code || "");
      setHint(nextMsg.hint || "");
      setCurrentIndex(currentIndex + 1);
    }
  }
};

  const handlePrev = () => {
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (context.conversation[i].sender === "system") {
        setAiMessage(context.conversation[i].text);
        setCodeSnippet(context.conversation[i].code || "");
        setHint(context.conversation[i].hint || "");
        setCurrentIndex(i);
        break;
      }
    }
  };

  // Fireworks
  useEffect(() => {
    if (progressPercent >= 100) {
      const duration = 5 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 999 };

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return clearInterval(interval);
        const particleCount = 50 * (timeLeft / duration);
        confetti({ ...defaults, particleCount, origin: { x: Math.random(), y: Math.random() - 0.2 } });
      }, 250);
    }
  }, [progressPercent]);

  return (
    <>
      <div className="progress-container">
        <div className="progress-text">{progressPercent}% completed</div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="chat-container">
        {progressPercent < 100 ? (
          <>
            <div className="chat-panel">
              <div className="chat-box">
                <div className="logo-container">
                  <img src={BitlyLogo} alt="Logo" className="chat-logo" />
                </div>
                <div className="message system">
                  <div>{aiMessage}</div>
                  {hint && <div className="hint">💡 {hint}</div>}
                </div>
                {loading && <div className="thinking">Thinking...</div>}
                {!loading && (
                  <input
                    ref={inputRef}
                    type="text"
                    className="chat-input no-focus-border"
                    value={input}
                    readOnly
                    placeholder="Type your response..."
                  />
                )}
              </div>
            </div>

            <div className="code-panel">
              <div className="code-box">
                {codeSnippet ? <SyntaxHighlighter language="python">{codeSnippet}</SyntaxHighlighter> : <div className="no-code"></div>}
              </div>
            </div>
          </>
        ) : (
          <h1 className="win-text">Congratulations! 🎉</h1>
        )}

        <div className="nav-buttons">
          <button className="nav-button left" onClick={handlePrev} disabled={progressPercent <= 0}>◀</button>
          <button className="nav-button right" onClick={handleNext} disabled={progressPercent >= 100}>▶</button>
        </div>
      </div>
    </>
  );
}

export default App;
