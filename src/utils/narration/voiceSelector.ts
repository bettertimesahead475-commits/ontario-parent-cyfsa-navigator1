/**
 * CYFSA Navigator — Voice Selection & Canadian English Prioritization
 *
 * Scans available browser synthesis voices and ranks them to prefer
 * natural, high-quality Canadian English ("en-CA") voices.
 */

import { NarrationVoice } from './types';

export function rankAndFilterVoices(speechVoices: SpeechSynthesisVoice[]): NarrationVoice[] {
  if (!speechVoices || speechVoices.length === 0) return [];

  // Filter for English and French (Canada's official languages)
  const relevantVoices = speechVoices.filter(v => 
    v.lang.toLowerCase().startsWith('en') || 
    v.lang.toLowerCase().startsWith('fr')
  );

  const candidateList = relevantVoices.length > 0 ? relevantVoices : speechVoices;

  const mapped: NarrationVoice[] = candidateList.map(v => {
    const langLower = (v.lang || '').toLowerCase();
    const nameLower = (v.name || '').toLowerCase();

    const isCanadian = 
      langLower === 'en-ca' || 
      langLower.startsWith('en-ca') || 
      nameLower.includes('canada') || 
      nameLower.includes('canadian') ||
      nameLower.includes('linda') || // Microsoft Linda (en-CA)
      nameLower.includes('richard'); // Microsoft Richard (en-CA)

    const isNaturalOrNeural = 
      nameLower.includes('natural') || 
      nameLower.includes('neural') || 
      nameLower.includes('online') || 
      nameLower.includes('google') ||
      nameLower.includes('enhanced') ||
      nameLower.includes('siri');

    return {
      name: v.name,
      lang: v.lang,
      isCanadian,
      isNaturalOrNeural,
      isDefault: Boolean(v.default),
    };
  });

  // Sort with highest quality Canadian voices at the top
  mapped.sort((a, b) => {
    // 1. Canadian Natural / Neural voice first
    if (a.isCanadian && a.isNaturalOrNeural && !(b.isCanadian && b.isNaturalOrNeural)) return -1;
    if (b.isCanadian && b.isNaturalOrNeural && !(a.isCanadian && a.isNaturalOrNeural)) return 1;

    // 2. Any Canadian voice second
    if (a.isCanadian && !b.isCanadian) return -1;
    if (b.isCanadian && !a.isCanadian) return 1;

    // 3. Natural / Neural non-Canadian English voices third
    if (a.isNaturalOrNeural && !b.isNaturalOrNeural) return -1;
    if (b.isNaturalOrNeural && !a.isNaturalOrNeural) return 1;

    // 4. Default voice
    if (a.isDefault && !b.isDefault) return -1;
    if (b.isDefault && !a.isDefault) return 1;

    return a.name.localeCompare(b.name);
  });

  return mapped;
}

export function pickDefaultCanadianVoice(voices: NarrationVoice[]): string | null {
  if (!voices || voices.length === 0) return null;
  // First item in the sorted list is the highest-ranked Canadian or best natural voice
  return voices[0].name;
}
