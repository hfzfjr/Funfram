'use client';

import { useState, useRef, useEffect } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';
import './SidebarChat.css';

interface SidebarChatProps {
    onClose?: () => void;
}

export default function SidebarChat({ onClose }: SidebarChatProps) {
    const [text, setText] = useState('');
    const messages = useCallStore((state) => state.generalChat);
    const localUser = useCallStore((state) => state.localUser);
    const leftParticipants = useCallStore((state) => state.leftParticipants);
    const ws = WebSocketService.getInstance();
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (!text.trim() || !localUser) return;

        // Send via WebSocket/Mock service
        ws.sendEvent('CHAT_MESSAGE', { text: text.trim() });
        
        setText('');
    };

    // Helper to identify if message sender belongs to local frame
    const isLocalSender = (senderId: string) => {
        return leftParticipants.some(p => p.id === senderId);
    };

    return (
        <div className="sidebar-chat">
            <div className="sidebar-header">
                <h2 className="sidebar-title">General Chat</h2>
                <button onClick={onClose} className="close-button" aria-label="Close Chat">
                    ✕
                </button>
            </div>

            {/* Chat Messages Logs */}
            <div className="chat-messages-container">
                {messages.length === 0 ? (
                    <div className="empty-chat">
                        <span className="empty-chat-icon">💬</span>
                        <p>No messages yet. Send a message to start chatting!</p>
                    </div>
                ) : (
                    messages.map((msg) => {
                        if (msg.senderId === 'system') {
                            return (
                                <div key={msg.id} className="system-message">
                                    <span className="system-text">{msg.text}</span>
                                </div>
                            );
                        }

                        const isLocal = isLocalSender(msg.senderId);
                        return (
                            <div
                                key={msg.id}
                                className={`chat-bubble-wrapper ${isLocal ? 'local-wrapper' : 'remote-wrapper'}`}
                            >
                                <div className="bubble-sender-name">
                                    {msg.senderName} <span className="bubble-time">{msg.timestamp}</span>
                                </div>
                                <div className={`chat-bubble ${isLocal ? 'local-bubble' : 'remote-bubble'}`}>
                                    {msg.text}
                                </div>
                            </div>
                        );
                    })
                )}
                <div ref={chatEndRef} />
            </div>

            {/* Chat Send Input Box */}
            <form onSubmit={handleSend} className="chat-input-form">
                <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Type a message..."
                    className="chat-message-input"
                    maxLength={200}
                />
                <button type="submit" className="chat-send-btn" disabled={!text.trim()}>
                    Send
                </button>
            </form>
        </div>
    );
}
