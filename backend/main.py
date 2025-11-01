# backend/main.py - Fixed to always give 0 for generic responses
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from hf_client import query_llm
import json
import textwrap
from asyncio import to_thread
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import os
from bson import ObjectId
from fastapi import HTTPException

load_dotenv()

MONGO_URI = os.environ["MONGO_URI"]
client = AsyncIOMotorClient(MONGO_URI)
db = client["SystemDesign"]
learning_paths_collection = db["learning_paths"]

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

async def get_system_prompt(learning_path_title: str) -> str:
    doc = await learning_paths_collection.find_one({"title": learning_path_title})
    if doc and "description" in doc:
        return doc["description"]
    return "You are a System Design Tutor. Provide concise step-by-step guidance."

class UserMessage(BaseModel):
    message: str
    context: dict = {}
    learning_path: str
    is_first_response: bool = False
    model_config = {
        "extra": "allow"
    }

def format_code(code: str, width: int = 80) -> str:
    lines = code.split("\n")
    formatted = []
    for line in lines:
        wrapped = textwrap.fill(line, width=width, subsequent_indent="    ")
        formatted.append(wrapped)
    return "\n".join(formatted)

@app.post("/design_chat")
async def design_chat(message: UserMessage):
    user_input = message.message.strip()
    system_prompt = await get_system_prompt(message.learning_path)
    
    generic_responses = ["ok", "yes", "sure", "got it", "alright"]
    last_question = message.context.get("last_question", "")
    
    # Check if this is a generic response
    is_generic = user_input.lower() in generic_responses
    
    # Handle first response - just acknowledge and ask first real question
    if message.is_first_response:
        prompt = f"""
{system_prompt}

This is the user's first response: '{user_input}'
Welcome them and ask the first system design question about {message.learning_path}.
Keep it friendly and concise (under 50 words).

Respond ONLY in valid JSON format:
{{
    "reply": "Welcome message and first question",
    "code": "Optional Python snippet with \\n for newlines",
    "hint": "Optional hint",
    "score": null,
    "feedback": ""
}}
"""
    elif is_generic:
        prompt = f"""
User replied with a generic confirmation: '{user_input}'.
This is NOT a real answer, so the score MUST be exactly 0.
Rephrase the last question so the user clearly understands what to answer next.
Include a short Python code snippet demonstrating the concept.
Reply should be <50 words

IMPORTANT: The score field MUST be the number 0, not a string.

Respond ONLY in valid JSON format:
{{
    "reply": "Rephrased question",
    "code": "Optional Python snippet with \\n for newlines",
    "hint": "Optional hint text",
    "score": 0,
    "feedback": "Generic response - no answer provided"
}}

Previous question: {last_question}
"""
    else:
        # Get recent conversation for context
        recent_conversation = message.context.get("conversation", [])[-6:]  # Last 3 exchanges
        conversation_text = "\n".join([
            f"{msg['sender']}: {msg['text']}" 
            for msg in recent_conversation 
            if 'text' in msg
        ])
        
        prompt = f"""
{system_prompt}

Recent conversation:
{conversation_text}

Current question: {last_question}
User's answer: {user_input}

Your task:
1. Evaluate the user's answer based on:
   - Correctness and accuracy (40%)
   - Depth of understanding (30%)
   - Completeness (20%)
   - Technical terminology usage (10%)

2. Assign a score from 0-10:
   - 0-3: Incorrect or very incomplete answer
   - 4-5: Partially correct but missing key concepts
   - 6-7: Correct but lacks depth or completeness
   - 8-9: Good answer with proper understanding
   - 10: Excellent, comprehensive answer

3. If score >= 6, acknowledge briefly and ask the next question
4. If score < 6, provide guidance and a hint
5. Always include a Python code snippet related to the concept
6. Keep reply under 50 words
7. IMPORTANT: For the "code" field, use \\n for newlines, do NOT use triple quotes or markdown formatting

Respond ONLY in valid JSON format (no markdown, no code blocks):
{{
    "reply": "Your feedback and next question or guidance",
    "code": "Python snippet with \\n for newlines (no triple quotes, no markdown)",
    "hint": "Hint if score < 6, empty string otherwise",
    "score": 0-10,
    "feedback": "Brief explanation of the score (1 sentence)"
}}
"""
    
    response_text = await to_thread(query_llm, prompt, system_prompt)
    
    # Clean up the response before parsing
    response_text = response_text.strip()
    
    # Remove markdown code blocks if present
    if response_text.startswith("```json"):
        response_text = response_text[7:]
    if response_text.startswith("```"):
        response_text = response_text[3:]
    if response_text.endswith("```"):
        response_text = response_text[:-3]
    response_text = response_text.strip()
    
    try:
        parsed = json.loads(response_text)
        
        # Clean up code field - handle various escape sequences
        if "code" in parsed and parsed["code"]:
            code = parsed["code"]
            # Replace various newline representations
            code = code.replace("\\n", "\n")
            code = code.replace("\\t", "    ")
            # Remove triple quotes if present
            code = code.replace('"""', '')
            code = code.strip()
            parsed["code"] = code
        
        # Ensure score is present and valid
        if "score" not in parsed or not isinstance(parsed["score"], (int, float)):
            parsed["score"] = 0 if is_generic else 5
        
        # Clamp score between 0 and 10
        parsed["score"] = max(0, min(10, parsed["score"]))
        
        # CRITICAL: Force score to 0 for generic responses no matter what AI returned
        if is_generic:
            parsed["score"] = 0
            parsed["feedback"] = "Generic response - no answer provided"
        
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        print(f"Response text: {response_text}")
        
        # Try to extract components manually
        import re
        
        reply_match = re.search(r'"reply"\s*:\s*"([^"]*)"', response_text)
        code_match = re.search(r'"code"\s*:\s*"([^"]*)"', response_text, re.DOTALL)
        hint_match = re.search(r'"hint"\s*:\s*"([^"]*)"', response_text)
        score_match = re.search(r'"score"\s*:\s*(\d+)', response_text)
        feedback_match = re.search(r'"feedback"\s*:\s*"([^"]*)"', response_text)
        
        parsed = {
            "reply": reply_match.group(1) if reply_match else "Please provide more details about your approach.",
            "code": code_match.group(1).replace("\\n", "\n") if code_match else "",
            "hint": hint_match.group(1) if hint_match else "",
            "score": 0 if is_generic else (int(score_match.group(1)) if score_match else 5),
            "feedback": "Generic response - no answer provided" if is_generic else (feedback_match.group(1) if feedback_match else "Error processing response")
        }
    except Exception as e:
        print(f"Unexpected error: {e}")
        parsed = {
            "reply": "Please elaborate on your system design approach.",
            "code": "# Unable to generate code",
            "hint": "",
            "score": 0 if is_generic else 5,
            "feedback": "Generic response - no answer provided" if is_generic else "Error processing response"
        }
    
    # Update conversation history
    conversation = message.context.get("conversation", [])
    
    # Only add score to user message if it's not the first response
    user_msg = {"sender": "user", "text": user_input}
    if not message.is_first_response and parsed.get("score") is not None:
        user_msg["score"] = parsed.get("score")
    
    conversation.append(user_msg)
    conversation.append({
        "sender": "system",
        "text": parsed.get("reply", ""),
        "code": parsed.get("code", ""),
        "hint": parsed.get("hint", "")
    })
    
    updated_context = message.context.copy()
    updated_context["last_question"] = parsed.get("reply", "")
    updated_context["conversation"] = conversation
    
    # Log the score being returned
    print(f"User input: {user_input}")
    print(f"Is generic: {is_generic}")
    print(f"Score being returned: {parsed.get('score')}")
    
    return {
        "reply": parsed.get("reply", ""),
        "code": parsed.get("code", ""),
        "hint": parsed.get("hint", ""),
        "score": parsed.get("score", 0 if is_generic else 5),
        "feedback": parsed.get("feedback", ""),
        "context": updated_context
    }

@app.get("/learning-paths")
async def get_learning_paths():
    paths_cursor = learning_paths_collection.find()
    paths = []
    async for path in paths_cursor:
        path["_id"] = str(path["_id"])
        paths.append(path)
    return paths


@app.get("/learning-paths/{path_id}")
async def get_learning_path(path_id: str):
    path = await learning_paths_collection.find_one({"_id": ObjectId(path_id)})
    if path:
        path["_id"] = str(path["_id"])
        return path
    raise HTTPException(status_code=404, detail="Learning path not found")