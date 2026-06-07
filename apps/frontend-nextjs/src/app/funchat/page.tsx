'use client';

import { useState } from 'react';
import Navbar from '@/components/layout/navbar';
import NextFrameButton from '@/components/ui/button/NextFrameButton';
import LeaveFrameButton from '@/components/ui/button/LeaveFrameButton';
import styles from './page.module.css';

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

    const handleNextFrame = () => {
        console.log('Next Frame clicked');
    };

    const handleLeaveFrame = () => {
        console.log('Leave Frame clicked');
    };

    return (
        <div className={styles.container}>
            <Navbar />

            <div className={styles.chatContainer}>
                <div className={styles.header}>
                    <h1 className={styles.title}>FunChat</h1>
                    <div className={styles.actions}>
                        <NextFrameButton onClick={handleNextFrame} />
                        <LeaveFrameButton onClick={handleLeaveFrame} />
                    </div>
                </div>

                <div className={styles.messagesContainer}>
                    <div className={styles.messages}>
                        {messages.map((message) => (
                            <div
                                key={message.id}
                                className={`${styles.message} ${styles[message.sender]}`}
                            >
                                <div className={styles.messageContent}>{message.text}</div>
                                <div className={styles.messageTime}>
                                    {message.timestamp.toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={styles.inputContainer}>
                    <textarea
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ketik pesan..."
                        className={styles.input}
                        rows={1}
                    />
                    <button
                        onClick={handleSendMessage}
                        className={styles.sendButton}
                        disabled={!inputText.trim()}
                    >
                        Kirim
                    </button>
                </div>
            </div>
        </div>
    );
}
