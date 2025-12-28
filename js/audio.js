/**
 * Audio System
 * Plays pre-recorded narration tracks based on moment name.
 */

const AUDIO_BASE_PATH = './Audio/';

const AUDIO_TRACKS = {
    apertura: 'Apertura.mp3',
    'collezione-elegance': 'Collezione-Elegance.mp3',
    'collezione-minimal': 'Collezione-Minimal.mp3',
    'collezione-luxury': 'Collezione-Luxury.mp3'
};

export class AudioSystem {
    constructor() {
        this.tracks = new Map();
        this.current = null;
        this.speaking = false;
        this.unlocked = false;
        this.unlocking = false;
        this.unlockToken = 0;
        this.unlockAudio = null;
        this.playToken = 0;
        this.preparedKey = null;
        this.preparedAudio = null;
        this.loadTracks();
    }

    loadTracks() {
        Object.entries(AUDIO_TRACKS).forEach(([key, filename]) => {
            const audio = new Audio(`${AUDIO_BASE_PATH}${filename}`);
            audio.preload = 'auto';
            this.tracks.set(key, audio);
        });
    }

    hasMoment(key) {
        return this.tracks.has(key);
    }

    hasCollection(collection) {
        return this.hasMoment(`collezione-${collection}`);
    }

    getDuration(key) {
        const audio = this.tracks.get(key);
        if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
            return null;
        }
        return audio.duration;
    }

    getCollectionDuration(collection) {
        return this.getDuration(`collezione-${collection}`);
    }

    isSpeaking() {
        return this.speaking;
    }

    updateARIAIndicator(isSpeaking) {
        const indicator = document.getElementById('aria-status');
        if (!indicator) return;
        if (isSpeaking) {
            indicator.classList.add('speaking');
        } else {
            indicator.classList.remove('speaking');
        }
    }

    setSpeaking(value) {
        this.speaking = value;
        this.updateARIAIndicator(value);
    }

    stop() {
        this.playToken += 1;
        if (this.preparedAudio) {
            this.preparedAudio.pause();
            this.preparedAudio.currentTime = 0;
            this.preparedAudio.muted = false;
            this.preparedAudio.loop = false;
            this.preparedAudio = null;
            this.preparedKey = null;
        }
        if (!this.current) {
            this.setSpeaking(false);
            return;
        }
        this.current.pause();
        this.current.currentTime = 0;
        this.current.onended = null;
        this.current.onerror = null;
        this.current = null;
        this.setSpeaking(false);
    }

    unlock(preferredKey = 'apertura') {
        if (this.unlocked || this.unlocking) return;
        const audio = this.tracks.get(preferredKey) || this.tracks.values().next().value;
        if (!audio) return;

        const token = ++this.unlockToken;
        this.unlocking = true;
        this.unlockAudio = audio;

        if (audio.readyState === 0) {
            audio.load();
        }
        audio.muted = true;
        const playPromise = audio.play();

        const finalize = () => {
            if (this.unlockToken !== token) return;

            if (this.current === audio && this.speaking) {
                audio.muted = false;
            } else {
                audio.pause();
                audio.currentTime = 0;
                audio.muted = false;
            }

            this.unlocked = true;
            this.unlocking = false;
            this.unlockAudio = null;
        };

        if (playPromise && typeof playPromise.then === 'function') {
            playPromise.then(finalize).catch(() => {
                if (this.unlockToken !== token) return;
                audio.muted = false;
                this.unlocking = false;
                this.unlockAudio = null;
            });
        } else {
            finalize();
        }
    }

    prepareMoment(key) {
        const audio = this.tracks.get(key);
        if (!audio) return false;

        if (this.preparedAudio && this.preparedAudio !== audio) {
            this.preparedAudio.pause();
            this.preparedAudio.currentTime = 0;
            this.preparedAudio.muted = false;
            this.preparedAudio.loop = false;
            this.preparedAudio = null;
            this.preparedKey = null;
        }

        if (this.current && this.current !== audio) {
            this.stop();
        }

        this.preparedKey = key;
        this.preparedAudio = audio;

        audio.loop = true;
        audio.muted = true;
        audio.currentTime = 0;
        if (audio.readyState === 0) {
            audio.load();
        }

        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }

        return true;
    }

    prepareCollection(collection) {
        return this.prepareMoment(`collezione-${collection}`);
    }

    playMoment(key) {
        const audio = this.tracks.get(key);
        if (!audio) {
            console.warn(`Missing audio track for moment: ${key}`);
            return Promise.resolve(false);
        }

        if (this.unlocking && this.unlockAudio === audio) {
            this.unlockToken += 1;
            this.unlocking = false;
            this.unlockAudio = null;
        }

        const preparedPlaying = this.preparedAudio === audio && !audio.paused;
        if (!preparedPlaying) {
            this.stop();
        } else if (this.current && this.current !== audio) {
            this.stop();
        }

        const token = ++this.playToken;
        this.current = audio;
        this.current.currentTime = 0;
        this.current.muted = false;
        this.current.loop = false;
        if (this.current.readyState === 0) {
            this.current.load();
        }
        this.setSpeaking(true);

        return new Promise((resolve) => {
            this.current.onended = () => {
                if (token !== this.playToken) return;
                this.setSpeaking(false);
                this.current = null;
                resolve(true);
            };
            this.current.onerror = (event) => {
                if (token !== this.playToken) return;
                console.warn('Audio playback error', event);
                this.setSpeaking(false);
                this.current = null;
                resolve(false);
            };

            if (preparedPlaying) {
                this.preparedKey = null;
                this.preparedAudio = null;
                return;
            }

            const playPromise = this.current.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((error) => {
                    if (token !== this.playToken) return;
                    if (error && error.name === 'AbortError') {
                        this.setSpeaking(false);
                        this.current = null;
                        resolve(false);
                        return;
                    }
                    console.warn('Audio playback failed', error);
                    this.setSpeaking(false);
                    this.current = null;
                    resolve(false);
                });
            }
        });
    }

    playApertura() {
        return this.playMoment('apertura');
    }

    playCollection(collection) {
        return this.playMoment(`collezione-${collection}`);
    }
}
