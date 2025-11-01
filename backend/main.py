# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from hf_client import query_llm  # Your LLM query function
import json
import textwrap
from asyncio import to_thread

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class UserMessage(BaseModel):
    message: str
    context: dict = {}

def format_code(code: str, width: int = 80) -> str:
    """Format code for readability"""
    lines = code.split("\n")
    formatted = []
    for line in lines:
        wrapped = textwrap.fill(line, width=width, subsequent_indent="    ")
        formatted.append(wrapped)
    return "\n".join(formatted)

@app.post("/design_chat")
async def design_chat(message: UserMessage):
    user_input = message.message.strip()

    # Determine if user is giving a generic confirmation
    generic_responses = ["ok", "yes", "sure", "got it", "alright"]
    last_question = message.context.get("last_question", "")

    if user_input.lower() in generic_responses:
        prompt = f"""
User replied with a generic confirmation: '{user_input}'.
Rephrase the last question so the user clearly understands what to answer next.
Include a short Python code snippet demonstrating the concept.
Respond ONLY in JSON format as follows:
{{
    "reply": "Rephrased question",
    "code": "Python snippet (use \\n for newlines)",
    "hint": "Optional hint text"
}}
Previous question: {last_question}
"""
    else:
        prompt = f"""
You are a system design mentor guiding a user to design a URL shortener system.
Current context: {message.context}
User response: {user_input}

1. If the user is correct, acknowledge briefly, then ask the next question.
2. If the user is unsure, provide a short Python snippet and a hint.
3. Always include Python code snippet in the 'code' field, use \\n for newlines.
4. Respond ONLY in JSON format:
{{
    "reply": "Text response",
    "code": "Python snippet (short, use \\n for newlines)",
    "hint": "Optional hint"
}}
"""

    # Query the LLM in a thread-safe way
    response_text = await to_thread(query_llm, prompt)

    # Parse safely
    try:
        parsed = json.loads(response_text)
        parsed["code"] = parsed.get("code", "").replace("\\n", "\n")
    except Exception:
        parsed = {
            "reply": response_text,
            "code": "# Unable to generate code",
            "hint": ""
        }

    # Update conversation
    conversation = message.context.get("conversation", [])
    conversation.append({"sender": "user", "text": user_input})
    conversation.append({
        "sender": "system",
        "text": parsed.get("reply", ""),
        "code": parsed.get("code", ""),
        "hint": parsed.get("hint", "")
    })

    updated_context = message.context.copy()
    updated_context["last_question"] = parsed.get("reply", "")
    updated_context["conversation"] = conversation

    return {
        "reply": parsed.get("reply", ""),
        "code": parsed.get("code", ""),
        "hint": parsed.get("hint", ""),
        "context": updated_context
    }
