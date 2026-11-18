'use client';

import { useState, useRef, useEffect } from 'react';
import { useCallStore } from '@/store/useCallStore';
import { WebSocketService } from '@/services/websocket.service';

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

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = (e: React.FormEvent) => {
        e.preventDefault();
        if (!text.trim() || !localUser) return;
        ws.sendEvent('CHAT_MESSAGE', { text: text.trim() });
        setText('');
    };

    const isLocalSender = (senderId: string) => {
        return leftParticipants.some((p) => p.id === senderId);
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/40 backdrop-blur-[4px] z-[1400]" onClick={onClose} />
            <div className="fixed right-0 top-0 w-full md:w-[360px] h-dvh bg-white backdrop-blur-md md:border-l border-slate-200 flex flex-col z-[1500] animate-[slideInRight_0.3s_cubic-bezier(0.4,0,0.2,1)] shadow-[-8px_0_32px_rgba(0,0,0,0.25)]">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
                    <h2 className="text-base font-semibold text-slate-900 m-0">General Chat</h2>
                    <button
                        onClick={onClose}
                        className="bg-slate-200 hover:bg-slate-300 border-none text-slate-600 hover:text-slate-900 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all"
                        aria-label="Close Chat"
                    >
                        ✕
                    </button>
                </div>

                {/* Chat Messages Logs */}
                <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
                    {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center">
                            <span className="text-[40px] mb-3 opacity-50">💬</span>
                            <p className="text-sm m-0">No messages yet. Send a message to start chatting!</p>
                        </div>
                    ) : (
                        messages.map((msg) => {
                            if (msg.senderId === 'system') {
                                return (
                                    <div key={msg.id} className="self-center bg-slate-100 border border-slate-200 px-3.5 py-1.5 rounded-full max-w-[90%] text-center">
                                        <span className="text-xs text-slate-500 font-medium">{msg.text}</span>
                                    </div>
                                );
                            }

                            const isLocal = isLocalSender(msg.senderId);
                            return (
                                <div
                                    key={msg.id}
                                    className={`flex flex-col max-w-[85%] ${isLocal ? 'self-end items-end' : 'self-start items-start'}`}
                                >
                                    <div className="text-xs font-medium text-slate-600 mb-1.5">
                                        {msg.senderName} <span className="text-[10px] text-slate-400 ml-1.5">{msg.timestamp}</span>
                                    </div>
                                    <div
                                        className={`px-4 py-3 rounded-2xl text-sm leading-relaxed break-words ${
                                            isLocal
                                                ? 'bg-gradient-to-br from-[#00C6FF] via-blue-500 to-purple-500 text-white rounded-br-sm'
                                                : 'bg-slate-100 text-slate-900 rounded-bl-sm'
                                        }`}
                                    >
                                        {msg.text}
                                    </div>
                                </div>
                            );
                        })
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Chat Send Input Box */}
                <form onSubmit={handleSend} className="px-6 pt-4 pb-6 border-t border-slate-200 flex gap-3 bg-white">
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 bg-slate-100 border border-slate-200 focus:border-blue-500 focus:bg-white rounded-full px-5 py-3 text-slate-900 text-sm outline-none transition-all placeholder:text-slate-400"
                        maxLength={200}
                    />
                    <button
                        type="submit"
                        className="bg-gradient-to-br from-[#00C6FF] via-blue-500 to-purple-500 disabled:bg-none disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed border-none text-white px-5 h-11 rounded-full text-sm font-semibold flex items-center justify-center cursor-pointer transition-transform hover:enabled:scale-105"
                        disabled={!text.trim()}
                    >
                        Send
                    </button>
                </form>
            </div>
        </>
    );
}
