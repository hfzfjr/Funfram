"use client";

import React, { useEffect, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import './CustomAlert.css';

export default function CustomAlertModal() {
    const { customAlert, hideCustomAlert } = useCallStore();
    const [render, setRender] = useState(false);

    useEffect(() => {
        if (customAlert?.visible) {
            setRender(true);
        } else {
            const timeout = setTimeout(() => setRender(false), 200);
            return () => clearTimeout(timeout);
        }
    }, [customAlert?.visible]);

    if (!render) return null;

    const type = customAlert?.type || 'info';

    return (
        <div className={`custom-alert-overlay ${customAlert?.visible ? 'fade-in' : 'fade-out'}`}>
            <div className={`custom-alert-modal ${customAlert?.visible ? 'slide-in' : 'slide-out'}`}>
                <div className={`custom-alert-icon ${type}`}>
                    {type === 'error' && (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="15" y1="9" x2="9" y2="15"></line>
                            <line x1="9" y1="9" x2="15" y2="15"></line>
                        </svg>
                    )}
                    {type === 'success' && (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    )}
                    {type === 'info' && (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                    )}
                </div>
                <h3 className="custom-alert-title">Notifikasi</h3>
                <p className="custom-alert-message">{customAlert?.message}</p>
                <button className="custom-alert-btn" onClick={hideCustomAlert}>
                    Mengerti
                </button>
            </div>
        </div>
    );
}
