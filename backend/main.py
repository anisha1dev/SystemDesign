# backend/main.py
from asyncio import to_thread
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os
from dotenv import load_dotenv
from hf_client import query_llm
from redis_cache import cache_get, cache_set
from utils import load_blob_from_mongo
import json

load_dotenv()

# ---------------- MongoDB Setup ----------------
MONGO_URI = os.environ["MONGO_URI"]
client = AsyncIOMotorClient(MONGO_URI)
db = client["SystemDesign"]
learning_paths_collection = db["learning_paths"]

# ---------------- FastAPI Setup ----------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- Pydantic ----------------
class UserMessage(BaseModel):
    message: str
    context: dict = {}
    learning_path: str
    is_first_response: bool = False
    model_config = {"extra": "allow"}

# ---------------- Chat Endpoint ----------------
@app.post("/design_chat")
async def design_chat(message: UserMessage):
    user_input = message.message.strip()

    # 1️⃣ Load learning path content from Redis/Mongo
    cache_key = f"learning_path:{message.learning_path}"
    content = cache_get(cache_key)
    if not content:
        try:
            content = await load_blob_from_mongo(learning_paths_collection, message.learning_path)
            cache_set(cache_key, content)
        except Exception as e:
            print(f"Error loading content: {e}")
            return {"error": "Unable to load learning path content."}

    # Use first 1000 chars for context
    context_summary = content[:1000]

    # 2️⃣ Build prompt
    if message.is_first_response:
        prompt = f"""
You are a friendly study buddy helping the user learn '{message.learning_path}'.
Welcome the user and ask the first question about this topic.
Rules:
1. Keep reply under 50 words.
2. Provide subtle hints only if the user answer is partially incorrect.
3. Respond ONLY in JSON format with:
{{
    "reply": "Welcome message + first question",
    "hint": ""
}}
"""
    else:
        recent_conversation = message.context.get("conversation", [])[-6:]
        conversation_text = "\n".join([f"{msg['sender']}: {msg['text']}" for msg in recent_conversation if 'text' in msg])
        last_question = message.context.get("last_question", "")
        prompt = f"""
You are a friendly study buddy helping the user learn '{message.learning_path}'.
Relevant content: {context_summary}

Recent conversation:
{conversation_text}

Current question: {last_question}
User's answer: {user_input}

Rules:
1. Keep reply under 50 words.
2. Provide subtle hints only if the user's answer is partially incorrect.
3. Respond ONLY in JSON format:
{{
    "reply": "Next question or feedback",
    "hint": "Subtle hint if needed"
}}
"""

    # 3️⃣ Check if LLM response is cached
    import hashlib
    conv_text = "".join([msg.get("text", "") for msg in message.context.get("conversation", [])])
    llm_cache_key = "llm_response:" + hashlib.sha256(f"{message.learning_path}:{user_input}:{conv_text}".encode()).hexdigest()
    cached_response = cache_get(llm_cache_key)
    if cached_response:
        parsed = json.loads(cached_response)
    else:
        # Call LLM
        try:
            response_text = await to_thread(query_llm, prompt, context_summary)
            response_text = response_text.strip()
            for prefix in ["```json", "```"]:
                if response_text.startswith(prefix):
                    response_text = response_text[len(prefix):]
            if response_text.endswith("```"):
                response_text = response_text[:-3]
            response_text = response_text.strip()

            try:
                parsed = json.loads(response_text)
            except json.JSONDecodeError:
                import re
                reply_match = re.search(r'"reply"\s*:\s*"([^"]*)"', response_text)
                hint_match = re.search(r'"hint"\s*:\s*"([^"]*)"', response_text)
                parsed = {
                    "reply": reply_match.group(1) if reply_match else "Please provide more details about your approach.",
                    "hint": hint_match.group(1) if hint_match else "",
                }

            # Cache LLM response
            cache_set(llm_cache_key, json.dumps(parsed))
        except Exception as e:
            print(f"Error processing LLM request: {e}")
            return {"error": "Error processing request."}

    # 4️⃣ Update conversation
    conversation = message.context.get("conversation", [])
    conversation.append({"sender": "user", "text": user_input})
    conversation.append({"sender": "system", "text": parsed.get("reply", ""), "hint": parsed.get("hint", "")})

    updated_context = message.context.copy()
    updated_context["last_question"] = parsed.get("reply", "")
    updated_context["conversation"] = conversation

    return {
        "reply": parsed.get("reply", ""),
        "hint": parsed.get("hint", ""),
        "context": updated_context
    }

# ---------------- Learning Path Endpoints ----------------
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
