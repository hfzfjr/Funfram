'use client';

import { useState } from 'react';
import Navbar from '@/components/layout/navbar';
import NextFrameButton from '@/components/ui/button/NextFrameButton';
import LeaveFrameButton from '@/components/ui/button/LeaveFrameButton';

interface Message {
    id: string;
    text: string;
    sender: 'me' | 'other';
    timestamp: Date;
}

export default function FunChatPage() {
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            text: 'Halo! Selamat datang di FunChat',
            sender: 'other',
            timestamp: new Date(),
        },
    ]);
    const [inputText, setInputText] = useState('');

    const handleSendMessage = () => {
        if (inputText.trim()) {
            const newMessage: Message = {
                id: Date.now().toString(),
                text: inputText,
                sender: 'me',
                timestamp: new Date(),
            };
            setMessages([...messages, newMessage]);
            setInputText('');
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    return (
        <div className="w-screen h-screen bg-black flex flex-col">
            <Navbar />

            <div className="flex-1 flex flex-col px-6 pt-20 pb-6 gap-4">
                <div className="flex items-center justify-between p-4 bg-white border border-neutral-800 rounded-xl">
                    <h1 className="text-2xl font-semibold text-slate-900 m-0">FunChat</h1>
                    <div className="flex gap-3">
                        <NextFrameButton onClick={() => console.log('Next Frame clicked')} />
                        <LeaveFrameButton onClick={() => console.log('Leave Frame clicked')} />
                    </div>
                </div>

                <div className="flex-1 overflow-hidden bg-white border border-neutral-800 rounded-xl">
                    <div className="h-full overflow-y-auto p-4 flex flex-col gap-3">
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={`max-w-[70%] flex flex-col gap-1 ${
                                    message.sender === 'me' ? 'self-end' : 'self-start'
                                }`}
                            >
                                <div
                                    className={`px-4 py-3 rounded-xl text-sm leading-relaxed text-slate-900 ${
                                        message.sender === 'me'
                                            ? 'bg-blue-500 rounded-br-sm'
                                            : 'bg-slate-50 rounded-bl-sm'
                                    }`}
                                >
                                    {message.text}
                                </div>
                                <div
                                    className={`text-[11px] text-zinc-400 px-1 ${
                                        message.sender === 'me' ? 'text-right' : 'text-left'
                                    }`}
                                >
                                    {message.timestamp.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex gap-3 p-4 bg-white border border-neutral-800 rounded-xl">
                    <textarea
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ketik pesan..."
                        className="flex-1 bg-slate-50 border border-neutral-700 focus:border-blue-500 rounded-lg px-4 py-3 text-slate-900 text-sm resize-none outline-none placeholder:text-zinc-400"
                        rows={1}
                    />
                    <button
                        onClick={handleSendMessage}
                        className="bg-blue-500 hover:enabled:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 border-none px-6 py-3 rounded-lg text-sm font-medium cursor-pointer transition-colors"
                        disabled={!inputText.trim()}
                    >
                        Kirim
                    </button>
                </div>
            </div>
        </div>
    );
}
