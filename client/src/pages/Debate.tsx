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
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import { useModeratorVoice } from "@/hooks/useModeratorVoice";
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

  // Stable refs read by the (long-lived) Scribe callbacks so they never see
  // a stale speech / room / speaker.
  const roomIdRef = useRef<number | null>(null);
  const speakerTimeRef = useRef(420);

  // Speech-to-text status surfaced to the speaker. We never silently swallow
  // a transcription failure: the speaker keeps the floor and can still end
  // the speech, but the error is shown rather than spinning forever.
  const [sttError, setSttError] = useState<string | null>(null);

  // Transcript state - synced from server (canonical, cross-client)
  const [liveTranscript, setLiveTranscript] = useState<Array<{
    id: number;
    speaker: string;
    text: string;
    timestamp: number;
    sequenceNumber: number;
  }>>([]);
  const [lastSequence, setLastSequence] = useState(0);

  // AI Moderator (Phase 2): ElevenLabs TTS via the server only (no browser
  // voice fallback). Announcements are queued so they never overlap.
  const { speak: speakRaw, isSpeaking } = useModeratorVoice();
  // speakRaw's identity changes every render; the 1s timer effect and the
  // mutation callbacks need a stable reference, so route through a ref.
  const speakRef = useRef(speakRaw);
  speakRef.current = speakRaw;
  const speakAnnouncement = useCallback(
    (text: string): Promise<void> => speakRef.current(text),
    [],
  );

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
  const createScribeToken = trpc.speech.createScribeToken.useMutation();
  const commitSegment = trpc.speech.commitTranscriptSegment.useMutation();
  // The commit mutation object is recreated each render; the Scribe callback
  // is long-lived, so reach it through a ref.
  const commitSegmentRef = useRef(commitSegment);
  commitSegmentRef.current = commitSegment;

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

  // ElevenLabs Scribe Realtime STT. The browser never sees the API key; it
  // connects with a server-minted single-use token. Microphone mode lets the
  // SDK capture + encode + stream audio over the WebSocket internally. VAD
  // commit strategy auto-finalizes segments on natural pauses, which suits
  // continuous multi-minute debate speeches.
  const scribe = useScribe({
    commitStrategy: CommitStrategy.VAD,
    languageCode: "en",
    microphone: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    onCommittedTranscript: ({ text }) => {
      const speechId = currentSpeechIdRef.current;
      const roomId = roomIdRef.current;
      const trimmed = text.trim();
      if (!speechId || !roomId || !trimmed) return;

      const timestamp = Math.max(
        0,
        Math.round(speakerTimeRef.current - timeRemainingRef.current),
      );

      commitSegmentRef.current.mutate(
        { roomId, speechId, text: trimmed, timestamp, isFinal: true },
        {
          onSuccess: () => {
            // Pull the freshly-stored segment back fast so the speaker (and
            // every other client) sees it without waiting for the 2s poll.
            utils.transcript.poll.invalidate();
          },
          onError: (err) => {
            setSttError(`Failed to save transcript: ${err.message}`);
          },
        },
      );
    },
    onError: (err) => {
      const message =
        err instanceof Error
          ? err.message
          : "Live transcription connection error";
      setSttError(message);
    },
    onAuthError: ({ error }) => {
      setSttError(`Transcription authorization failed: ${error}`);
    },
  });

  // Long-lived disconnect handle for unmount cleanup (scribe identity changes
  // each render; the cleanup effect must run exactly once).
  const scribeDisconnectRef = useRef(scribe.disconnect);
  scribeDisconnectRef.current = scribe.disconnect;
  const scribeConnectedRef = useRef(scribe.isConnected);
  scribeConnectedRef.current = scribe.isConnected;

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

  // Keep refs the Scribe callbacks read in sync with the latest room/speaker.
  useEffect(() => {
    roomIdRef.current = roomData?.room.id ?? null;
  }, [roomData?.room.id]);
  useEffect(() => {
    speakerTimeRef.current = currentSpeaker?.time ?? 420;
  }, [currentSpeaker?.time]);


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
      if (scribeConnectedRef.current) {
        scribeDisconnectRef.current();
      }
    };
  }, []);

  const startSpeech = useCallback(async () => {
    if (!roomData?.room.id || !currentSpeaker) return;

    setSttError(null);

    let speechId: number;
    try {
      // Create speech record
      const result = await createSpeech.mutateAsync({
        roomId: roomData.room.id,
        speakerRole: currentSpeaker.role,
        speechType: currentSpeaker.role.includes("reply") ? "reply" : "substantive",
      });
      speechId = result.speechId;
    } catch (err) {
      toast.error("Failed to start speech");
      return;
    }

    // Track the active speech for the timer + Scribe callbacks.
    setCurrentSpeechId(speechId);
    currentSpeechIdRef.current = speechId;
    timeRemainingRef.current = currentSpeaker.time;

    // Start the timer / give the speaker the floor immediately. Even if STT
    // fails below, they keep the floor and can end the speech normally.
    setIsTimerRunning(true);

    // Announce first, THEN start capturing (so the moderator voice isn't
    // transcribed as the speaker).
    await speakAnnouncement("Your time begins now.");

    // Exchange for a short-lived single-use Scribe token (server-side; the
    // API key never reaches the browser).
    let token: string;
    let modelId: string;
    try {
      const minted = await createScribeToken.mutateAsync({
        roomId: roomData.room.id,
        speechId,
      });
      token = minted.token;
      modelId = minted.modelId;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start transcription";
      setSttError(message);
      toast.error(`Live transcription unavailable: ${message}`);
      return; // Speaker still has the floor; no infinite spinner.
    }

    try {
      await scribe.connect({ token, modelId });
      toast.success("Recording started — speak clearly into your microphone");
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Could not connect to transcription / access microphone";
      setSttError(message);
      toast.error(message);
    }
  }, [roomData?.room.id, currentSpeaker, createSpeech, createScribeToken, scribe, speakAnnouncement]);

  const stopSpeech = useCallback(async () => {
    // Stop timer
    setIsTimerRunning(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    // Flush any buffered audio into a final committed segment, then tear down
    // the mic + WebSocket.
    if (scribe.isConnected) {
      try {
        scribe.commit();
        // Give the final onCommittedTranscript a moment to fire + persist.
        await new Promise((resolve) => setTimeout(resolve, 700));
      } catch {
        // Non-fatal: we still disconnect and end the speech below.
      }
      scribe.disconnect();
    }

    // End speech record using ref for accurate values
    const speechId = currentSpeechIdRef.current;
    if (speechId && currentSpeaker) {
      const duration = currentSpeaker.time - timeRemainingRef.current;
      await endSpeech.mutateAsync({
        speechId,
        duration,
      });
    }

    // Pull any just-committed final segments into the shared transcript.
    utils.transcript.poll.invalidate();

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
    setSttError(null);
  }, [currentSpeaker, roomData?.room.id, endSpeech, advanceSpeaker, scribe, speakAnnouncement, utils]);

  const toggleMic = useCallback(() => {
    if (!scribe.isConnected) return;
    if (scribe.isMuted) {
      scribe.unmute();
      toast.info("Microphone unmuted");
    } else {
      scribe.mute();
      toast.info("Microphone muted");
    }
  }, [scribe]);

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

  // Scribe-derived UI state.
  const isConnected = scribe.isConnected;
  const isMicActive = isConnected && !scribe.isMuted;
  const isTranscribing = scribe.isTranscribing;
  const isConnecting = scribe.status === "connecting";

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
                    {isConnected && (
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

                {/* Live transcription error (never silently swallowed) */}
                {sttError && (
                  <div className="flex items-start justify-center gap-2 mt-4 text-red-500">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="text-sm">
                      Live transcription issue: {sttError}. You can keep
                      speaking and end your speech normally.
                    </span>
                  </div>
                )}

                {/* Controls */}
                <div className="flex justify-center gap-4 mt-6">
                  {isMyTurn ? (
                    <>
                      {!isTimerRunning ? (
                        <Button
                          size="lg"
                          onClick={startSpeech}
                          className="gap-2"
                          disabled={createSpeech.isPending || createScribeToken.isPending || isConnecting}
                        >
                          {(createSpeech.isPending || createScribeToken.isPending || isConnecting) ? (
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
                            disabled={!isConnected}
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

            {/* Live Transcript - synced from server, with live partial for the speaker */}
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
                  {liveTranscript.length > 0 || (isMyTurn && scribe.partialTranscript) ? (
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
                      {isMyTurn && scribe.partialTranscript && (
                        <div className="border-l-2 border-muted-foreground/40 pl-3">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <span className="font-medium">{currentSpeaker?.label}</span>
                            <span>•</span>
                            <span className="italic">speaking…</span>
                          </div>
                          <p className="text-sm text-muted-foreground italic">
                            {scribe.partialTranscript}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {isConnected
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
