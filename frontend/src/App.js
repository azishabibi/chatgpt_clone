import React, { useEffect } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import './App.css';
import Login from './Login';
import Register from './Register';
import Chat from './Chat';

function ProtectedRoute({ children }) {
  // 这里如果获取到的是 null，就说明 localStorage 中没有 "token"
  // 如果获取到的是字符串（比如 "abc123"），就说明已登录
  const token = localStorage.getItem('token');

  // 如果没有 token，跳转到 /login
  if (!token) {
    return <Navigate to="/login" replace />;
  }

  // 如果有 token，渲染子元素（受保护页面）
  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        {/* 
          ② 当访问 "/" 时，会先进入 <ProtectedRoute> 判断 token，
          如果 token 不存在，就跳转到 /login；存在则渲染 <Chat /> 
        */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />

        {/* 
          ③ login、register 这两个路由不需要鉴权，用户可以直接访问 
        */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </Router>
  );
}


export default App;
