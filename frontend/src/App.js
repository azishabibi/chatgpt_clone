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
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const activeChatRef = useRef(null); // ✅ Track the active chat session ID
  const messagesEndRef = useRef(null);
  const cancelTokenSourceRef = useRef(null); // ✅ Track cancel tokens for Axios requests

  // Load chat history when the app starts
  useEffect(() => {
    if (localStorage.getItem('token')) {
      setIsAuthenticated(true);
      loadChatHistory();
    }
  }, []);

  // Scroll to the bottom of the chat window
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);
  // Helper function to get the authorization header
  const authHeader = () => {
    return { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  };

  // User registration
  const register = async () => {
    try {
      const response = await axios.post(
        'http://localhost:8000/register',
        {
          username: username.trim(),
          password: password.trim(),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      // Store the token in local storage
      localStorage.setItem('token', response.data.access_token);
      setIsAuthenticated(true);
      loadChatHistory();
    } catch (error) {
      console.error('Registration failed:', error);
      setError('Registration failed. Please try again.');
    }
  };


  // User login
  const login = async () => {
    try {
      const response = await axios.post('http://localhost:8000/login', { username, password });
      localStorage.setItem('token', response.data.access_token);
      setIsAuthenticated(true);
      loadChatHistory();
    } catch (error) {
      setError('Login failed. Check your credentials.');
    }
  };

  // User logout
  const logout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setChatSessions([]);
    setMessages([]);
    setCurrentChatSessionId(null);
  };

  // Function to load chat history
  const loadChatHistory = async () => {
    try {
      const response = await axios.get('http://localhost:8000/chat_history', authHeader());
      setChatSessions(response.data.chat_sessions);
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  };

  // Function to load messages from a specific chat session
  const loadChatSession = async (sessionId) => {
    try {
      const response = await axios.get(`http://localhost:8000/chat_session/${sessionId}`, authHeader());
      setMessages(response.data.messages);
    } catch (error) {
      console.error('Error loading chat session:', error);
    }
  };


  // Function to create a new chat session
  const createNewChat = async () => {
    try {
      const response = await axios.post(
        'http://localhost:8000/new_chat',
        { title: 'New Chat' },
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
      );

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
      await axios.delete(
        `http://localhost:8000/delete_chat/${sessionId}`,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        }
      );

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
      await axios.put(
        `http://localhost:8000/rename_chat/${sessionId}`,
        { title: newTitle },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        }
      );

      setChatSessions(
        chatSessions.map((session) =>
          session._id === sessionId ? { ...session, title: newTitle } : session
        )
      );

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

    cancelTokenSourceRef.current = axios.CancelToken.source();

    try {
      const response = await axios.post(
        'http://localhost:8000/chat',
        {
          chat_session_id: sessionId,
          message: input,
        },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          cancelToken: cancelTokenSourceRef.current.token,
        }
      );

      if (activeChatRef.current === sessionId) {
        setMessages((prevMessages) => [
          ...prevMessages,
          { sender: 'Chatbot', content: response.data.response },
        ]);
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
      {!isAuthenticated ? (
        <div className="auth-container">
          <h2>Login or Register</h2>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={login}>Login</button>
          <button onClick={register}>Register</button>
          {error && <p className="error-message">{error}</p>}
        </div>
      ) : (
        <div className="main-container">
          {/* Sidebar */}
          <div className="sidebar">
            <h2>Chat Sessions</h2>
            <div className="chat-sessions-container">
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
                  <button
                    className="delete-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteChatSession(session._id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
            <button onClick={createNewChat}>New Chat</button>
          </div>

          {/* Chat Window */}
          <div className="chat-window">
            <div className="chat-header">
              <h1>ChatGPT Clone</h1>
              <button className="logout-button" onClick={logout}>
                Logout
              </button>
            </div>

            <div className="messages-container">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={msg.sender === 'You' ? 'user-message' : 'bot-message'}
                >
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
      )}
    </div>
  );


}

export default App;
