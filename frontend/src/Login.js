import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './App.css';

function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async () => {
        try {
            const response = await axios.post('http://localhost:8000/login', { username, password });
            localStorage.setItem('token', response.data.access_token);
            setError('');
            navigate('/');
        } catch (error) {
            setError('Login failed. Check your credentials.');
        }
    };

    return (
        <div className="auth-container">
            <h2>Login</h2>
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
            <button onClick={handleLogin}>Login</button>
            <p>
                Don't have an account?{' '}
                <span className="link" onClick={() => navigate('/register')}>
                    Register
                </span>
            </p>
            {error && <p className="error-message">{error}</p>}
        </div>
    );
}

export default Login;
