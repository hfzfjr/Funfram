'use client';

import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import NextFrameButton from '../ui/button/NextFrameButton';
import LeaveFrameButton from '../ui/button/LeaveFrameButton';
import MicrophoneButton from '../ui/button/MicrophoneButton';
import CameraButton from '../ui/button/CameraButton';
import ChatButton from '../ui/button/ChatButton';
import GameButton from '../ui/button/GameButton';
import SidebarChat from './SidebarChat';
import GameInviteModal from '../ui/overlay/GameInviteModal';
import './navigation.css';

interface NavigationProps {
  onLeave?: () => void;
  onMic?: () => void;
  onCam?: () => void;
  isMicOn?: boolean;
  isCamOn?: boolean;
}

export default function Navigation({
  onLeave,
  onMic,
  onCam,
  isMicOn = true,
  isCamOn = true
}: NavigationProps) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [showGameModal, setShowGameModal] = useState(false);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

  const fsmState = useCallStore((state) => state.fsmState);
  const localUser = useCallStore((state) => state.localUser);
  const messageCount = useCallStore((state) => state.generalChat.length);
  const previousMessageCountRef = useRef(messageCount);
  const isOwner = localUser?.isOwner ?? false;

  useEffect(() => {
    if (messageCount > previousMessageCountRef.current && !showSidebar) {
      setHasUnreadChat(true);
    }
    previousMessageCountRef.current = messageCount;
  }, [messageCount, showSidebar]);

  const handleNextClick = () => {
    if (!isOwner) return;
    useCallStore.getState().triggerNextFrame();
  };

  const handleChatClick = () => {
    setHasUnreadChat(false);
    setShowSidebar(true);
  };

  const handleSidebarClose = () => {
    setShowSidebar(false);
  };

  // Determine label for the start/next button
  let nextButtonText = "Next Frame";
  // Owner‑only controls – button disabled when not owner or during searching
  const nextButtonDisabled = !isOwner; // Owner can always click


  // Adjust button label based on FSM state to match original UI expectations
  if (fsmState === 'MATCHED') {
    nextButtonText = "Next Frame";
  } else if (fsmState === 'FRAME') {
    nextButtonText = "Start Frame";
  } else if (fsmState === 'SEARCHING') {
    nextButtonText = "Searching...";
  }


  // Determine game button visibility and disabled status
  const showGameButton = fsmState === 'MATCHED';
  const gameButtonDisabled = !isOwner;

  return (
    <>
      <div className="navigation-overlay">
        <div className="navigation-content">
          {/* Start/Next Frame Button - Owner Only Control */}
          {isOwner && (fsmState === 'FRAME' || fsmState === 'SEARCHING' || fsmState === 'MATCHED') && (
            <NextFrameButton
              onClick={handleNextClick}
              disabled={nextButtonDisabled}
              text={nextButtonText}
            />
          )}

          {/* Game Trigger Button - Matched state, Owner Only Control */}
          {isOwner && showGameButton && (
            <GameButton
              onClick={() => setShowGameModal(true)}
              disabled={gameButtonDisabled}
            />
          )}

          <LeaveFrameButton onClick={onLeave} />

          <div className="separator"></div>

          <MicrophoneButton onClick={onMic} isOn={isMicOn} />
          <CameraButton onClick={onCam} isOn={isCamOn} />

          <div className="separator"></div>

          <ChatButton onClick={handleChatClick} hasUnread={hasUnreadChat} />
        </div>
      </div>

      {showSidebar && <SidebarChat onClose={handleSidebarClose} />}

      {showGameModal && (
        <GameInviteModal onClose={() => setShowGameModal(false)} />
      )}
    </>
  );
}
