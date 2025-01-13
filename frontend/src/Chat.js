import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './App.css';
import { useNavigate } from 'react-router-dom';

function Chat() {
    const [chatSessions, setChatSessions] = useState([]);
    const [currentChatSessionId, setCurrentChatSessionId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [editingTitle, setEditingTitle] = useState(null);
    const [newTitle, setNewTitle] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [abortController, setAbortController] = useState(null);
    const navigate = useNavigate();

    const messagesEndRef = useRef(null);
    const activeChatRef = useRef(null);

    // Helper function to get the authorization header
    const authHeader = () => ({
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    // Load chat history on component mount
    useEffect(() => {
        if (!localStorage.getItem('token')) {
            navigate('/login');
        } else {
            loadChatHistory();
        }
    }, []);

    // Scroll to the bottom of the chat window when new messages arrive
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages]);

    // Load chat history
    const loadChatHistory = async () => {
        try {
            const response = await axios.get('http://localhost:8000/chat_history', authHeader());
            setChatSessions(response.data.chat_sessions);
        } catch (error) {
            console.error('Error loading chat history:', error);
        }
    };

    // Load a specific chat session
    const loadChatSession = async (sessionId) => {
        try {
            const response = await axios.get(`http://localhost:8000/chat_session/${sessionId}`, authHeader());
            setMessages(response.data.messages);
            setCurrentChatSessionId(sessionId);
        } catch (error) {
            console.error('Error loading chat session:', error);
        }
    };

    // Create a new chat session
    const createNewChat = async () => {
        try {
            const response = await axios.post(
                'http://localhost:8000/new_chat',
                { title: 'New Chat' },
                authHeader()
            );

            const newChatSessionId = response.data.chat_session_id;

            if (newChatSessionId) {
                // Add the new chat at the top of the list
                setChatSessions((prevSessions) => [
                    { _id: newChatSessionId, title: 'New Chat' },
                    ...prevSessions,
                ]);
                setMessages([]);
                setCurrentChatSessionId(newChatSessionId);
                return newChatSessionId;
            }
        } catch (error) {
            console.error('Error creating new chat:', error);
        }
    };



    // Rename a chat session
    const renameChatSession = async (sessionId) => {
        if (!newTitle.trim()) return;

        try {
            await axios.put(
                `http://localhost:8000/rename_chat/${sessionId}`,
                { title: newTitle },
                authHeader()
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

    // Delete a chat session
    const deleteChatSession = async (sessionId) => {
        try {
            await axios.delete(`http://localhost:8000/delete_chat/${sessionId}`, authHeader());
            setChatSessions(chatSessions.filter((session) => session._id !== sessionId));
            if (currentChatSessionId === sessionId) {
                setCurrentChatSessionId(null);
                setMessages([]);
            }
        } catch (error) {
            console.error('Error deleting chat session:', error);
        }
    };

    // Send a message
    const sendMessage = async () => {
        
        if (isGenerating) {
            try {
                // Cancel the ongoing request
                if (abortController) {
                    abortController.abort();
                    console.log('Aborted request.');
                }

                // Send the stop request to the backend
                await axios.post('http://localhost:8000/stop_generation', {}, authHeader());
                console.log('Stop generation request sent.');
            } catch (error) {
                console.error('Error stopping generation:', error);
            } finally {
                setIsGenerating(false);
            }
            return;
        }
        
        if (!input.trim()) return;

        let sessionId = currentChatSessionId;

        if (!sessionId) {
            sessionId = await createNewChat();
        }

        setMessages([...messages, { sender: 'You', content: input }]);
        setInput('');
        setIsGenerating(true);
        activeChatRef.current = sessionId;
        // Create a new AbortController for the request
        const controller = new AbortController();
        setAbortController(controller);
        try {
            const response = await axios.post(
                'http://localhost:8000/chat',
                { chat_session_id: sessionId, message: input },
                {
                    ...authHeader(),
                    signal: controller.signal, // Pass the abort signal
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
                console.log('Message generation cancelled.');
            } else {
                console.error('Error sending message:', error);
            }
        } finally {
            setIsGenerating(false);
            setAbortController(null);
        }
    };

    return (
        <div className="main-container">
            {/* Sidebar */}
            <div className="sidebar">
                <h2>Chat Sessions</h2>
                <div className="chat-sessions-container">
                    {chatSessions.map((session) => (
                        <div
                            key={session._id}
                            className={`chat-session-item ${currentChatSessionId === session._id ? 'active-session' : ''
                                }`}
                            onClick={() => loadChatSession(session._id)}
                        >
                            {editingTitle === session._id ? (
                                <input
                                    type="text"
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    onBlur={() => renameChatSession(session._id)}
                                    onKeyDown={(e) => e.key === 'Enter' && renameChatSession(session._id)}
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
                    <button className="button" onClick={() => navigate('/login')}>
                        Logout
                    </button>
                </div>

                <div className="messages-container">
                    {messages.map((msg, index) => (
                        <div
                            key={index}
                            className={msg.sender === 'You' ? 'user-message' : 'bot-message'}
                        >
                            {msg.content}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                

                {/* Input Area */}
                <div className="input-area">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type your message..."
                        onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                        disabled={isGenerating}
                    />
                    <button onClick={sendMessage}>
                        {isGenerating ? 'Stop' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default Chat;
