curl -X POST "http://localhost:8000/chat" -H "Content-Type: application/json" -d "{\"prompt\": \"Hello, how are you?\"}"
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
mongod --dbpath D:\mongo\data\db
mongosh

curl -X POST http://localhost:8000/chat ^
-H "Content-Type: application/json" ^
-d "{\"chat_session_id\": \"677c70412b709eb2cf7ee889\", \"message\": \"dfs\"}"

curl -X GET "http://localhost:8000/chat_session/677c70412b709eb2cf7ee889"
curl -X DELETE "http://localhost:8000/delete_chat/677c70412b709eb2cf7ee889"
