/**
 * Alias endpoint for voice memo transcription.
 * POST /api/transcribe-audio
 */
import { onRequestPost as transcribePost } from './transcribe';

export const onRequestPost = transcribePost;
