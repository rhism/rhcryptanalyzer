import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { verifyPin } from "@/lib/lock.functions";

const PIN_LENGTH = 6;
const STORAGE_KEY = "app_unlocked_v1";

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const verify = useServerFn(verifyPin);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (value: string) => {
    setChecking(true);
    setError(null);
    try {
      const res = (await verify({ data: { pin: value } })) as { ok: boolean };
      if (res.ok) {
        try {
          sessionStorage.setItem(STORAGE_KEY, "1");
        } catch {
          // ignore
        }
        onUnlock();
      } else {
        setError("PIN salah");
        setShake(true);
        setPin("");
        setTimeout(() => setShake(false), 500);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPin("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setChecking(false);
    }
  };

  const handleChange = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    setError(null);
    if (digits.length === PIN_LENGTH && !checking) {
      void submit(digits);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="mb-2 text-2xl font-extrabold tracking-widest">
          <span className="text-neon-pink">ENTER</span>{" "}
          <span className="text-neon-orange">PIN</span>
        </h1>
        <p className="mb-8 text-xs uppercase tracking-widest text-white/50">
          Locked · personal access only
        </p>

        <div
          className={`mb-6 flex justify-center gap-2 sm:gap-3 ${shake ? "animate-shake" : ""}`}
          onClick={() => inputRef.current?.focus()}
        >
          {Array.from({ length: PIN_LENGTH }).map((_, i) => {
            const filled = i < pin.length;
            return (
              <div
                key={i}
                className={`h-12 w-9 rounded-md border-2 sm:h-14 sm:w-11 ${
                  filled
                    ? "border-[color:var(--neon-pink)] bg-[color:var(--neon-pink)]/20 neon-glow-pink"
                    : "border-[color:var(--neon-magenta)]/50 bg-black/40"
                } flex items-center justify-center text-2xl font-bold text-white transition`}
              >
                {filled ? "•" : ""}
              </div>
            );
          })}
        </div>

        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={pin}
          onChange={(e) => handleChange(e.target.value)}
          disabled={checking}
          aria-label="PIN"
          className="absolute h-0 w-0 opacity-0"
        />

        <div className="min-h-[1.5rem] text-sm font-medium text-red-300">
          {error && <span>{error}</span>}
          {checking && !error && <span className="text-white/60">Checking…</span>}
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.45s ease-in-out; }
      `}</style>
    </div>
  );
}

export function useUnlocked(): [boolean, () => void] {
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  return [unlocked, () => setUnlocked(true)];
}
