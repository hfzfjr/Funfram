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
      <div className="fixed bottom-3 md:bottom-6 left-1/2 -translate-x-1/2 z-[1000] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.05)] rounded-[34px] md:rounded-full px-4 py-2 md:px-6 md:py-3 h-[68px] md:h-auto border border-black/10 flex items-center box-border">
        <div className="flex items-center gap-3">
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

          <div className="w-px h-8 bg-black/10 rounded-sm mx-1"></div>

          <MicrophoneButton onClick={onMic} isOn={isMicOn} />

          <div className="w-px h-8 bg-black/10 rounded-sm mx-1"></div>

          <ChatButton onClick={handleChatClick} hasUnread={hasUnreadChat} />

          {isOwner && fsmState === 'FRAME' && (
            <>
              <div className="w-px h-8 bg-black/10 rounded-sm mx-1"></div>
              <InviteFriendsButton onClick={() => setShowInviteOverlay(true)} />
            </>
          )}
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
