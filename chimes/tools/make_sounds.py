"""Writes chimes' four sounds as short, soft WAV files: sine tones with a gentle attack and fade.

    python3 chimes/tools/make_sounds.py chimes/sounds
"""
import math
import struct
import sys
import wave
from pathlib import Path

RATE = 44100
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)


def tone(freq, secs, gain=0.28):
    n = int(RATE * secs)
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / 0.012) * math.exp(-3.2 * t / secs)  # quick attack, soft decay
        s = math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(2 * math.pi * freq * 2 * t)  # a little body
        out.append(gain * env * s / 1.25)
    return out


def rest(secs):
    return [0.0] * int(RATE * secs)


def write(name, samples):
    with wave.open(str(OUT / name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32767)) for s in samples))


C5, E5, G5, A4, F4, C6 = 523.25, 659.25, 783.99, 440.0, 349.23, 1046.5
write('done.wav', tone(G5, 0.18) + tone(C6, 0.32))                      # up: finished
write('attention.wav', tone(E5, 0.16) + rest(0.06) + tone(E5, 0.22))    # two taps: needs you
write('good.wav', tone(C5, 0.12) + tone(E5, 0.12) + tone(G5, 0.3))      # rising: passed
write('bad.wav', tone(A4, 0.2) + tone(F4, 0.38, gain=0.3))              # falling: failed
print('ok', sorted(p.name for p in OUT.glob('*.wav')))
