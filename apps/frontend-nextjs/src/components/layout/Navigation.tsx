'use client';

import { useState } from 'react';
import NextFrameButton from '../ui/button/NextFrameButton';
import LeaveFrameButton from '../ui/button/LeaveFrameButton';
import MicrophoneButton from '../ui/button/MicrophoneButton';
import CameraButton from '../ui/button/CameraButton';
import ChatButton from '../ui/button/ChatButton';
import SidebarChat from './SidebarChat';
import './navigation.css';

interface NavigationProps {
  onNext?: () => void;
  onLeave?: () => void;
  onMic?: () => void;
  onCam?: () => void;
  onChat?: () => void;
  isMicOn?: boolean;
  isCamOn?: boolean;
}

export default function Navigation({
  onNext,
  onLeave,
  onMic,
  onCam,
  onChat,
  isMicOn = true,
  isCamOn = true
}: NavigationProps) {
  const [showSidebar, setShowSidebar] = useState(false);

  const handleChatClick = () => {
    setShowSidebar(true);
    onChat?.();
  };

  const handleSidebarClose = () => {
    setShowSidebar(false);
  };

  return (
    <>
      <div className="navigation-overlay">
        <div className="navigation-content">
          <NextFrameButton onClick={onNext} />
          <LeaveFrameButton onClick={onLeave} />

          <div className="separator"></div>

          <MicrophoneButton onClick={onMic} isOn={isMicOn} />
          <CameraButton onClick={onCam} isOn={isCamOn} />

          <div className="separator"></div>

          <ChatButton onClick={handleChatClick} />
        </div>
      </div>

      {showSidebar && <SidebarChat onClose={handleSidebarClose} />}
    </>
  );
}
