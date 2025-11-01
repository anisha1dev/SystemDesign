# hf_client.py
from openai import OpenAI
import os
from dotenv import load_dotenv
from prompt import SYSTEM_PROMPT

load_dotenv()

client = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=os.environ["HF_TOKEN"]
)


def query_llm(user_message: str) -> str:
    completion = client.chat.completions.create(
        model="meta-llama/Meta-Llama-3-8B-Instruct:novita",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message}
        ]
    )
    return completion.choices[0].message.content
