'use client';
import { useRef, useState, useEffect } from 'react';
import VideoFrame from './VideoFrame';
import Controls from './Controls';
import GameBoard from './GameBoard';

interface LobbyState {
  lobbyId: string;
  inviteCode: string;
  isOwner: boolean;
}

export default function MainApp() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [statusText, setStatusText] = useState("Klik 'Next Frame' untuk mulai");
  const [showGame, setShowGame] = useState(false);
  
  const [gameSocket, setGameSocket] = useState<WebSocket | null>(null);
  const [webrtcSocket, setWebrtcSocket] = useState<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [username, setUsername] = useState('');
  const [showLobbyUI, setShowLobbyUI] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) { console.error("Gagal kamera:", err); }
    }
    startCamera();
  }, []);

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_GAME_URL || 'ws://localhost:5001/socket');
    
    ws.onopen = () => {
      console.log('Connected to game WebSocket');
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        console.log('Game WebSocket message:', data);

        switch (data.type) {
          case 'LOBBY_CREATED':
            setLobby({ lobbyId: data.lobbyId, inviteCode: data.inviteCode, isOwner: true });
            setShowLobbyUI(false);
            break;
          case 'LOBBY_JOINED':
            setLobby({ lobbyId: data.lobbyId, inviteCode: '', isOwner: false });
            setShowLobbyUI(false);
            break;
          case 'MATCHED':
            setStatusText("Terhubung! Memulai video chat...");
            startWebRTC(data.matchID);
            setShowGame(true);
            break;
          case 'SEARCHING':
            setIsSearching(true);
            setStatusText("Mencari lawan bicara...");
            break;
          case 'ERROR':
            console.error('Game error:', data.error);
            setStatusText(`Error: ${data.error}`);
            break;
        }
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    };

    setGameSocket(ws);
    return () => ws.close();
  }, []);

  const startWebRTC = (roomID: string) => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_WEBRTC_URL || 'ws://localhost:5002');
    setWebrtcSocket(ws);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', roomID }));
    };

    ws.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      console.log('WebRTC message:', data.type);

      switch (data.type) {
        case 'ice-servers':
          const pc = new RTCPeerConnection({ iceServers: data.iceServers });
          pcRef.current = pc;
          localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
          
          pc.onicecandidate = (e) => {
            if (e.candidate) {
              ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }));
            }
          };

          pc.ontrack = (e) => {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = e.streams[0];
              setStatusText("");
            }
          };

          // Create offer as caller
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(JSON.stringify({ type: 'offer', offer }));
          break;

        case 'offer':
          await pcRef.current?.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pcRef.current!.createAnswer();
          await pcRef.current!.setLocalDescription(answer);
          ws.send(JSON.stringify({ type: 'answer', answer }));
          break;

        case 'answer':
          await pcRef.current?.setRemoteDescription(new RTCSessionDescription(data.answer));
          break;

        case 'ice-candidate':
          await pcRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate));
          break;

        case 'user-left':
          setStatusText("Lawan bicara telah keluar");
          break;
      }
    };
  };

  const handleLeave = () => {
    pcRef.current?.close();
    webrtcSocket?.close();
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setStatusText("Keluar. Klik 'Next Frame' untuk mencari teman baru.");
    setShowGame(false);
    setIsSearching(false);
    setLobby(null);
    setShowLobbyUI(true);
  };

  const handleCreateLobby = () => {
    if (!username.trim()) {
      alert('Masukkan username terlebih dahulu');
      return;
    }
    gameSocket?.send(JSON.stringify({
      type: 'CREATE_LOBBY',
      username,
    }));
  };

  const handleJoinByCode = (code: string) => {
    if (!username.trim()) {
      alert('Masukkan username terlebih dahulu');
      return;
    }
    gameSocket?.send(JSON.stringify({
      type: 'JOIN_LOBBY',
      inviteCode: code,
      username,
    }));
  };

  const handleStartMatchmaking = () => {
    if (!lobby) return;
    gameSocket?.send(JSON.stringify({
      type: 'START_MATCHMAKING',
    }));
  };

  const handleNext = () => {
    if (lobby) {
      handleStartMatchmaking();
    } else {
      handleCreateLobby();
    }
  };

  // Lobby UI
  if (showLobbyUI) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center p-4">
        <div className="bg-zinc-900 rounded-2xl p-8 max-w-md w-full border border-zinc-800 shadow-2xl">
          <h1 className="text-3xl font-bold text-white mb-6 text-center">Funfram</h1>
          
          <div className="space-y-4">
            <div>
              <label className="block text-zinc-400 mb-2 text-sm">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username"
                className="w-full bg-zinc-800 text-white px-4 py-3 rounded-xl border border-zinc-700 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <button
              onClick={handleCreateLobby}
              className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-xl transition-all active:scale-95"
            >
              Buat Lobby Baru
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-zinc-700"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-zinc-900 text-zinc-400">atau</span>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Kode undangan"
                className="flex-1 bg-zinc-800 text-white px-4 py-3 rounded-xl border border-zinc-700 focus:border-sky-500 focus:outline-none uppercase"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleJoinByCode((e.target as HTMLInputElement).value);
                  }
                }}
              />
              <button
                onClick={() => {
                  const input = document.querySelector('input[placeholder="Kode undangan"]') as HTMLInputElement;
                  handleJoinByCode(input.value);
                }}
                className="bg-zinc-700 hover:bg-zinc-600 text-white font-bold px-6 py-3 rounded-xl transition-all"
              >
                Gabung
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Lobby waiting room
  if (lobby && !showGame) {
    return (
      <div className="w-screen h-screen bg-black flex items-center justify-center p-4">
        <div className="bg-zinc-900 rounded-2xl p-8 max-w-md w-full border border-zinc-800 shadow-2xl text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Lobby Siap!</h2>
          {lobby.isOwner && (
            <p className="text-zinc-400 mb-4">Bagikan kode ini ke teman:</p>
          )}
          {lobby.inviteCode && (
            <div className="bg-zinc-800 text-sky-400 text-3xl font-mono font-bold py-4 rounded-xl mb-6 tracking-wider">
              {lobby.inviteCode}
            </div>
          )}
          <p className="text-zinc-400 mb-6">Menunggu anggota lain...</p>
          <button
            onClick={handleStartMatchmaking}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-xl transition-all active:scale-95"
          >
            Mulai Pencarian Lawan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-black flex flex-col p-4 gap-4">
      <div className="flex-1 flex flex-col md:flex-row gap-4 pb-28">
        <VideoFrame videoRef={localVideoRef} label="Kamu" isCameraOn={isCamOn} />
        <VideoFrame videoRef={remoteVideoRef} label="Lawan Bicara" statusText={statusText} />
      </div>
      {showGame && <GameBoard gameSocket={gameSocket} />}
      <Controls 
        onNext={handleNext} 
        onLeave={handleLeave} 
        onMic={() => { localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = !isMicOn); setIsMicOn(!isMicOn); }} 
        onCam={() => { localStreamRef.current?.getVideoTracks().forEach(t => t.enabled = !isCamOn); setIsCamOn(!isCamOn); }} 
        isMicOn={isMicOn} isCamOn={isCamOn} 
      />
    </div>
  );
}