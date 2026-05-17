import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useModeratorVoice } from "@/hooks/useModeratorVoice";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import { 
  Mic, 
  MicOff, 
  Hand,
  SkipForward,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Volume2,
  Play,
  Pause,
  Loader2
} from "lucide-react";

const SPEAKING_ORDER = [
  { role: "prime_minister", team: "government", label: "Prime Minister", time: 420 },
  { role: "leader_of_opposition", team: "opposition", label: "Leader of Opposition", time: 420 },
  { role: "deputy_prime_minister", team: "government", label: "Deputy Prime Minister", time: 420 },
  { role: "deputy_leader_of_opposition", team: "opposition", label: "Deputy Leader of Opposition", time: 420 },
  { role: "government_whip", team: "government", label: "Government Whip", time: 420 },
  { role: "opposition_whip", team: "opposition", label: "Opposition Whip", time: 420 },
  { role: "opposition_reply", team: "opposition", label: "Opposition Reply", time: 240 },
  { role: "government_reply", team: "government", label: "Government Reply", time: 240 },
];

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function Debate() {
  const params = useParams<{ code: string }>();
  const roomCode = params.code?.toUpperCase() || "";
  
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  
  // Timer state
  const [timeRemaining, setTimeRemaining] = useState(420);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [currentSpeechId, setCurrentSpeechId] = useState<number | null>(null);
  
  // Audio state
  const [isMicActive, setIsMicActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Transcript state
  const [liveTranscript, setLiveTranscript] = useState<Array<{speaker: string, text: string, timestamp: number}>>([]);
  
  // AI Moderator voice (ElevenLabs with browser TTS fallback).
  const { speak: speakAnnouncement, isSpeaking } = useModeratorVoice();
  
  const utils = trpc.useUtils();

  const { data: roomData, isLoading } = trpc.room.get.useQuery(
    { roomCode },
    { 
      enabled: !!roomCode,
      refetchInterval: 5000,
    }
  );

  const createSpeech = trpc.speech.create.useMutation();
  const endSpeech = trpc.speech.end.useMutation();
  const transcribeSpeech = trpc.speech.transcribe.useMutation();
  const advanceSpeaker = trpc.room.advanceSpeaker.useMutation({
    onSuccess: (data) => {
      if (data.completed) {
        speakAnnouncement("The debate has concluded. Thank you all for participating. Generating feedback now.");
        setTimeout(() => {
          navigate(`/review/${roomCode}`);
        }, 3000);
      } else {
        utils.room.get.invalidate({ roomCode });
      }
    },
  });

  const offerPOI = trpc.poi.offer.useMutation({
    onSuccess: () => {
      toast.success("POI offered!");
      speakAnnouncement("Point of information!");
    },
  });

  const currentSpeakerIndex = roomData?.room.currentSpeakerIndex || 0;
  const currentSpeaker = SPEAKING_ORDER[currentSpeakerIndex];
  
  // Build active speaking order based on who joined
  const participantRoles = new Set(roomData?.participants.map(p => p.speakerRole) || []);
  const activeSpeakingOrder = SPEAKING_ORDER.filter(speaker => {
    if (speaker.role === "opposition_reply") {
      return participantRoles.has("leader_of_opposition");
    }
    if (speaker.role === "government_reply") {
      return participantRoles.has("prime_minister");
    }
    return participantRoles.has(speaker.role as any);
  });
  
  const currentParticipant = roomData?.participants.find(
    p => p.speakerRole === currentSpeaker?.role || 
         (currentSpeaker?.role === "opposition_reply" && p.speakerRole === "leader_of_opposition") ||
         (currentSpeaker?.role === "government_reply" && p.speakerRole === "prime_minister")
  );
  
  const myParticipant = roomData?.participants.find(p => p.userId === user?.id);
  const isMyTurn = currentParticipant?.userId === user?.id;
  const canOfferPOI = myParticipant && 
    myParticipant.team !== currentSpeaker?.team &&
    timeRemaining < (currentSpeaker?.time || 420) - 60 &&
    timeRemaining > 60;

  // speakAnnouncement is now provided by useModeratorVoice() above.

  // Timer effect - runs independently when started
  useEffect(() => {
    if (isTimerRunning && timeRemaining > 0) {
      timerIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          const newTime = prev - 1;
          
          // Time warnings
          if (newTime === 60) {
            speakAnnouncement("One minute remaining.");
          } else if (newTime === 30) {
            speakAnnouncement("Thirty seconds remaining.");
          } else if (newTime === 10) {
            speakAnnouncement("Ten seconds.");
          } else if (newTime === 0) {
            speakAnnouncement("Time is up. Please conclude your speech.");
            setIsTimerRunning(false);
          }
          
          return newTime;
        });
      }, 1000);
      
      return () => {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      };
    }
  }, [isTimerRunning, speakAnnouncement]);

  // Reset timer when speaker changes
  useEffect(() => {
    if (currentSpeaker) {
      setTimeRemaining(currentSpeaker.time);
      setIsTimerRunning(false);
      setLiveTranscript([]);
      
      // Announce new speaker
      if (roomData?.room.status === "in_progress") {
        const speakerName = currentParticipant?.user?.name || "the next speaker";
        speakAnnouncement(`${currentSpeaker.label}, ${speakerName}, you have ${Math.floor(currentSpeaker.time / 60)} minutes. Please begin when ready.`);
      }
    }
  }, [currentSpeakerIndex, currentSpeaker?.role]);

  // Redirect if room not in progress
  useEffect(() => {
    if (roomData?.room.status === "waiting") {
      navigate(`/room/${roomCode}`);
    }
    if (roomData?.room.status === "completed") {
      navigate(`/review/${roomCode}`);
    }
  }, [roomData?.room.status, roomCode, navigate]);

  // Cleanup on unmount (voice cleanup is handled by useModeratorVoice).
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Process audio and transcribe
  const processAudioChunk = useCallback(async () => {
    if (audioChunksRef.current.length === 0 || !currentSpeechId) return;
    
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    audioChunksRef.current = [];
    
    // Only process if blob is large enough (has actual audio)
    if (audioBlob.size < 1000) return;
    
    setIsTranscribing(true);
    
    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await base64Promise;
      
      // Send to backend for transcription
      const result = await transcribeSpeech.mutateAsync({
        speechId: currentSpeechId,
        audioData: base64Audio,
        timestamp: (currentSpeaker?.time || 420) - timeRemaining,
      });
      
      if (result.transcript && result.transcript.trim()) {
        setLiveTranscript(prev => [...prev, {
          speaker: currentSpeaker?.label || "Speaker",
          text: result.transcript,
          timestamp: (currentSpeaker?.time || 420) - timeRemaining,
        }]);
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsTranscribing(false);
    }
  }, [currentSpeechId, currentSpeaker, timeRemaining, transcribeSpeech]);

  const startSpeech = useCallback(async () => {
    if (!roomData?.room.id || !currentSpeaker) return;
    
    try {
      // Create speech record
      const result = await createSpeech.mutateAsync({
        roomId: roomData.room.id,
        speakerRole: currentSpeaker.role,
        speechType: currentSpeaker.role.includes("reply") ? "reply" : "substantive",
      });
      setCurrentSpeechId(result.speechId);
      
      // Start timer
      setIsTimerRunning(true);
      
      // Start microphone recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000,
          } 
        });
        streamRef.current = stream;
        
        const mediaRecorder = new MediaRecorder(stream, {
          mimeType: 'audio/webm;codecs=opus'
        });
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];
        
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            audioChunksRef.current.push(event.data);
            // Process the chunk immediately when data is available
            processAudioChunk();
          }
        };
        
        // Process audio every 5 seconds for transcription
        mediaRecorder.start(5000);
        setIsRecording(true);
        setIsMicActive(true);
        
        toast.success("Recording started");
        speakAnnouncement("Your time begins now.");
      } catch (err) {
        console.error("Failed to start recording:", err);
        toast.error("Could not access microphone. Timer will still run.");
      }
    } catch (err) {
      toast.error("Failed to start speech");
    }
  }, [roomData?.room.id, currentSpeaker, createSpeech, processAudioChunk, speakAnnouncement]);

  const stopSpeech = useCallback(async () => {
    // Stop timer
    setIsTimerRunning(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    // Stop recording and process final chunk
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      
      // Process any remaining audio
      if (audioChunksRef.current.length > 0) {
        await processAudioChunk();
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
      setIsMicActive(false);
    }
    
    // End speech record
    if (currentSpeechId && currentSpeaker) {
      const duration = currentSpeaker.time - timeRemaining;
      await endSpeech.mutateAsync({
        speechId: currentSpeechId,
        duration,
      });
    }
    
    speakAnnouncement("Thank you. Moving to the next speaker.");
    
    // Advance to next speaker
    if (roomData?.room.id) {
      setTimeout(() => {
        advanceSpeaker.mutate({ roomId: roomData.room.id });
      }, 2000);
    }
    
    setCurrentSpeechId(null);
  }, [currentSpeechId, currentSpeaker, timeRemaining, roomData?.room.id, isRecording, endSpeech, advanceSpeaker, processAudioChunk, speakAnnouncement]);

  const toggleMic = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicActive(audioTrack.enabled);
        toast.info(audioTrack.enabled ? "Microphone unmuted" : "Microphone muted");
      }
    }
  }, []);

  const handlePOI = () => {
    if (!roomData?.room.id || !currentSpeechId) return;
    
    offerPOI.mutate({
      roomId: roomData.room.id,
      speechId: currentSpeechId,
      timestamp: (currentSpeaker?.time || 420) - timeRemaining,
    });
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user || !roomData) {
    navigate("/");
    return null;
  }

  const { room, participants, motion } = roomData;
  const progress = ((currentSpeaker?.time || 420) - timeRemaining) / (currentSpeaker?.time || 420) * 100;
  const isWarning = timeRemaining <= 60 && timeRemaining > 30;
  const isDanger = timeRemaining <= 30;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="font-mono">{roomCode}</Badge>
            <span className="text-sm text-muted-foreground">
              Speech {activeSpeakingOrder.findIndex(s => s.role === currentSpeaker?.role) + 1} of {activeSpeakingOrder.length}
            </span>
            {isSpeaking && (
              <Badge variant="secondary" className="gap-1">
                <Volume2 className="w-3 h-3 animate-pulse" />
                AI Moderator
              </Badge>
            )}
          </div>
          <Badge 
            variant={currentSpeaker?.team === "government" ? "default" : "destructive"}
            className="text-sm"
          >
            {currentSpeaker?.team === "government" ? "Government" : "Opposition"}
          </Badge>
        </div>
      </header>

      <main className="flex-1 container py-6">
        <div className="grid lg:grid-cols-3 gap-6 h-full">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Motion */}
            <Card>
              <CardContent className="pt-4">
                <p className="font-semibold text-lg">{motion?.motion}</p>
              </CardContent>
            </Card>

            {/* Timer and Current Speaker */}
            <Card className={`
              ${isWarning ? "border-yellow-500 timer-warning" : ""}
              ${isDanger ? "border-red-500 timer-danger" : ""}
            `}>
              <CardContent className="pt-6">
                <div className="text-center mb-6">
                  <p className="text-sm text-muted-foreground mb-2">Current Speaker</p>
                  <h2 className="text-2xl font-bold mb-1">{currentSpeaker?.label}</h2>
                  <p className="text-sm">
                    {currentParticipant?.user?.name || "Unknown"}
                  </p>
                </div>

                <div className="text-center mb-4">
                  <div className={`
                    text-6xl font-mono font-bold transition-colors
                    ${isWarning ? "text-yellow-500" : ""}
                    ${isDanger ? "text-red-500 animate-pulse" : ""}
                  `}>
                    {formatTime(timeRemaining)}
                  </div>
                  <Progress value={progress} className="mt-4 h-2" />
                  
                  {/* Timer status */}
                  <div className="mt-2 flex items-center justify-center gap-2 text-sm">
                    {isTimerRunning ? (
                      <Badge variant="default" className="gap-1">
                        <Play className="w-3 h-3" /> Running
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <Pause className="w-3 h-3" /> Paused
                      </Badge>
                    )}
                    {isRecording && (
                      <Badge variant="destructive" className="gap-1">
                        <Mic className="w-3 h-3 animate-pulse" /> Recording
                      </Badge>
                    )}
                    {isTranscribing && (
                      <Badge variant="outline" className="gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Transcribing
                      </Badge>
                    )}
                  </div>
                </div>

                {/* POI Window Indicator */}
                <div className="flex justify-center gap-4 text-sm">
                  <div className={`flex items-center gap-1 ${
                    timeRemaining > (currentSpeaker?.time || 420) - 60 ? "text-muted-foreground" : "text-green-500"
                  }`}>
                    {timeRemaining > (currentSpeaker?.time || 420) - 60 ? (
                      <Clock className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    Protected time (start)
                  </div>
                  <div className={`flex items-center gap-1 ${
                    timeRemaining <= 60 ? "text-muted-foreground" : "text-green-500"
                  }`}>
                    {timeRemaining <= 60 ? (
                      <Clock className="w-4 h-4" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    Protected time (end)
                  </div>
                </div>

                {/* Controls */}
                <div className="flex justify-center gap-4 mt-6">
                  {isMyTurn ? (
                    <>
                      {!isTimerRunning ? (
                        <Button 
                          size="lg" 
                          onClick={startSpeech} 
                          className="gap-2"
                          disabled={createSpeech.isPending}
                        >
                          {createSpeech.isPending ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <Mic className="w-5 h-5" />
                          )}
                          Start Speaking
                        </Button>
                      ) : (
                        <>
                          <Button 
                            size="lg" 
                            variant={isMicActive ? "default" : "outline"}
                            onClick={toggleMic}
                            className="gap-2"
                          >
                            {isMicActive ? (
                              <Mic className="w-5 h-5" />
                            ) : (
                              <MicOff className="w-5 h-5" />
                            )}
                            {isMicActive ? "Mute" : "Unmute"}
                          </Button>
                          <Button 
                            size="lg" 
                            variant="destructive"
                            onClick={stopSpeech}
                            className="gap-2"
                            disabled={endSpeech.isPending || advanceSpeaker.isPending}
                          >
                            {(endSpeech.isPending || advanceSpeaker.isPending) ? (
                              <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                              <SkipForward className="w-5 h-5" />
                            )}
                            End Speech
                          </Button>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {canOfferPOI && (
                        <Button 
                          size="lg" 
                          variant="outline"
                          onClick={handlePOI}
                          className="gap-2"
                          disabled={offerPOI.isPending}
                        >
                          <Hand className="w-5 h-5" />
                          Offer POI
                        </Button>
                      )}
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Volume2 className="w-5 h-5" />
                        <span>{isTimerRunning ? "Listening to speaker..." : "Waiting for speaker to begin..."}</span>
                      </div>
                    </>
                  )}
                </div>

                {isDanger && (
                  <div className="flex items-center justify-center gap-2 mt-4 text-red-500">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">Time almost up!</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Live Transcript */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  Live Transcript
                  {isTranscribing && <Loader2 className="w-4 h-4 animate-spin" />}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  {liveTranscript.length > 0 ? (
                    <div className="space-y-3">
                      {liveTranscript.map((entry, i) => (
                        <div key={i} className="border-l-2 border-primary pl-3">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <span className="font-medium">{entry.speaker}</span>
                            <span>•</span>
                            <span>{formatTime(entry.timestamp)}</span>
                          </div>
                          <p className="text-sm">{entry.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {isRecording 
                        ? "Listening... Transcript will appear here as you speak."
                        : "Transcript will appear here during speeches..."}
                    </p>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar - Speaking Order */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Speaking Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {activeSpeakingOrder.map((speaker, activeIndex) => {
                  const participant = participants.find(
                    p => p.speakerRole === speaker.role ||
                         (speaker.role === "opposition_reply" && p.speakerRole === "leader_of_opposition") ||
                         (speaker.role === "government_reply" && p.speakerRole === "prime_minister")
                  );
                  const fullIndex = SPEAKING_ORDER.findIndex(s => s.role === speaker.role);
                  const isCurrent = fullIndex === currentSpeakerIndex;
                  const currentActiveIndex = activeSpeakingOrder.findIndex(s => s.role === currentSpeaker?.role);
                  const isPast = activeIndex < currentActiveIndex;
                  
                  return (
                    <div
                      key={speaker.role}
                      className={`
                        p-3 rounded-lg border text-sm
                        ${isCurrent ? "border-primary bg-primary/5 ring-2 ring-primary/20" : ""}
                        ${isPast ? "opacity-50" : ""}
                        ${speaker.team === "government" ? "border-l-4 border-l-blue-500" : "border-l-4 border-l-red-500"}
                      `}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{speaker.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {participant?.user?.name || "—"}
                          </p>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTime(speaker.time)}
                        </div>
                      </div>
                      {isPast && (
                        <CheckCircle2 className="w-4 h-4 text-green-500 mt-1" />
                      )}
                      {isCurrent && isTimerRunning && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-primary">
                          <Mic className="w-3 h-3 animate-pulse" />
                          Speaking now
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
