import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
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

const ROLE_LABELS: Record<string, string> = {
  prime_minister: "Prime Minister",
  leader_of_opposition: "Leader of Opposition",
  deputy_prime_minister: "Deputy Prime Minister",
  deputy_leader_of_opposition: "Deputy Leader of Opposition",
  government_whip: "Government Whip",
  opposition_whip: "Opposition Whip",
  opposition_reply: "Opposition Reply",
  government_reply: "Government Reply",
};

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
  const currentSpeechIdRef = useRef<number | null>(null); // Ref to avoid stale closure
  const timeRemainingRef = useRef(420); // Ref for accurate timestamp in transcription
  
  // Audio state
  const [isMicActive, setIsMicActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]); // All accumulated audio chunks
  const pendingChunksRef = useRef<Blob[]>([]); // Chunks waiting to be transcribed
  const processedIndexRef = useRef(0); // Index of last processed chunk
  const streamRef = useRef<MediaStream | null>(null);
  const transcriptionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false); // Prevent concurrent transcription calls
  
  // Transcript state - now synced from server
  const [liveTranscript, setLiveTranscript] = useState<Array<{
    id: number;
    speaker: string;
    text: string;
    timestamp: number;
    sequenceNumber: number;
  }>>([]);
  const [lastSequence, setLastSequence] = useState(0);
  
  // AI Moderator state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);
  const isSpeakingRef = useRef(false); // Ref to track speaking state for async callbacks
  
  const utils = trpc.useUtils();

  const { data: roomData, isLoading } = trpc.room.get.useQuery(
    { roomCode },
    { 
      enabled: !!roomCode,
      refetchInterval: 5000,
    }
  );

  // Poll for transcript updates every 2 seconds
  const { data: transcriptData } = trpc.transcript.poll.useQuery(
    { 
      roomId: roomData?.room.id || 0, 
      afterSequence: lastSequence 
    },
    { 
      enabled: !!roomData?.room.id && roomData.room.status === "in_progress",
      refetchInterval: 2000,
    }
  );

  // Update local transcript when new segments arrive from server
  useEffect(() => {
    if (transcriptData?.segments && transcriptData.segments.length > 0) {
      const newSegments = transcriptData.segments.map(seg => ({
        id: seg.id,
        speaker: ROLE_LABELS[seg.speakerRole] || seg.speakerRole,
        text: seg.text,
        timestamp: seg.timestamp,
        sequenceNumber: seg.sequenceNumber,
      }));
      
      setLiveTranscript(prev => {
        // Merge new segments, avoiding duplicates
        const existingIds = new Set(prev.map(s => s.id));
        const uniqueNew = newSegments.filter(s => !existingIds.has(s.id));
        return [...prev, ...uniqueNew].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      });
      
      // Update last sequence
      const maxSeq = Math.max(...newSegments.map(s => s.sequenceNumber));
      setLastSequence(prev => Math.max(prev, maxSeq));
    }
  }, [transcriptData]);

  // Load full transcript on mount / reconnect (rehydration)
  const { data: fullTranscript } = trpc.transcript.getAll.useQuery(
    { roomId: roomData?.room.id || 0 },
    { 
      enabled: !!roomData?.room.id && roomData.room.status === "in_progress" && lastSequence === 0,
    }
  );

  useEffect(() => {
    if (fullTranscript?.segments && fullTranscript.segments.length > 0 && lastSequence === 0) {
      const segments = fullTranscript.segments.map(seg => ({
        id: seg.id,
        speaker: ROLE_LABELS[seg.speakerRole] || seg.speakerRole,
        text: seg.text,
        timestamp: seg.timestamp,
        sequenceNumber: seg.sequenceNumber,
      }));
      setLiveTranscript(segments);
      const maxSeq = Math.max(...segments.map(s => s.sequenceNumber));
      setLastSequence(maxSeq);
    }
  }, [fullTranscript, lastSequence]);

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

  // AI Moderator speech function - returns a promise that resolves when speech ends
  const speakAnnouncement = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if ('speechSynthesis' in window) {
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;
        
        // Try to get a good voice
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => 
          v.name.includes('Google') || 
          v.name.includes('Microsoft') || 
          v.lang.startsWith('en')
        );
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
        
        utterance.onstart = () => {
          setIsSpeaking(true);
          isSpeakingRef.current = true;
        };
        utterance.onend = () => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          resolve();
        };
        utterance.onerror = () => {
          setIsSpeaking(false);
          isSpeakingRef.current = false;
          resolve();
        };
        
        speechSynthRef.current = utterance;
        window.speechSynthesis.speak(utterance);
      } else {
        resolve();
      }
    });
  }, []);

  // Timer effect - runs independently when started
  useEffect(() => {
    if (isTimerRunning && timeRemaining > 0) {
      timerIntervalRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          const newTime = prev - 1;
          timeRemainingRef.current = newTime; // Keep ref in sync
          
          // Time warnings - don't await these, just fire and forget
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

  // Reset timer when speaker changes (but don't clear transcript - it's synced from server)
  useEffect(() => {
    if (currentSpeaker) {
      setTimeRemaining(currentSpeaker.time);
      setIsTimerRunning(false);
      
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
      if (transcriptionIntervalRef.current) {
        clearInterval(transcriptionIntervalRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  // Process audio and transcribe - queue-based approach that never loses data
  const processAudioChunk = useCallback(async (isFinal: boolean = false) => {
    const speechId = currentSpeechIdRef.current;
    
    // Check if we have new chunks to process
    const totalChunks = audioChunksRef.current.length;
    const processedCount = processedIndexRef.current;
    
    if (totalChunks <= processedCount || !speechId) {
      console.log("[Transcription] Skipping - no new chunks", { total: totalChunks, processed: processedCount, speechId });
      return;
    }
    
    // Don't process if AI is speaking (unless final)
    if (isSpeakingRef.current && !isFinal) {
      console.log("[Transcription] Skipping - AI is speaking");
      return;
    }
    
    // Prevent concurrent processing
    if (isProcessingRef.current && !isFinal) {
      console.log("[Transcription] Skipping - already processing");
      return;
    }
    
    isProcessingRef.current = true;
    
    // Get unprocessed chunks (don't clear them, just mark as processed)
    const chunksToProcess = audioChunksRef.current.slice(processedCount);
    const newProcessedIndex = totalChunks;
    
    const audioBlob = new Blob(chunksToProcess, { type: 'audio/webm' });
    
    // Only process if blob is large enough (has actual audio)
    if (audioBlob.size < 500) {
      console.log("[Transcription] Skipping - blob too small:", audioBlob.size);
      isProcessingRef.current = false;
      return;
    }
    
    console.log("[Transcription] Processing", chunksToProcess.length, "chunks,", audioBlob.size, "bytes", isFinal ? "(FINAL)" : "");
    setIsTranscribing(true);
    
    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          if (result) {
            const base64 = result.split(',')[1];
            resolve(base64);
          } else {
            reject(new Error("Failed to read audio"));
          }
        };
        reader.onerror = () => reject(reader.error);
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await base64Promise;
      
      // Calculate timestamp using ref for accuracy
      const speakerTime = currentSpeaker?.time || 420;
      const timestamp = speakerTime - timeRemainingRef.current;
      
      console.log("[Transcription] Sending to server, timestamp:", timestamp);
      
      // Send to backend for transcription
      await transcribeSpeech.mutateAsync({
        speechId,
        audioData: base64Audio,
        timestamp,
      });
      
      // Only mark as processed AFTER successful transcription
      processedIndexRef.current = newProcessedIndex;
      console.log("[Transcription] Successfully transcribed, processed index now:", newProcessedIndex);
    } catch (err) {
      console.error("[Transcription] Error:", err);
      // Don't update processedIndex on error - will retry these chunks
    } finally {
      setIsTranscribing(false);
      isProcessingRef.current = false;
    }
  }, [currentSpeaker, transcribeSpeech]);

  const startSpeech = useCallback(async () => {
    if (!roomData?.room.id || !currentSpeaker) return;
    
    try {
      // Create speech record
      const result = await createSpeech.mutateAsync({
        roomId: roomData.room.id,
        speakerRole: currentSpeaker.role,
        speechType: currentSpeaker.role.includes("reply") ? "reply" : "substantive",
      });
      
      // Update both state and ref for the speech ID
      setCurrentSpeechId(result.speechId);
      currentSpeechIdRef.current = result.speechId;
      
      // Initialize time ref
      timeRemainingRef.current = currentSpeaker.time;
      
      // Reset audio tracking refs
      audioChunksRef.current = [];
      processedIndexRef.current = 0;
      isProcessingRef.current = false;
      
      // Start timer
      setIsTimerRunning(true);
      
      // First announce, THEN start recording (wait for AI to finish speaking)
      await speakAnnouncement("Your time begins now.");
      
      // Now start microphone recording AFTER AI has finished speaking
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          } 
        });
        streamRef.current = stream;
        
        // Check for supported mime type
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
          ? 'audio/webm;codecs=opus' 
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : 'audio/mp4';
        
        console.log("[Recording] Using mime type:", mimeType);
        
        const mediaRecorder = new MediaRecorder(stream, { 
          mimeType,
          audioBitsPerSecond: 128000 // Good quality for speech
        });
        mediaRecorderRef.current = mediaRecorder;
        
        mediaRecorder.ondataavailable = (event) => {
          console.log("[Recording] Data available:", event.data.size, "bytes, state:", mediaRecorder.state);
          if (event.data.size > 0) {
            // Always collect audio - we'll filter AI speech during transcription
            audioChunksRef.current.push(event.data);
            console.log("[Recording] Chunk added, total chunks:", audioChunksRef.current.length);
          }
        };
        
        mediaRecorder.onerror = (event) => {
          console.error("[Recording] MediaRecorder error:", event);
          toast.error("Recording error occurred");
        };
        
        mediaRecorder.onstop = () => {
          console.log("[Recording] MediaRecorder stopped, total chunks:", audioChunksRef.current.length);
        };
        
        // Start recording with 10 second timeslice for substantial audio chunks
        // Longer chunks = better transcription quality
        mediaRecorder.start(10000);
        console.log("[Recording] Started with 10s timeslice");
        setIsRecording(true);
        setIsMicActive(true);
        
        // Set up interval to process chunks every 15 seconds
        // This ensures we have at least one full chunk before processing
        transcriptionIntervalRef.current = setInterval(() => {
          const unprocessedCount = audioChunksRef.current.length - processedIndexRef.current;
          console.log("[Recording] Interval tick, unprocessed chunks:", unprocessedCount, "AI speaking:", isSpeakingRef.current);
          if (unprocessedCount > 0 && !isSpeakingRef.current && !isProcessingRef.current) {
            processAudioChunk(false);
          }
        }, 15000); // Process every 15 seconds
        
        toast.success("Recording started - speak clearly into your microphone");
      } catch (err) {
        console.error("Failed to start recording:", err);
        toast.error("Could not access microphone. Please check permissions.");
      }
    } catch (err) {
      toast.error("Failed to start speech");
    }
  }, [roomData?.room.id, currentSpeaker, createSpeech, processAudioChunk, speakAnnouncement]);

  const stopSpeech = useCallback(async () => {
    console.log("[Recording] Stopping speech...");
    console.log("[Recording] Total chunks collected:", audioChunksRef.current.length);
    console.log("[Recording] Processed so far:", processedIndexRef.current);
    
    // Stop timer
    setIsTimerRunning(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    
    // Clear transcription interval first
    if (transcriptionIntervalRef.current) {
      clearInterval(transcriptionIntervalRef.current);
      transcriptionIntervalRef.current = null;
    }
    
    // Stop recording and process ALL remaining audio
    if (mediaRecorderRef.current && isRecording) {
      // Request final data before stopping
      if (mediaRecorderRef.current.state === 'recording') {
        console.log("[Recording] Requesting final data...");
        mediaRecorderRef.current.requestData(); // Force emit any pending data
      }
      
      mediaRecorderRef.current.stop();
      
      // Wait for ondataavailable to fire with final chunk
      await new Promise(resolve => setTimeout(resolve, 500));
      
      console.log("[Recording] After stop - total chunks:", audioChunksRef.current.length);
      
      // Process ALL remaining unprocessed audio (force final processing)
      const unprocessedCount = audioChunksRef.current.length - processedIndexRef.current;
      if (unprocessedCount > 0) {
        console.log("[Recording] Processing final", unprocessedCount, "unprocessed chunks");
        // Wait for any in-progress transcription to complete
        while (isProcessingRef.current) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        await processAudioChunk(true); // Pass true for final processing
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setIsRecording(false);
      setIsMicActive(false);
      mediaRecorderRef.current = null;
    }
    
    // End speech record using ref for accurate values
    const speechId = currentSpeechIdRef.current;
    if (speechId && currentSpeaker) {
      const duration = currentSpeaker.time - timeRemainingRef.current;
      console.log("[Recording] Ending speech, duration:", duration, "seconds");
      await endSpeech.mutateAsync({
        speechId,
        duration,
      });
    }
    
    // Clear audio refs
    audioChunksRef.current = [];
    processedIndexRef.current = 0;
    
    speakAnnouncement("Thank you. Moving to the next speaker.");
    
    // Advance to next speaker
    if (roomData?.room.id) {
      setTimeout(() => {
        advanceSpeaker.mutate({ roomId: roomData.room.id });
      }, 2000);
    }
    
    // Clear refs
    setCurrentSpeechId(null);
    currentSpeechIdRef.current = null;
  }, [currentSpeaker, roomData?.room.id, isRecording, endSpeech, advanceSpeaker, processAudioChunk, speakAnnouncement]);

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

            {/* Live Transcript - Now synced from server */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  Live Transcript
                  {isTranscribing && <Loader2 className="w-4 h-4 animate-spin" />}
                  <Badge variant="outline" className="ml-auto text-xs">
                    {liveTranscript.length} segments
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  {liveTranscript.length > 0 ? (
                    <div className="space-y-3">
                      {liveTranscript.map((entry) => (
                        <div key={entry.id} className="border-l-2 border-primary pl-3">
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
