/**
 * Voice System - Web Speech API
 * ARIA speaks in Italian with synchronized light effects
 */

// Check for Web Speech API support
const synth = window.speechSynthesis;
let italianVoice = null;
let speaking = false;
let onSpeakingChange = null;

// ============================================
// Voice System Class
// ============================================

export class VoiceSystem {
    constructor() {
        this.synth = window.speechSynthesis;
        this.voice = null;
        this.speaking = false;
        this.queue = [];

        // Load Italian voice
        this.loadVoice();

        // Voices may load asynchronously
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => this.loadVoice();
        }
    }

    // ----------------------------------------
    // Load Italian Voice
    // ----------------------------------------
    loadVoice() {
        const voices = this.synth.getVoices();

        // Find Italian voice (prefer female voice for ARIA)
        this.voice = voices.find(v =>
            v.lang.startsWith('it') && v.name.toLowerCase().includes('female')
        ) || voices.find(v =>
            v.lang.startsWith('it')
        ) || voices.find(v =>
            v.lang.startsWith('it-IT')
        );

        if (this.voice) {
            console.log('Voice loaded:', this.voice.name);
        } else {
            console.warn('No Italian voice found, using default');
        }
    }

    // ----------------------------------------
    // Speak Text
    // ----------------------------------------
    speak(text, onSubtitle) {
        return new Promise((resolve) => {
            // Cancel any current speech
            this.synth.cancel();

            const utterance = new SpeechSynthesisUtterance(text);

            // Set voice properties
            if (this.voice) {
                utterance.voice = this.voice;
            }
            utterance.lang = 'it-IT';
            utterance.rate = 0.9;  // Slightly slower for elegance
            utterance.pitch = 1.05; // Slightly higher for warmth
            utterance.volume = 1.0;

            // Events
            utterance.onstart = () => {
                this.speaking = true;
                if (onSubtitle) onSubtitle(text);
                this.updateARIAIndicator(true);
            };

            utterance.onend = () => {
                this.speaking = false;
                this.updateARIAIndicator(false);
                resolve();
            };

            utterance.onerror = (event) => {
                console.error('Speech error:', event);
                this.speaking = false;
                this.updateARIAIndicator(false);
                resolve();
            };

            // Speak
            this.synth.speak(utterance);
        });
    }

    // ----------------------------------------
    // Speak with Typing Effect on Subtitles
    // ----------------------------------------
    speakWithTyping(text, subtitleElement) {
        return new Promise((resolve) => {
            this.synth.cancel();

            const utterance = new SpeechSynthesisUtterance(text);

            if (this.voice) {
                utterance.voice = this.voice;
            }
            utterance.lang = 'it-IT';
            utterance.rate = 0.9;
            utterance.pitch = 1.05;

            let charIndex = 0;
            const words = text.split(' ');
            let wordIndex = 0;

            // Calculate approximate timing
            const totalDuration = (text.length / 15) * 1000; // ~15 chars per second
            const wordDelay = totalDuration / words.length;

            utterance.onstart = () => {
                this.speaking = true;
                this.updateARIAIndicator(true);

                // Word by word subtitle
                if (subtitleElement) {
                    subtitleElement.textContent = '';

                    const typeInterval = setInterval(() => {
                        if (wordIndex < words.length) {
                            subtitleElement.textContent = words.slice(0, wordIndex + 1).join(' ');
                            wordIndex++;
                        } else {
                            clearInterval(typeInterval);
                        }
                    }, wordDelay);
                }
            };

            utterance.onend = () => {
                this.speaking = false;
                this.updateARIAIndicator(false);
                if (subtitleElement) {
                    subtitleElement.textContent = text;
                }
                resolve();
            };

            utterance.onerror = () => {
                this.speaking = false;
                this.updateARIAIndicator(false);
                resolve();
            };

            this.synth.speak(utterance);
        });
    }

    // ----------------------------------------
    // UI Updates
    // ----------------------------------------
    updateARIAIndicator(isSpeaking) {
        const indicator = document.getElementById('aria-status');
        if (indicator) {
            if (isSpeaking) {
                indicator.classList.add('speaking');
            } else {
                indicator.classList.remove('speaking');
            }
        }
    }

    // ----------------------------------------
    // State Getters
    // ----------------------------------------
    isSpeaking() {
        return this.speaking;
    }

    // ----------------------------------------
    // Cancel Speech
    // ----------------------------------------
    cancel() {
        this.synth.cancel();
        this.speaking = false;
        this.updateARIAIndicator(false);
    }

    // ----------------------------------------
    // Check Support
    // ----------------------------------------
    static isSupported() {
        return 'speechSynthesis' in window;
    }
}

// ============================================
// Predefined ARIA Phrases
// ============================================

export const ARIA_PHRASES = {
    welcome: "Benvenuto nell'esperienza ARIA. Sono qui per guidarti alla scoperta delle nostre collezioni esclusive.",

    chooseCollection: "Scegli la collezione che desideri esplorare.",

    collections: {
        elegance: "Hai scelto il divano Bonton 200. Design morbido e comfort avvolgente.",
        minimal: "Il divano Dolores 274X. Linee essenziali e anima contemporanea.",
        luxury: "Benvenuto da Eclipse. Presenza scenica e stile iconico."
    },

    productIntro: "Ecco il nostro divano di punta. Realizzato interamente in Italia con materiali premium. Ogni dettaglio è stato curato per offrirti il massimo comfort.",

    colorChange: "Puoi personalizzare il colore secondo il tuo gusto. Seleziona una delle tonalità disponibili.",

    cta: "Se desideri maggiori informazioni o un preventivo personalizzato, il nostro team è a tua disposizione.",

    farewell: "Grazie per aver visitato il nostro showroom virtuale. A presto."
};
