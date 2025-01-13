import torch
import os
import asyncio
import threading
from contextvars import ContextVar

from transformers import AutoTokenizer, AutoModelForCausalLM
from fastapi import FastAPI, Request, HTTPException, Depends, status,Body
from fastapi.security import OAuth2PasswordBearer
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from pydantic import BaseModel
from typing import Optional
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv

# =======================
# Configuration Variables
# =======================

load_dotenv()
# Secret key for JWT

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440

# Set Hugging Face cache directory to the current directory
os.environ['HF_HOME'] = os.getcwd()
print(f"Hugging Face cache directory set to: {os.environ['HF_HOME']}")

# MongoDB Connection

SECRET_KEY = os.getenv("SECRET_KEY")
MONGO_URL = os.getenv("MONGO_URL")
client = AsyncIOMotorClient(MONGO_URL)
db = client.chatgpt_clone

# Initialize FastAPI app
app = FastAPI()

# Allow CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust as needed for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# =======================
# Pydantic Models
# =======================

class UserCreate(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None

class NewChatRequest(BaseModel):
    title: Optional[str] = "New Chat"
# =======================
# Utility Functions
# =======================

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)  # Default 15 minutes
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_user(username: str):
    user = await db.users.find_one({"username": username})
    return user

async def authenticate_user(username: str, password: str):
    user = await get_user(username)
    if not user:
        return False
    if not verify_password(password, user["hashed_password"]):
        return False
    return user

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Dependency to get current user
async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Decode the JWT
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception

    # Retrieve user from the database
    user = await get_user(username=token_data.username)
    if user is None:
        raise credentials_exception
    return user

# =======================
# User Authentication Endpoints
# =======================

@app.post("/register", response_model=Token)
async def register(user: UserCreate):
    existing_user = await db.users.find_one({"username": user.username})
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    hashed_password = get_password_hash(user.password)
    user_doc = {
        "username": user.username,
        "hashed_password": hashed_password,
    }
    await db.users.insert_one(user_doc)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.post("/login", response_model=Token)
async def login(user: UserLogin):
    authenticated_user = await authenticate_user(user.username, user.password)
    if not authenticated_user:
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": authenticated_user["username"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

# =======================
# Load the Model and Tokenizer
# =======================

#MODEL_ID = "nahgetout/test"
MODEL_ID='infly/OpenCoder-1.5B-Instruct'
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

print("Loading model to GPU..." if device.type == "cuda" else "Loading model to CPU...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, trust_remote_code=True)
model = AutoModelForCausalLM.from_pretrained(MODEL_ID, trust_remote_code=True).to(device)
print("Model loaded to GPU." if device.type == "cuda" else "Model loaded to CPU.")
print(f"EOS Token ID: {tokenizer.eos_token_id}")
print(f"Pad Token ID: {tokenizer.pad_token_id}")

# =======================
# Chat Session Utilities
# =======================

def serialize_doc(doc):
    doc["_id"] = str(doc["_id"])
    return doc

# =======================
# Chat Endpoints (Protected)
# =======================

@app.post("/new_chat")
async def new_chat(request: Request, user: dict = Depends(get_current_user)):
    """
    Create a new chat session.
    """
    # Parse the JSON body
    data = await request.json()
    
    # Get the title or set a default title
    title = data.get("title", "New Chat")

    # Insert the chat session into MongoDB
    chat_session = {
        "user_id": user["username"],
        "title": title,
        "messages": []
    }
    result = await db.chat_sessions.insert_one(chat_session)

    # Return the new chat session ID
    return {"chat_session_id": str(result.inserted_id)}

# Send a message to a chat session
generation_tasks = {}
@app.post("/chat")
async def chat(request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    chat_session_id = data.get("chat_session_id")
    message = data.get("message")

    if not chat_session_id or not message:
        raise HTTPException(status_code=400, detail="Chat session ID and message are required")

    # Fetch the chat session
    chat_session = await db.chat_sessions.find_one({"_id": ObjectId(chat_session_id), "user_id": user["username"]})
    if not chat_session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # Add the user message to the session
    user_message = {"sender": "User", "content": message}
    await db.chat_sessions.update_one(
        {"_id": ObjectId(chat_session_id)},
        {"$push": {"messages": user_message}}
    )

    task = asyncio.create_task(generate_response(message, chat_session_id, user["username"]))

    # 存储用户的生成任务
    generation_tasks[user["username"]] = task

    # 等待任务完成
    try:
        response = await task
    except asyncio.CancelledError:
        return {"response": "Generation stopped."}

    return {"response": response}
# 生成模型回复的异步任务
async def generate_response(message, chat_session_id, username):
    # Convert input to tensor
    inputs = tokenizer(message, return_tensors="pt").to(device)

    try:
        # Generate the model's response
        outputs = model.generate(
            **inputs,
            max_length=200,
            eos_token_id=tokenizer.eos_token_id,
            pad_token_id=tokenizer.pad_token_id,
            repetition_penalty=1.2,
            no_repeat_ngram_size=3,
            temperature=0.7,
            top_k=50,
            top_p=0.9,
            do_sample=True
        )

        # Decode the generated text
        bot_response = tokenizer.decode(outputs[0], skip_special_tokens=True)

        # Add the bot's response to the session
        bot_message = {"sender": "Chatbot", "content": bot_response}
        await db.chat_sessions.update_one(
            {"_id": ObjectId(chat_session_id)},
            {"$push": {"messages": bot_message}}
        )

        return bot_response

    except asyncio.CancelledError:
        # Handle task cancellation
        print("Generation task was cancelled.")
        raise

@app.post("/stop_generation")
async def stop_generation(user: dict = Depends(get_current_user)):
    # 获取当前用户的生成任务
    task = generation_tasks.get(user["username"])

    if not task:
        return {"message": "No active generation task found."}

    # 取消任务
    task.cancel()
    return {"message": "Generation stopped."}


# Get chat history for the current user
@app.get("/chat_history")
async def get_chat_history(user: dict = Depends(get_current_user)):
    chat_sessions = await db.chat_sessions.find({"user_id": user["username"]}).to_list(100)
    return {"chat_sessions": [serialize_doc(chat) for chat in chat_sessions]}

# Get messages in a chat session
@app.get("/chat_session/{chat_session_id}")
async def get_chat_session(chat_session_id: str, user: dict = Depends(get_current_user)):
    chat_session = await db.chat_sessions.find_one({"_id": ObjectId(chat_session_id), "user_id": user["username"]})
    if not chat_session:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return serialize_doc(chat_session)

# Delete a chat session
@app.delete("/delete_chat/{chat_session_id}")
async def delete_chat(chat_session_id: str, user: dict = Depends(get_current_user)):
    result = await db.chat_sessions.delete_one({"_id": ObjectId(chat_session_id), "user_id": user["username"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return {"message": "Chat session deleted successfully"}

# Rename a chat session
@app.put("/rename_chat/{chat_session_id}")
async def rename_chat(chat_session_id: str, request: Request, user: dict = Depends(get_current_user)):
    data = await request.json()
    new_title = data.get("title")

    if not new_title:
        raise HTTPException(status_code=400, detail="New title is required")

    result = await db.chat_sessions.update_one(
        {"_id": ObjectId(chat_session_id), "user_id": user["username"]},
        {"$set": {"title": new_title}}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Chat session not found")

    return {"message": "Chat session renamed successfully"}
