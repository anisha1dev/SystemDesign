import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import "./App.css";
import confetti from "canvas-confetti";
import { useParams, useNavigate } from "react-router-dom";

function Chat() {
   const { learningPathId } = useParams();
   
console.log("learningPathId:", learningPathId);
  const navigate = useNavigate();
  const backendURL = import.meta.env.VITE_BACKEND_URL;

  const inputRef = useRef(null);
  const inputStateRef = useRef("");

  const [learningPath, setLearningPath] = useState(null);
  const [context, setContext] = useState({ conversation: [] });
  const [aiMessage, setAiMessage] = useState("");
  const [codeSnippet, setCodeSnippet] = useState("");
  const [hint, setHint] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lastScore, setLastScore] = useState(null);
  const [lastFeedback, setLastFeedback] = useState("");
  const [logo, setLogo] = useState(null);

  const MAX_MESSAGES = 20;
  const TOTAL_QUESTIONS = 40;

  inputStateRef.current = input;

 // Fetch learning path by ID
  useEffect(() => {
    const fetchLearningPath = async () => {
      try {
        const res = await axios.get(`${backendURL}/learning-paths/${learningPathId}`);
        setLearningPath(res.data);
        setAiMessage(`Welcome to ${res.data.title}!`);
        if (res.data.image) setLogo(res.data.image);

        // Load chat history from localStorage
        const savedChat = JSON.parse(localStorage.getItem(`chat_${res.data._id}`)) || {};
        setContext(savedChat.context || { conversation: [] });
        setAiMessage(savedChat.aiMessage || `Welcome to ${res.data.title}!`);
        setCodeSnippet(savedChat.codeSnippet || "");
        setHint(savedChat.hint || "");
        setCurrentIndex((savedChat.context?.conversation?.length || 1) - 1);
      } catch (err) {
        console.error("Failed to fetch learning path:", err);
      }
    };
    fetchLearningPath();
  }, [learningPathId]);

  const handleNavigateHome = () => navigate("/");
  
  useEffect(() => {
    if (!learningPath) return; // Wait until learningPath is loaded
    localStorage.setItem(
      `chat_${learningPath._id}`,
      JSON.stringify({ aiMessage, codeSnippet, hint, context })
    );
  }, [aiMessage, codeSnippet, hint, context, learningPath]);

  // Progress calculation: based on number of questions answered out of 20 total
  const calculateProgress = (conversation) => {
    const userMessages = conversation.filter(msg => 
      msg.sender === "user" && msg.score != null
    );
    
    if (!userMessages.length) return 0;
    
    // Progress is based on how many questions answered out of total
    const questionsAnswered = userMessages.length;
    
    return Math.round((questionsAnswered / TOTAL_QUESTIONS) * 100);
  };

  useEffect(() => {
    setProgressPercent(calculateProgress(context.conversation));
    console.log("Current state:", {
      currentIndex,
      conversationLength: context.conversation.length,
      progressPercent: calculateProgress(context.conversation),
      conversation: context.conversation
    });
  }, [context]);

  useEffect(() => {
    const handleTyping = (e) => {
      if (progressPercent >= 100) return;
      if (e.key.length === 1) setInput(prev => prev + e.key);
      else if (e.key === "Backspace") setInput(prev => prev.slice(0, -1));
      else if (e.key === "Enter") handleSend();
    };
    window.addEventListener("keydown", handleTyping);
    return () => window.removeEventListener("keydown", handleTyping);
  }, [progressPercent, input, context]);

  const handleSend = async () => {
    if (!input.trim()) return;
    const userInput = input;
    setInput("");
    setLoading(true);

    try {
      const recentConversation = context.conversation.slice(-MAX_MESSAGES);
      
      // Check if this is the first user response
      const isFirstResponse = context.conversation.filter(msg => msg.sender === "user").length === 0;
      
      const payload = {
        message: userInput,
        learning_path: learningPath.title,
        context: { ...context, conversation: recentConversation },
        is_first_response: isFirstResponse
      };
      const res = await axios.post(`${backendURL}/design_chat`, payload);

      let reply;
      try {
        reply = typeof res.data.reply === "string" ? JSON.parse(res.data.reply) : res.data.reply;
      } catch (e) {
        console.warn("Reply was not valid JSON:", res.data.reply);
        reply = { 
          reply: res.data.reply, 
          code: res.data.code, 
          hint: res.data.hint,
          score: res.data.score !== undefined ? res.data.score : 5,
          feedback: res.data.feedback || ""
        };
      }

      // Handle score properly - 0 is a valid score!
      let score;
      if (isFirstResponse) {
        score = null;
      } else {
        // Check reply.score first, then res.data.score
        if (reply.score !== undefined && reply.score !== null) {
          score = reply.score;
        } else if (res.data.score !== undefined && res.data.score !== null) {
          score = res.data.score;
        } else {
          score = 5; // Only use 5 as fallback if no score exists
        }
      }
      
      const feedback = isFirstResponse ? "" : (reply.feedback ?? res.data.feedback ?? "");

      console.log("Response:", reply);
      console.log("Score:", score);
      console.log("Is First Response:", isFirstResponse);

      // Update last score and feedback for display (only if not first response)
      if (!isFirstResponse) {
        setLastScore(score);
        setLastFeedback(feedback);
      }

      const newConversation = [
        ...context.conversation,
        { sender: "user", text: userInput, score },
        { 
          sender: "system", 
          text: reply.reply || res.data.reply || "Next question...", 
          code: reply.code || res.data.code || "", 
          hint: reply.hint || res.data.hint || "",
          feedback: feedback
        },
      ];

      setContext({ conversation: newConversation });
      setAiMessage(reply.reply || res.data.reply || "Next question...");
      setCodeSnippet(reply.code || res.data.code || "");
      setHint(reply.hint || res.data.hint || "");
      setCurrentIndex(newConversation.length - 1);
    } catch (err) {
      console.error(err);
      setAiMessage("Error processing request.");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleNext = () => {
    console.log("handleNext called, currentIndex:", currentIndex);
    console.log("conversation length:", context.conversation.length);
    
    for (let i = currentIndex + 1; i < context.conversation.length; i++) {
      console.log(`Checking index ${i}:`, context.conversation[i]);
      
      if (context.conversation[i].sender === "system") {
        const msg = context.conversation[i];
        console.log("Found system message at index", i, ":", msg);
        
        setAiMessage(msg.text);
        setCodeSnippet(msg.code || "");
        setHint(msg.hint || "");
        setCurrentIndex(i);
        
        // Get the previous user message's score
        if (i > 0 && context.conversation[i - 1].sender === "user") {
          const userMsg = context.conversation[i - 1];
          console.log("Previous user message:", userMsg);
          console.log("User score:", userMsg.score);
          
          const userScore = userMsg.score;
          setLastScore(userScore !== undefined && userScore !== null ? userScore : null);
          setLastFeedback(msg.feedback || "");
        } else {
          console.log("No user message before this system message");
          setLastScore(null);
          setLastFeedback("");
        }
        break;
      }
    }
  };

  const handlePrev = () => {
    console.log("handlePrev called, currentIndex:", currentIndex);
    
    for (let i = currentIndex - 1; i >= 0; i--) {
      console.log(`Checking index ${i}:`, context.conversation[i]);
      
      if (context.conversation[i].sender === "system") {
        const msg = context.conversation[i];
        console.log("Found system message at index", i, ":", msg);
        
        setAiMessage(msg.text);
        setCodeSnippet(msg.code || "");
        setHint(msg.hint || "");
        setCurrentIndex(i);
        
        // Get the previous user message's score
        if (i > 0 && context.conversation[i - 1].sender === "user") {
          const userMsg = context.conversation[i - 1];
          console.log("Previous user message:", userMsg);
          console.log("User score:", userMsg.score);
          
          const userScore = userMsg.score;
          setLastScore(userScore !== undefined && userScore !== null ? userScore : null);
          setLastFeedback(msg.feedback || "");
        } else {
          console.log("No user message before this system message");
          setLastScore(null);
          setLastFeedback("");
        }
        break;
      }
    }
  };

  // Get score color
  const getScoreColor = (score) => {
    if (score >= 8) return "#22c55e"; // green
    if (score >= 6) return "#eab308"; // yellow
    if (score >= 4) return "#f97316"; // orange
    return "#ef4444"; // red
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
        {progressPercent < 100 || currentIndex < context.conversation.length - 1 ? (
          <>
            <div className="chat-panel">
              <div className="chat-box">
                {logo && (
                  <img 
                    src={logo} 
                    alt="Logo" 
                    className="chat-logo" 
                    onClick={handleNavigateHome}
                    style={{ cursor: 'pointer' }}
                    title="Go to home"
                  />
                )}
                
                {/* Score Display - only show if there's a valid score */}
                {lastScore !== null && lastScore !== undefined && (
                  <div className="score-display" style={{
                    padding: "12px",
                    marginBottom: "16px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(195, 195, 195, 0.2)",
                    border: `2px solid ${getScoreColor(lastScore)}`
                  }}>
                    <div style={{ 
                      fontSize: "24px", 
                      fontWeight: "bold",
                      color: getScoreColor(lastScore)
                    }}>
                      Score: {lastScore}/10
                    </div>
                    {lastFeedback && (
                      <div style={{ 
                        marginTop: "8px",
                        fontSize: "14px",
                        color: "#888"
                      }}>
                        {lastFeedback}
                      </div>
                    )}
                  </div>
                )}

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
                {codeSnippet && <SyntaxHighlighter language="python">{codeSnippet}</SyntaxHighlighter>}
              </div>
            </div>
          </>
        ) : (
          <h1 className="win-text">Congratulations! 🎉</h1>
        )}

      <div className="nav-buttons">
  {currentIndex > 0 ? (
    <button className="nav-button left" onClick={handlePrev}>◀</button>
  ) : (
    <div className="nav-button-placeholder" />
  )}

  {(progressPercent < 100 || currentIndex < context.conversation.length - 1) ? (
    <button className="nav-button right" onClick={handleNext}>▶</button>
  ) : (
    <div className="nav-button-placeholder" />
  )}
</div>

      </div>
    </>
  );
}

export default Chat;