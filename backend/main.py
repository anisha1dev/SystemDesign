# backend/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from hf_client import query_llm
import json
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

### ---------- SPEECH TO TEXT ----------
HF_API_KEY = os.getenv("HF_TOKEN")

### ---------- MAIN CHAT LOGIC ----------
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
    model_config = {"extra": "allow"}

@app.post("/design_chat")
async def design_chat(message: UserMessage):
    user_input = message.message.strip()
    system_prompt = await get_system_prompt(message.learning_path)

    last_question = message.context.get("last_question", "")
    
    
    # Handle first response - just acknowledge and ask first real question
    if message.is_first_response:
        prompt = f"""
{system_prompt}

This is the user's first response: '{user_input}'
Welcome them and ask the first system design question about {message.learning_path}.
1. Keep reply under 50 words
2. Provide a hint only if the user answer is partially incorrect
3. Hints should be subtle, nudging the user to think deeper, without revealing the answer
4. Avoid step-by-step solutions in the hint

Respond ONLY in valid JSON format:
{{
    "reply": "Welcome message and first question",
    "hint": "Subtle hint",
}}
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
            1. Keep reply under 50 words with system design question about {message.learning_path}
            2. Provide a hint only if the user answer is partially incorrect
            3. Hints should be subtle, nudging the user to think deeper, without revealing the answer
            4. Avoid step-by-step solutions in the hint
            Respond ONLY in valid JSON format (no markdown, no code blocks):
            {{
                "reply": "Next question along with feedback",
                "hint": "Subtle hint",
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
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        print(f"Response text: {response_text}")
        
        # Try to extract components manually
        import re
        
        reply_match = re.search(r'"reply"\s*:\s*"([^"]*)"', response_text)
        hint_match = re.search(r'"hint"\s*:\s*"([^"]*)"', response_text)
        
        parsed = {
            "reply": reply_match.group(1) if reply_match else "Please provide more details about your approach.",
            "hint": hint_match.group(1) if hint_match else "",
        }
    except Exception as e:
        print(f"Unexpected error: {e}")
        parsed = {
            "reply": "Please elaborate on your system design approach.",
            "hint": "",
        }
    
    # Update conversation history
    conversation = message.context.get("conversation", [])
    
    # Only add score to user message if it's not the first response
    user_msg = {"sender": "user", "text": user_input}
    
    conversation.append(user_msg)
    conversation.append({
        "sender": "system",
        "text": parsed.get("reply", ""),
        "hint": parsed.get("hint", "")
    })
    
    updated_context = message.context.copy()
    updated_context["last_question"] = parsed.get("reply", "")
    updated_context["conversation"] = conversation
    
    print(f"User input: {user_input}")

    return {
        "reply": parsed.get("reply", ""),
        "hint": parsed.get("hint", ""),
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