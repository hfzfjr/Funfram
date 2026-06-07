'use client';

import { useState, useEffect, useRef } from 'react';
import Navbar from '@/components/layout/navbar';
import Navigation from '@/components/layout/Navigation';
import AuthOverlay from '@/components/auth/auth';
import CallLayout from '@/components/frame/CallLayout';
import { useCallStore } from '@/store/useCallStore';
import styles from './page.module.css';

export default function FunVideoPage() {
    const [username, setUsername] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isMicOn, setIsMicOn] = useState(true);
    const [isCamOn, setIsCamOn] = useState(true);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const videoTrackRef = useRef<MediaStreamTrack | null>(null);
    const audioTrackRef = useRef<MediaStreamTrack | null>(null);
    const setPhase = useCallStore((state) => state.setPhase);
    const reset = useCallStore((state) => state.reset);

    useEffect(() => {
        const startCamera = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                setLocalStream(stream);
                const videoTrack = stream.getVideoTracks()[0];
                const audioTrack = stream.getAudioTracks()[0];
                videoTrackRef.current = videoTrack;
                audioTrackRef.current = audioTrack;
            } catch (error) {
                console.error('Error accessing camera:', error);
            }
        };

        startCamera();

        return () => {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const handleAuthConfirm = (confirmedUsername: string) => {
        setUsername(confirmedUsername);
        setIsAuthenticated(true);
    };

    const handleNext = () => {
        setPhase('matching');
        // TODO: Implement actual matchmaking via WebSocket
        setTimeout(() => {
            setPhase('connected');
        }, 2000);
    };

    const handleLeave = () => {
        reset();
    };

    const handleMic = async () => {
        if (audioTrackRef.current) {
            if (isMicOn) {
                audioTrackRef.current.stop();
            } else {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    const audioTrack = stream.getAudioTracks()[0];
                    audioTrackRef.current = audioTrack;
                    if (localStream) {
                        localStream.addTrack(audioTrack);
                    }
                } catch (error) {
                    console.error('Error restarting microphone:', error);
                }
            }
            setIsMicOn(!isMicOn);
        }
    };

    const handleCam = async () => {
        if (isCamOn) {
            // Stop the video track to turn off camera light
            if (videoTrackRef.current) {
                videoTrackRef.current.stop();
            }
            setIsCamOn(false);
        } else {
            // Restart camera
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                const videoTrack = stream.getVideoTracks()[0];
                const audioTrack = stream.getAudioTracks()[0];
                videoTrackRef.current = videoTrack;
                audioTrackRef.current = audioTrack;
                setLocalStream(stream);
                setIsCamOn(true);
            } catch (error) {
                console.error('Error restarting camera:', error);
            }
        }
    };

    const handleChat = () => {
        console.log('Chat clicked');
    };

    return (
        <>
            <AuthOverlay onConfirm={handleAuthConfirm} />

            <div className={styles.container}>
                <Navbar />

                <div className={styles.content}>
                    <CallLayout localUserName={username} localStream={localStream} isCamOn={isCamOn} />
                </div>

                <Navigation
                    onNext={handleNext}
                    onLeave={handleLeave}
                    onMic={handleMic}
                    onCam={handleCam}
                    onChat={handleChat}
                    isMicOn={isMicOn}
                    isCamOn={isCamOn}
                />
            </div>
        </>
    );
}