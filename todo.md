# DebateArena - AI-Powered Live Debate Practice Platform

## Core Features

- [x] User authentication and profile creation with topical interests, background, and experience level
- [x] Live debate room supporting two teams of 3 debaters each with Asian Parliamentary format
- [x] AI motion generation based on topic areas, difficulty level, and debate format with background context
- [x] Automated timekeeping and moderation (speaker order, time limits, POI handling, rule violation flagging)
- [x] Real-time speech-to-text transcription with speaker labels and timestamps
- [x] Argument mindmap visualization with quality scoring and transcript linking
- [x] Post-debate feedback system (per-speaker analysis, strongest arguments, missed responses, improvements)
- [x] Real-time audio communication between debaters using WebRTC
- [x] Debate session state management with synchronized turn tracking
- [x] Debate transcript storage and retrieval for post-debate review
- [x] Whisper API integration for real-time transcription with speaker identification
- [x] LLM integration for argument analysis, mindmap generation, and coaching feedback

## Database Schema

- [x] User profiles table with interests, background, experience level
- [x] Debate rooms table
- [x] Debate participants table
- [x] Debate motions table
- [x] Debate transcripts table
- [x] Debate feedback table
- [x] Argument nodes table for mindmap

## UI Pages

- [x] Landing page / Home
- [x] User profile setup page
- [x] Debate lobby / room list
- [x] Debate room creation page
- [x] Live debate room with audio, timer, and controls
- [x] Post-debate review page with transcript and mindmap
- [x] Feedback and analysis page

## Backend API

- [x] User profile CRUD endpoints
- [x] Debate room creation and management
- [x] Team joining and role selection
- [x] Motion generation with LLM
- [x] Speech recording and transcription
- [x] POI (Point of Information) handling
- [x] Feedback generation with LLM
- [x] Argument extraction and mindmap generation

## Tests

- [x] Auth router tests
- [x] Profile router tests
- [x] Room router tests (create, join, leave, start)
- [x] Motion generation tests
- [x] Room start validation tests
- [x] Speaker advancement tests

## New Features

- [x] Allow starting debate early with fewer than 6 participants

- [x] Fix timer countdown to run properly during speaker turns
- [x] Implement microphone audio capture for speech input
- [x] Add speech-to-text transcription using Whisper API
- [x] Add AI moderator text-to-speech announcements

- [x] Dynamic speaker order based on joined participants (skip empty positions)

- [x] Redesign frontend to match competitor's visual style (color scheme, layout, decorations)

## Bug Fixes

- [ ] Fix real-time transcript syncing - broadcast to all users in room
- [ ] Add transcript re-hydration on client join/reconnect
- [ ] Delay microphone recording until AI speech completes (prevent AI voice in transcript)

- [x] Fix audio recording cutting off after first few seconds - ensure continuous recording and transcription

- [x] Fix audio recording cutting off - ensure entire speech is recorded and transcribed until stop button pressed

- [x] Fix transcript system to properly record and transcribe each player's full argument live throughout their turn

- [x] Debug and fix live transcription - ensure it works in real-time as users speak
- [x] Write tests for transcription functionality
