import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [chatSessions, setChatSessions] = useState([]);
  const [currentChatSessionId, setCurrentChatSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [editingTitle, setEditingTitle] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const activeChatRef = useRef(null); // ✅ Track the active chat session ID
  const messagesEndRef = useRef(null);
  const cancelTokenSourceRef = useRef(null); // ✅ Track cancel tokens for Axios requests

  // Load chat history when the app starts
  useEffect(() => {
    loadChatHistory();
  }, []);

  // Scroll to the bottom of the chat window
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Function to load chat history
  const loadChatHistory = async () => {
    try {
      const response = await axios.get('http://localhost:8000/chat_history/1');
      setChatSessions(response.data.chat_sessions);
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  };

  // Function to load messages from a specific chat session
  const loadChatSession = async (sessionId) => {
    // ✅ Cancel the ongoing message generation request if any
    if (cancelTokenSourceRef.current) {
      cancelTokenSourceRef.current.cancel('Switching chat session');
    }

    setCurrentChatSessionId(sessionId);
    activeChatRef.current = sessionId;

    try {
      const response = await axios.get(`http://localhost:8000/chat_session/${sessionId}`);
      setMessages(response.data.messages);
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('Request canceled:', error.message);
      } else {
        console.error('Error loading chat session:', error);
      }
    }
  };

  // Function to create a new chat session
  const createNewChat = async () => {
    try {
      const response = await axios.post('http://localhost:8000/new_chat?user_id=1&title=New Chat');
      const newChatSessionId = response.data.chat_session_id;

      setChatSessions([...chatSessions, { _id: newChatSessionId, title: 'New Chat' }]);
      setMessages([]);
      setCurrentChatSessionId(newChatSessionId);

      return newChatSessionId;
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  };

  // Function to delete a chat session
  const deleteChatSession = async (sessionId) => {
    try {
      await axios.delete(`http://localhost:8000/delete_chat/${sessionId}`);
      setChatSessions(chatSessions.filter((session) => session._id !== sessionId));
      if (currentChatSessionId === sessionId) {
        setCurrentChatSessionId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Error deleting chat session:', error);
    }
  };

  // Function to handle renaming chat session
  const renameChatSession = async (sessionId) => {
    if (!newTitle.trim()) return;

    try {
      await axios.put(`http://localhost:8000/rename_chat/${sessionId}`, {
        title: newTitle,
      });

      setChatSessions(chatSessions.map((session) =>
        session._id === sessionId ? { ...session, title: newTitle } : session
      ));

      setEditingTitle(null);
      setNewTitle('');
    } catch (error) {
      console.error('Error renaming chat session:', error);
    }
  };

  // Function to handle key events in the input field
  const handleKeyDown = (e, sessionId) => {
    if (e.key === 'Enter') {
      handleTitleEditComplete(sessionId);
    }
  };

  // Function to handle input field blur (focus loss)
  const handleBlur = (sessionId) => {
    handleTitleEditComplete(sessionId);
  };

  // Function to handle title edit completion
  const handleTitleEditComplete = (sessionId) => {
    renameChatSession(sessionId);
  };

  // Function to send a message
  const sendMessage = async () => {
    if (!input.trim()) return;

    let sessionId = currentChatSessionId;

    if (!sessionId) {
      sessionId = await createNewChat();
    }

    setMessages([...messages, { sender: 'You', content: input }]);
    setInput('');

    setIsGenerating(true);
    activeChatRef.current = sessionId;

    // ✅ Create a new cancel token for this request
    cancelTokenSourceRef.current = axios.CancelToken.source();

    try {
      const response = await axios.post(
        'http://localhost:8000/chat',
        {
          chat_session_id: sessionId,
          message: input,
        },
        { cancelToken: cancelTokenSourceRef.current.token }
      );

      // ✅ Ensure the response is added to the correct session
      if (activeChatRef.current === sessionId) {
        setMessages((prevMessages) => [
          ...prevMessages,
          { sender: 'Chatbot', content: response.data.response },
        ]);
      } else {
        console.log('Message generated for an old session, ignoring response.');
      }
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('Request canceled:', error.message);
      } else {
        console.error('Error sending message:', error);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="App">
      <div className="sidebar">
        <h2>Chat Sessions</h2>
        <div className="chat-sessions-container" >
          {chatSessions.map((session) => (
            <div
              key={session._id}
              className={currentChatSessionId === session._id ? 'active-session' : ''}
              onClick={() => loadChatSession(session._id)}
            >
              {editingTitle === session._id ? (
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onBlur={() => handleBlur(session._id)}
                  onKeyDown={(e) => handleKeyDown(e, session._id)}
                  autoFocus
                />
              ) : (
                <span
                  onDoubleClick={() => {
                    setEditingTitle(session._id);
                    setNewTitle(session.title);
                  }}
                >
                  {session.title}
                </span>
              )}
              <button className="delete-button" onClick={() => deleteChatSession(session._id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
        <button onClick={createNewChat}>New Chat</button>
      </div>

      <div className="chat-window">
        <h1>ChatGPT Clone</h1>
        <div className="messages-container">
          {messages.map((msg, index) => (
            <div key={index} className={msg.sender === 'You' ? 'user-message' : 'bot-message'}>
              <strong>{msg.sender}: </strong> {msg.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {isGenerating && <div className="loading-indicator">Generating response...</div>}

        <div className="input-area">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            disabled={isGenerating}
          />
          <button onClick={sendMessage} disabled={isGenerating}>
            {isGenerating ? 'Generating...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
