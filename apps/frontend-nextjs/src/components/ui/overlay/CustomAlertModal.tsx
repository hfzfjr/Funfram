"use client";

import React, { useEffect, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';

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
    const iconBg =
        type === 'error'
            ? 'bg-red-500/10 text-red-500'
            : type === 'success'
            ? 'bg-green-500/10 text-green-500'
            : 'bg-sky-500/10 text-sky-500';

    return (
        <div
            className={`fixed inset-0 bg-black/80 flex justify-center items-center z-[9999] ${
                customAlert?.visible ? 'animate-[fadeIn_0.2s_forwards]' : 'animate-[fadeOut_0.2s_forwards]'
            }`}
        >
            <div
                className={`bg-white border border-slate-200 rounded-2xl p-8 w-[90%] max-w-[400px] text-center text-slate-900 ${
                    customAlert?.visible ? 'animate-[slideIn_0.2s_ease-out_forwards]' : 'animate-[slideOut_0.2s_ease-in_forwards]'
                }`}
            >
                <div className={`flex justify-center items-center w-16 h-16 rounded-full mx-auto mb-6 ${iconBg}`}>
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
                <h3 className="text-2xl font-bold m-0 mb-4 text-slate-900">Notifikasi</h3>
                <p className="text-base text-slate-500 m-0 mb-8 leading-relaxed">{customAlert?.message}</p>
                <button
                    className="bg-sky-500 hover:bg-sky-600 text-white border-none p-3 rounded-xl text-base font-bold cursor-pointer w-full transition-all duration-200 active:scale-95"
                    onClick={hideCustomAlert}
                >
                    Mengerti
                </button>
            </div>
        </div>
    );
}
