'use client';

import { useState } from 'react';
import './SidebarChat.css';

interface Contact {
    id: string;
    name: string;
    avatar: string;
    lastMessage: string;
    timestamp: string;
    unread: number;
    online: boolean;
}

interface SidebarChatProps {
    onClose?: () => void;
    onSelectContact?: (contact: Contact) => void;
}

export default function SidebarChat({ onClose, onSelectContact }: SidebarChatProps) {
    const [contacts] = useState<Contact[]>([
        {
            id: '1',
            name: 'Sarah Johnson',
            avatar: '/avatar1.png',
            lastMessage: 'Hey! How are you doing?',
            timestamp: '2m ago',
            unread: 2,
            online: true,
        },
        {
            id: '2',
            name: 'Mike Chen',
            avatar: '/avatar2.png',
            lastMessage: 'Let\'s video chat later',
            timestamp: '15m ago',
            unread: 0,
            online: true,
        },
        {
            id: '3',
            name: 'Emma Wilson',
            avatar: '/avatar3.png',
            lastMessage: 'Thanks for the help!',
            timestamp: '1h ago',
            unread: 0,
            online: false,
        },
        {
            id: '4',
            name: 'David Brown',
            avatar: '/avatar4.png',
            lastMessage: 'See you tomorrow!',
            timestamp: '3h ago',
            unread: 1,
            online: false,
        },
    ]);

    const [selectedContact, setSelectedContact] = useState<string | null>(null);

    const handleContactClick = (contact: Contact) => {
        setSelectedContact(contact.id);
        onSelectContact?.(contact);
    };

    return (
        <div className="sidebar-chat">
            <div className="sidebar-header">
                <h2 className="sidebar-title">Messages</h2>
                <button onClick={onClose} className="close-button">
                    ✕
                </button>
            </div>

            <div className="sidebar-search">
                <input
                    type="text"
                    placeholder="Search conversations..."
                    className="search-input"
                />
            </div>

            <div className="sidebar-contacts">
                {contacts.map((contact) => (
                    <div
                        key={contact.id}
                        className={`contact-item ${selectedContact === contact.id ? 'active' : ''}`}
                        onClick={() => handleContactClick(contact)}
                    >
                        <div className="contact-avatar">
                            <div className="avatar-placeholder">
                                {contact.name.charAt(0)}
                            </div>
                            {contact.online && <div className="online-indicator"></div>}
                        </div>

                        <div className="contact-info">
                            <div className="contact-header">
                                <span className="contact-name">{contact.name}</span>
                                <span className="contact-time">{contact.timestamp}</span>
                            </div>
                            <div className="contact-message">
                                <span className="message-text">{contact.lastMessage}</span>
                                {contact.unread > 0 && (
                                    <span className="unread-badge">{contact.unread}</span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
