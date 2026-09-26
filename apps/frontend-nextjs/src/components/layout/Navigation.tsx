'use client';

import { useEffect, useRef, useState } from 'react';
import { useCallStore } from '@/store/useCallStore';
import NextFrameButton from '../ui/button/NextFrameButton';
import LeaveFrameButton from '../ui/button/LeaveFrameButton';
import MicrophoneButton from '../ui/button/MicrophoneButton';
import ChatButton from '../ui/button/ChatButton';
import GameButton from '../ui/button/GameButton';
import SidebarChat from './SidebarChat';
import GameInviteModal from '../ui/overlay/GameInviteModal';
import ReturnToLobbyButton from '../ui/button/ReturnToLobbyButton';
import InviteFriendsButton from '../ui/button/InviteFriendsButton';
import InviteFriendsOverlay from '../ui/overlay/InviteFriendsOverlay';
import '../ui/overlay/InviteFriendsOverlay.css';
import './navigation.css';

interface NavigationProps {
  onLeave?: () => void;
  onReturnToLobby?: () => void;
  onMic?: () => void;
  onCam?: () => void;
  isMicOn?: boolean;
  isCamOn?: boolean;
}

export default function Navigation({
  onLeave,
  onReturnToLobby,
  onMic,
  onCam,
  isMicOn = true,
  isCamOn = true
}: NavigationProps) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [showGameModal, setShowGameModal] = useState(false);
  const [showInviteOverlay, setShowInviteOverlay] = useState(false);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

  const fsmState = useCallStore((state) => state.fsmState);
  const localUser = useCallStore((state) => state.localUser);
  const leftParticipants = useCallStore((state) => state.leftParticipants);
  const messageCount = useCallStore((state) => state.generalChat.length);
  const previousMessageCountRef = useRef(messageCount);
  const isOwner = localUser?.isOwner ?? false;
  const isTeam = leftParticipants.length > 1;

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
          {/* Left Side elements: Live badge */}
          <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(34, 197, 94, 0.1)', padding: '6px 12px', borderRadius: '20px', gap: '8px', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
            <div style={{ width: '8px', height: '8px', background: '#22c55e', borderRadius: '50%', boxShadow: '0 0 8px #22c55e' }}></div>
            <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>Live</span>
          </div>

          <div className="separator"></div>

          {/* Start/Next Frame Button - Always available for owner in FRAME, SEARCHING, MATCHED */}
          {isOwner && (fsmState === 'FRAME' || fsmState === 'SEARCHING' || fsmState === 'MATCHED') && (
            <NextFrameButton
              onClick={handleNextClick}
              disabled={nextButtonDisabled}
              text={nextButtonText}
            />
          )}

          {/* Return to Lobby Button - Only when with invited friends (team) during SEARCHING or MATCHED */}
          {isOwner && isTeam && (fsmState === 'SEARCHING' || fsmState === 'MATCHED') && (
            <ReturnToLobbyButton
              onClick={onReturnToLobby}
              disabled={nextButtonDisabled}
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

          <div className="separator"></div>

          <ChatButton onClick={handleChatClick} hasUnread={hasUnreadChat} />

          <div className="separator"></div>
          
          <InviteFriendsButton
            onClick={() => {
                if (fsmState === 'FRAME') {
                    setShowInviteOverlay(true);
                } else {
                    useCallStore.getState().showCustomAlert('Kamu sedang mencari/berada di dalam match. Kembali ke lobby (tekan tombol Lobby) terlebih dahulu untuk mengundang teman.', 'error');
                }
            }}
          />
        </div>
      </div>

      {showSidebar && <SidebarChat onClose={handleSidebarClose} />}

      {showGameModal && (
        <GameInviteModal onClose={() => setShowGameModal(false)} />
      )}
      
      {showInviteOverlay && (
        <InviteFriendsOverlay onClose={() => setShowInviteOverlay(false)} />
      )}
    </>
  );
}
