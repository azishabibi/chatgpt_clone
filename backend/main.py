import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import os

# Set Hugging Face cache directory to the current directory
os.environ['HF_HOME'] = os.getcwd()
print(f"Hugging Face cache directory set to: {os.environ['HF_HOME']}")

# MongoDB Connection
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
client = AsyncIOMotorClient(MONGO_URL)
db = client.chatgpt_clone

# Initialize FastAPI app
app = FastAPI()

# Allow CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the model and tokenizer
#MODEL_ID = "nahgetout/test"
MODEL_ID='infly/OpenCoder-1.5B-Instruct'
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

print("Loading model to GPU...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, trust_remote_code=True).to(device)
print("Model loaded to GPU.")
print(tokenizer.eos_token_id)
print(tokenizer.pad_token_id)
# Define the chat endpoint
def serialize_doc(doc):
    doc["_id"] = str(doc["_id"])
    return doc

# Create a new chat session
@app.post("/new_chat")
async def new_chat(user_id: str, title: str = "New Chat"):
    chat_session = {
        "user_id": user_id,
        "title": title,
        "messages": []
    }
    result = await db.chat_sessions.insert_one(chat_session)
    return {"chat_session_id": str(result.inserted_id)}

# Send a message to a chat session
@app.post("/chat")
async def chat(request: Request):
    data = await request.json()
    chat_session_id = data.get("chat_session_id")
    message = data.get("message")

    if not chat_session_id or not message:
        raise HTTPException(status_code=400, detail="Chat session ID and message are required")

    # Fetch the chat session
    chat_session = await db.chat_sessions.find_one({"_id": ObjectId(chat_session_id)})
    if not chat_session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # Add the user message to the session
    user_message = {"sender": "User", "content": message}
    await db.chat_sessions.update_one(
        {"_id": ObjectId(chat_session_id)},
        {"$push": {"messages": user_message}}
    )

    # Generate a response using the model
    inputs = tokenizer(message, return_tensors="pt").to(device)
    outputs = model.generate(
        **inputs,
        max_length=200,
        eos_token_id=tokenizer.eos_token_id,
        pad_token_id=tokenizer.pad_token_id,
        #num_beams=5,
        repetition_penalty=1.2,
        no_repeat_ngram_size=3,
        #early_stopping=True
    )

    bot_response = tokenizer.decode(outputs[0], skip_special_tokens=False)

    # Add the bot's response to the session
    bot_message = {"sender": "Chatbot", "content": bot_response}
    await db.chat_sessions.update_one(
        {"_id": ObjectId(chat_session_id)},
        {"$push": {"messages": bot_message}}
    )

    return {"response": bot_response}
# Get chat history for a user
@app.get("/chat_history/{user_id}")
async def get_chat_history(user_id: str):
    chat_sessions = await db.chat_sessions.find({"user_id": user_id}).to_list(100)
    return {"chat_sessions": [serialize_doc(chat) for chat in chat_sessions]}

# Get messages in a chat session
@app.get("/chat_session/{chat_session_id}")
async def get_chat_session(chat_session_id: str):
    chat_session = await db.chat_sessions.find_one({"_id": ObjectId(chat_session_id)})
    if not chat_session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return serialize_doc(chat_session)

# Delete a chat session
@app.delete("/delete_chat/{chat_session_id}")
async def delete_chat(chat_session_id: str):
    result = await db.chat_sessions.delete_one({"_id": ObjectId(chat_session_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return {"message": "Chat session deleted successfully"}

# Rename a chat session
@app.put("/rename_chat/{chat_session_id}")
async def rename_chat(chat_session_id: str, request: Request):
    data = await request.json()
    new_title = data.get("title")

    if not new_title:
        raise HTTPException(status_code=400, detail="New title is required")

    result = await db.chat_sessions.update_one(
        {"_id": ObjectId(chat_session_id)},
        {"$set": {"title": new_title}}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Chat session not found")

    return {"message": "Chat session renamed successfully"}
